//! The `ecosystem` suite: one test per scenario in `features/suites/ecosystem.feature`.
//!
//! `ecosystemValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a repository, digest or open claim in
//! `ecosystem/register.json` missing from `app/src/Ecosystem.lex.tex` fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Ecosystem.V1.Model";

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

/// Every string value of `key` in the register, in order.
fn values(json: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\": \"");
    json.match_indices(&needle)
        .map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            rest[..rest.find('"').expect("a closed string")].to_string()
        })
        .collect()
}

/// `EC-01`: The ecosystem register is valid
#[test]
fn ecosystem_ec_01() {
    let catalog = read("app/src/Ecosystem.lex.tex");
    let start = catalog
        .find("\n  name: ecosystemValidHolds,\n")
        .expect("ecosystemValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (snapshot) (repositories) (openClaims)) = true),"
        )),
        "ecosystemValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "ecosystemValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Ecosystem/V1/Model.lex.tex");
    for part in [
        "((repositoryTotal repositories) =? (project snapshot repositoryCount))",
        "((conformantTotal repositories) =? (project snapshot conformantCount))",
        "((claimTotal claims) =? (project snapshot openClaimCount))",
        "(repositoriesNumbered 0 repositories)",
        "(repositoriesAccounted claims repositories)",
        "(claimsNumbered 0 (repositoryTotal repositories) claims)",
        "(agree (tierRecorded (project repository tier)) ((project repository tierTags) =? 1))",
        "(agree (statusRecorded (project repository status)) ((project repository statusTags) =? 1))",
        "((isConformant (project repository outcome)) || (claimed (project repository index) claims))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
}

/// `EC-02`: The ecosystem catalog declares every repository and the digests it was projected from
#[test]
fn ecosystem_ec_02() {
    let register = read("ecosystem/register.json");
    let catalog = read("app/src/Ecosystem.lex.tex");
    let snapshot = read("ecosystem/snapshot.json");
    // Both files are written by JSON.stringify with two-space indents, so a
    // repository's name sits at the third level and a release tag's deeper.
    let at = |json: &str| -> Vec<String> {
        let needle = "\n      \"name\": \"";
        json.match_indices(needle)
            .map(|(i, _)| {
                let rest = &json[i + needle.len()..];
                rest[..rest.find('"').expect("a closed string")].to_string()
            })
            .collect()
    };
    let names = at(&register);
    assert!(
        !names.is_empty(),
        "the register holds the Foundation's repositories"
    );
    assert_eq!(
        names,
        at(&snapshot),
        "the register holds every snapshotted repository, in order"
    );
    for name in &names {
        assert!(
            catalog.contains(&format!("name := \"{name}\"")),
            "{name} is declared in the catalog"
        );
    }
    let digests = values(&register, "sha256");
    assert_eq!(
        digests.len(),
        4,
        "the snapshot, two norms and the app are addressed"
    );
    for digest in &digests {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the digest {digest} is declared"
        );
    }
}

/// `EC-03`: A repository the repo-standards app does not find conformant is an open claim
#[test]
fn ecosystem_ec_03() {
    let register = read("ecosystem/register.json");
    let catalog = read("app/src/Ecosystem.lex.tex");
    let refusals = values(&register, "refusal");
    let outcomes = values(&register, "outcome");
    let conformant = values(&register, "conformant")[0].clone();
    let failing = outcomes.iter().filter(|o| **o != conformant).count();
    let toc = refusals
        .iter()
        .filter(|r| *r == "toc-decision-unrecorded")
        .count();
    assert_eq!(
        failing + toc,
        refusals.len(),
        "every failing repository is one refusal"
    );
    let declared = catalog
        .matches(&format!("(record {M}::OpenClaim {{"))
        .count();
    assert_eq!(declared, refusals.len(), "every refusal is one OpenClaim");
    assert!(
        catalog.contains(&format!("openClaimCount := {}", refusals.len())),
        "the snapshot counts every open claim"
    );
}
