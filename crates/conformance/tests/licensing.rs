//! The `licensing` suite: one test per scenario in `features/suites/licensing.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a repository, commit, digest, declaration or
//! open claim in `licensing/register.json` missing from `app/src/Licensing.lex.tex`
//! fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Licensing.V1.Model";

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

/// Every boolean value of `key` in the register, in order.
fn flags(json: &str, key: &str) -> Vec<bool> {
    let needle = format!("\"{key}\": ");
    json.match_indices(&needle)
        .filter_map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            if rest.starts_with("true") {
                Some(true)
            } else if rest.starts_with("false") {
                Some(false)
            } else {
                None
            }
        })
        .collect()
}

/// `LC-01`: The licensing register is valid
#[test]
fn licensing_lc_01() {
    let catalog = read("app/src/Licensing.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (licenses) (rules) (repositories) (declarations) (declaredIds) (openClaims) (policyClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Licensing/V1/Model.lex.tex");
    for part in [
        "((repositoriesTotal repositories) =? (project release repositoriesCount))",
        "(declaredIdsValid 0 (declarationsTotal declarations) (licensesTotal licenses) declaredIds)",
        "((project declaredId license) <? licensesCount)",
        "((countsReconcile repository) && (repositoriesValid (position + 1) licensesCount rulesCount rest))",
        "(agree (project repository compliant) (noFindings repository))",
        "((project repository filesWithCopyright) =? (project repository filesTotal))",
        "((project repository filesWithLicense) =? (project repository filesTotal))",
        "((project repository invalidExpressions) =? 0)",
        "((compliantTotal repositories) =? (project release compliantCount))",
        "(repositoriesClaimed openClaims repositories)",
        "((project repository compliant) || (claimedReuseNoncompliant (project repository index) claims))",
        "(declarationsClaimed openClaims declarations)",
        "(conformingNamesExpected declaredIds repositories declarations)",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
    // The register's own counts agree with the tool's: compliant exactly when nothing is held against it.
    let register = read("licensing/register.json");
    let compliant = flags(&register, "compliant");
    assert_eq!(
        compliant.len(),
        values(&register, "commit").len() - 1,
        "every repository records the tool's compliance"
    );
    let count = compliant.iter().filter(|c| **c).count();
    assert!(
        catalog.contains(&format!("compliantCount := {count}")),
        "the release counts {count} compliant repositories"
    );
}

/// `LC-02`: The licensing catalog declares the tool, list, digests and every commit
#[test]
fn licensing_lc_02() {
    let register = read("licensing/register.json");
    let catalog = read("app/src/Licensing.lex.tex");
    let snapshot = read("licensing/snapshot.json");
    let names = values(&snapshot, "repository");
    let commits: Vec<String> = values(&snapshot, "commit");
    assert_eq!(names.len(), 31, "the 31 public repositories are pinned");
    for (name, commit) in names.iter().zip(&commits) {
        assert!(
            catalog.contains(&format!("{name}@{commit}")),
            "{name} is declared at {commit}"
        );
        assert!(
            catalog.contains(&format!("commit := \"{commit}\"")),
            "{name}'s record carries its commit"
        );
    }
    let sources = read("licensing/sources.json");
    let version = values(&sources, "version")[1].clone();
    let wheel = values(&sources, "sha256")[1].clone();
    assert!(
        catalog.contains(&format!("reuse {version} "))
            && catalog.contains(&format!("sha256:{wheel}")),
        "the REUSE tool is declared by version and wheel digest"
    );
    for digest in values(&register, "sha256")
        .into_iter()
        .chain(values(&register, "licensesSha256"))
        .chain(values(&register, "exceptionsSha256"))
    {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the digest {digest} is declared"
        );
    }
    assert!(
        catalog
            .contains("SPDX License List 3.29.0 v3.29.0@31ba1a50e5397e00a304dbadc76531740e89ee48"),
        "the pinned SPDX License List is declared"
    );
}

/// `LC-03`: Non-compliant repositories and policy mismatches are open claims
#[test]
fn licensing_lc_03() {
    let register = read("licensing/register.json");
    let catalog = read("app/src/Licensing.lex.tex");
    let refusals = values(&register, "refusal");
    let failing = flags(&register, "compliant")
        .iter()
        .filter(|c| !**c)
        .count();
    let noncompliant = refusals
        .iter()
        .filter(|r| *r == "reuse-noncompliant")
        .count();
    assert_eq!(
        noncompliant, failing,
        "every non-compliant repository is one reuse-noncompliant claim"
    );
    let mismatched = flags(&register, "conformsPolicy")
        .iter()
        .filter(|c| !**c)
        .count();
    assert!(
        mismatched == 0 || refusals.iter().any(|r| r == "policy-mismatch"),
        "a declaration the policy does not allow is claimed"
    );
    let declared = catalog
        .matches(&format!("(record {M}::OpenClaim {{"))
        .count()
        + catalog
            .matches(&format!("(record {M}::PolicyClaim {{"))
            .count();
    assert_eq!(
        declared,
        refusals.len(),
        "every refusal is one claim record"
    );
    assert!(
        catalog.contains(&format!("(ctor {M}::Refusal.reuseNoncompliant)")) || failing == 0,
        "the non-compliant repositories are declared by kind"
    );
}
