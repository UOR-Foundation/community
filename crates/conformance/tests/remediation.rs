//! The `remediation` suite: one test per scenario in `features/suites/remediation.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog and drafts are the register's: a repository, change, digest or
//! open claim in `remediation/register.json` missing from
//! `app/src/Remediation.lex.tex`, or a repository without a draft, fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Remediation.V1.Model";

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

/// Every string value of `key` at exactly `indent` spaces in the register, in order.
fn at(json: &str, indent: usize, key: &str) -> Vec<String> {
    let needle = format!("\n{}\"{key}\": \"", " ".repeat(indent));
    json.match_indices(&needle)
        .map(|(i, _)| {
            let rest = &json[i + needle.len()..];
            rest[..rest.find('"').expect("a closed string")].to_string()
        })
        .collect()
}

/// `RM-01`: The remediation register is valid
#[test]
fn remediation_rm_01() {
    let catalog = read("app/src/Remediation.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (repositories) (changes) (openClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Remediation/V1/Model.lex.tex");
    for part in [
        "((repositoriesTotal repositories) =? (project release repositoriesCount))",
        "((changesTotal changes) =? (project release changesCount))",
        "((openClaimsTotal openClaims) =? (project release openClaimsCount))",
        "(changesValid 0 (repositoriesTotal repositories) changes)",
        "(openClaimsValid 0 (repositoriesTotal repositories) openClaims)",
        "(agree (project repository tierRecorded) ((project repository tiersProjected) =? 1))",
        "((project repository tierRecorded) || (((project repository tiersProjected) =? tiers) && ((tierDecisionsOf (project repository index) claims) =? 1)))",
        "((changesOf (project repository index) changes) =? (project repository changesNow))",
        "((decisionsOf (project repository index) claims) =? (project repository decisions))",
        "((findingsOf (project repository index) claims) =? (project repository findings))",
        "(accounted (project release tierCount) changes openClaims repositories)",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
}

/// `RM-02`: The remediation catalog declares every repository, change, draft and digest
#[test]
fn remediation_rm_02() {
    let register = read("remediation/register.json");
    let catalog = read("app/src/Remediation.lex.tex");
    let ecosystem = read("ecosystem/register.json");
    let names = at(&register, 6, "name");
    assert!(
        !names.is_empty(),
        "the register holds the Foundation's repositories"
    );
    assert_eq!(
        names,
        at(&ecosystem, 6, "name"),
        "the remediation holds every repository of the ecosystem register, in order"
    );
    for name in &names {
        assert!(
            catalog.contains(&format!("name := \"{name}\"")),
            "{name} is declared"
        );
        assert!(
            root()
                .join(format!("remediation/drafts/{name}.md"))
                .is_file(),
            "{name} has an issue draft"
        );
    }
    for commit in at(&register, 6, "commit") {
        assert!(
            catalog.contains(&format!("commit := \"{commit}\"")),
            "{commit} is declared"
        );
    }
    let changes = at(&register, 10, "detail").len();
    assert!(
        catalog.contains(&format!("changesCount := {changes}")),
        "every change that applies at every tier is declared"
    );
    let mut digests = at(&register, 4, "sha256");
    digests.extend(at(&register, 6, "sha256"));
    assert!(
        digests.len() >= 3,
        "the ecosystem, observations and sources are addressed"
    );
    for digest in &digests {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the digest {digest} is declared"
        );
    }
}

/// `RM-03`: Every decision and finding is an open claim
#[test]
fn remediation_rm_03() {
    let register = read("remediation/register.json");
    let catalog = read("app/src/Remediation.lex.tex");
    let refusals = at(&register, 6, "refusal");
    assert!(
        !refusals.is_empty(),
        "the register carries the open decisions"
    );
    assert!(
        refusals.iter().all(|r| r.starts_with("decision-")
            || r.starts_with("blocked-")
            || r == "unobservable"),
        "every refusal is a decision or a finding"
    );
    let declared = catalog
        .matches(&format!("(record {M}::OpenClaim {{"))
        .count();
    assert_eq!(declared, refusals.len(), "every refusal is one OpenClaim");
    assert!(
        catalog.contains(&format!("openClaimsCount := {}", refusals.len())),
        "the release counts every open claim"
    );
}
