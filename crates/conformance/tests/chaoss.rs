//! The `chaoss` suite: one test per scenario in `features/suites/chaoss.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a slug, digest or open claim in
//! `chaoss/register.json` missing from `app/src/Chaoss.lex.tex` fails the gate.

use std::path::PathBuf;

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

/// `CC-01`: The CHAOSS register is valid
#[test]
fn chaoss_cc_01() {
    let catalog = read("app/src/Chaoss.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}\n").expect("closed")];
    assert!(theorem.contains("statement: ((Foundation.Community.V1.Model::registerValid (release) (metrics) (models) (openClaims)) = true),"), "registerValidHolds is about the whole register:\n{theorem}");
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Community/V1/Model.lex.tex");
    for part in [
        "(metricsNumbered 0 metrics)",
        "(modelsNumbered 0 models)",
        "(modelsWellFormed (metricTotal metrics) models)",
        "(claimsNumbered 0 (modelTotal models) claims)",
        "((claimTotal claims) =? (project release openClaimCount))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
}

/// `CC-02`: The CHAOSS catalog declares every metric and metrics model with its source digest
#[test]
fn chaoss_cc_02() {
    let register = read("chaoss/register.json");
    let catalog = read("app/src/Chaoss.lex.tex");
    let slugs = values(&register, "slug");
    let digests = values(&register, "sha256");
    assert!(
        slugs.len() >= 117,
        "the register holds every released metric and model, and its refusals"
    );
    for slug in &slugs {
        assert!(
            catalog.contains(&format!("slug := \"{slug}\"")),
            "{slug} is declared in the catalog"
        );
    }
    for digest in &digests {
        assert!(
            catalog.contains(&format!("sourceDigest := \"sha256:{digest}\"")),
            "the digest {digest} is declared"
        );
    }
}

/// `CC-03`: An unmatched released item is an open claim
#[test]
fn chaoss_cc_03() {
    let register = read("chaoss/register.json");
    let catalog = read("app/src/Chaoss.lex.tex");
    let refusals = values(&register, "refusal");
    let declared = catalog
        .matches("(record Foundation.Community.V1.Model::OpenClaim {")
        .count();
    assert_eq!(declared, refusals.len(), "every refusal is one OpenClaim");
    assert!(
        catalog.contains(&format!("openClaimCount := {}", refusals.len())),
        "the release counts every open claim"
    );
}
