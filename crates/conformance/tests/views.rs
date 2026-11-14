//! The `views` suite: one test per scenario in `features/suites/views.feature`.
//!
//! `viewsValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, that the
//! module declares what `views/register.json` projects, and that every surface
//! a stakeholder reads is the catalog's, byte for byte.

use std::path::{Path, PathBuf};
use std::process::Command;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/conformance is two below the root")
        .to_path_buf()
}

fn read(path: &str) -> String {
    std::fs::read_to_string(root().join(path)).expect("the file")
}

/// Every string value of `key` in a JSON text, in order.
fn values(json: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\": \"");
    json.match_indices(&needle)
        .map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            let mut end = 0;
            let bytes = rest.as_bytes();
            while bytes[end] != b'"' || (end > 0 && bytes[end - 1] == b'\\') {
                end += 1;
            }
            rest[..end].to_string()
        })
        .collect()
}

fn catalog_check(root: &Path) -> std::process::Output {
    Command::new("node")
        .arg(root.join("views/catalog.mjs"))
        .arg("--check")
        .output()
        .expect("Node runs the views catalog")
}

/// `SV-01`: The stakeholder views are a valid ISO/IEC/IEEE 42010 architecture description
#[test]
fn views_sv_01() {
    let module = read("app/src/Viewpoints.lex.tex");
    let start = module
        .find("\n  name: viewsValidHolds,\n")
        .expect("viewsValidHolds is declared");
    let theorem = &module[start..start + module[start..].find("\n}\n").expect("closed")];
    assert!(
        theorem.contains("statement: ((Foundation.Viewpoint.V1.Model::viewsValid (bounds) (stakeholders) (decisions) (concerns) (viewpoints) (views) (viewClaims) (modelIndices) (decisionIndices) (stakeholderIndices)) = true),"),
        "viewsValidHolds is about every view:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "viewsValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Viewpoint/V1/Model.lex.tex");
    for part in [
        "(stakeholdersNumbered 0 bounds stakeholders)",
        "(concernsWellFormed 0 bounds concerns)",
        "(viewpointsGoverned 0 bounds concerns viewpoints)",
        "(viewsGoverned 0 bounds views)",
        "(concernsFramedAndAddressed viewpoints views concerns)",
        "(claimsWellFormed 0 bounds claims)",
        "(covered (ctor SubjectKind.measurementModel) concerns claims modelIndices)",
        "(covered (ctor SubjectKind.decisionModel) concerns claims decisionIndices)",
        "(covered (ctor SubjectKind.stakeholder) concerns claims stakeholderIndices)",
    ] {
        assert!(model.contains(part), "viewsValid still checks {part}");
    }
}

/// `SV-02`: Every stakeholder is a role its pinned source names, with its quote, commit and digest
#[test]
fn views_sv_02() {
    let register = read("views/register.json");
    let module = read("app/src/Viewpoints.lex.tex");
    let slugs = values(&register, "slug");
    assert!(slugs.len() >= 7, "every governance role is a stakeholder");
    for slug in &slugs {
        assert!(
            module.contains(&format!("slug := \"{slug}\"")),
            "{slug} is declared"
        );
    }
    for quote in values(&register, "quote") {
        assert!(
            module.contains(&format!("quote := \"{quote}\"")),
            "the quote {quote} is declared"
        );
    }
    for digest in values(&register, "sha256") {
        assert!(module.contains(&digest), "the digest {digest} is declared");
    }
    assert!(
        module.contains(
            "principal := 5, source := \"https://www.w3.org/TR/2013/REC-prov-o-20130430/#sha256:"
        ),
        "the agent contributor acts on behalf of the contributor (index 5)"
    );
}

/// `SV-03`: Every surface is the register's catalog, and a page edited by hand is refused
#[test]
fn views_sv_03() {
    let ok = catalog_check(&root());
    assert!(
        ok.status.success(),
        "SV-03: {}",
        String::from_utf8_lossy(&ok.stderr)
    );

    // The planted defect: a copy of the inputs with one page edited by hand.
    let scratch = std::env::temp_dir().join(format!("views-sv-03-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);
    for dir in ["views", "chaoss", "health", "apps", "site/views", "app/src"] {
        std::fs::create_dir_all(scratch.join(dir)).expect("a scratch directory");
    }
    for file in [
        "views/catalog.mjs",
        "views/register.json",
        "views/sources.json",
        "views/discord.json",
        "chaoss/register.json",
        "health/register.json",
        "app/src/Viewpoints.lex.tex",
    ] {
        std::fs::copy(root().join(file), scratch.join(file)).expect("a copied input");
    }
    for entry in std::fs::read_dir(root().join("apps")).expect("apps") {
        let path = entry.expect("an entry").path();
        std::fs::copy(
            &path,
            scratch.join("apps").join(path.file_name().expect("a name")),
        )
        .expect("a copied prompt");
    }
    for entry in std::fs::read_dir(root().join("site/views")).expect("site/views") {
        let path = entry.expect("an entry").path();
        std::fs::copy(
            &path,
            scratch
                .join("site/views")
                .join(path.file_name().expect("a name")),
        )
        .expect("a copied page");
    }
    let page = scratch.join("site/views/contributor.md");
    let edited = std::fs::read_to_string(&page).expect("the page") + "\nAdded by hand.\n";
    std::fs::write(&page, edited).expect("the edit");
    let refused = catalog_check(&scratch);
    let _ = std::fs::remove_dir_all(&scratch);
    assert!(!refused.status.success(), "a hand-edited page is refused");
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains("site/views/contributor.md"),
        "the refusal names the page: {}",
        String::from_utf8_lossy(&refused.stderr)
    );
}

/// `SV-04`: Unmapped roles, story-less models and unaddressed stakeholders are open claims
#[test]
fn views_sv_04() {
    let register = read("views/register.json");
    let module = read("app/src/Viewpoints.lex.tex");
    let reasons = values(&register, "refusal");
    let details = values(&register, "detail");
    assert_eq!(reasons.len(), details.len(), "each refusal has its detail");
    for (reason, detail) in reasons.iter().zip(&details) {
        assert!(
            module.contains(&format!("name := \"{detail}\", reason := \"{reason}\"")),
            "the refusal {reason} ({detail}) is an OpenClaim"
        );
    }
}
