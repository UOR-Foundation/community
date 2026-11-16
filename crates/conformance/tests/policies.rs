//! The `policies` suite: one test per scenario in `features/suites/policies.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a source digest, sample section, clause or
//! open claim in `policies/register.json` missing from `app/src/Policies.lex.tex`
//! fails the gate, as does a draft that is not marked as a draft.

use std::path::PathBuf;

const M: &str = "Foundation.Policy.V1.Model";

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

/// The number the register's `counts` block gives for `key`.
fn count(json: &str, key: &str) -> usize {
    let block = &json[json.find("\"counts\": {").expect("a counts block")..];
    let block = &block[..block.find('}').expect("a closed block")];
    let needle = format!("\"{key}\": ");
    let at = block.find(&needle).expect("the count") + needle.len();
    let digits: String = block[at..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().expect("a number")
}

/// `PL-01`: The policy register is valid
#[test]
fn policies_pl_01() {
    let catalog = read("app/src/Policies.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (sources) (authorities) (models) (sections) (policies) (clauses) (derivations) (citations) (carries) (substitutions) (requirements) (coverages) (posts) (recordClasses) (bases) (acts) (openClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Policy/V1/Model.lex.tex");
    for part in [
        "(clausesCited citations clauses)",
        "(clausesDerived derivations clauses)",
        "(sectionsOnce derivations sections)",
        "((derivationsTotal derivations) =? (sectionsTotal sections))",
        "(clausesCarried carries clauses)",
        "(substitutionsApplied substitutions)",
        "(requirementsAccounted openClaims coverages requirements)",
        "((requirementCovered (project requirement index) allCoverages) || ((not (project requirement mandatory)) && (claimedAs 0 (project requirement index) claims)))",
        "(classesSettled openClaims bases recordClasses)",
        "(actsStaged openClaims acts)",
        "((not (project act executed)) && (claimedAs 3 (project act index) claims))",
        "(authoritiesGovern (project release jurisdiction) authorities)",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
    // The mandatory requirements are the Form 990 Part VI lines and Bylaws 10.3, and none is optional.
    let register = read("policies/register.json");
    for key in [
        "f990-12a-defines",
        "f990-12a-classes",
        "f990-12a-disclosure",
        "f990-12a-procedures",
        "f990-12b",
        "f990-12c",
        "f990-13-encourage",
        "f990-13-protect",
        "f990-13-identify",
        "f990-14-responsibilities",
        "f990-14-storage-destruction",
        "bylaws-10.3-adopt",
        "bylaws-10.3-disclose",
        "bylaws-10.3-act",
    ] {
        let at = register
            .find(&format!("\"key\": \"{key}\""))
            .unwrap_or_else(|| panic!("the requirement {key} is registered"));
        let rest = &register[at..at + register[at..].find('}').expect("closed")];
        assert!(rest.contains("\"mandatory\": true"), "{key} is mandatory");
    }
    assert!(
        !catalog.contains("executed := true"),
        "no staged act is executed"
    );
    for draft in [
        "policies/drafts/articles-of-amendment.md",
        "policies/drafts/conflict-of-interest.md",
        "policies/drafts/whistleblower.md",
        "policies/drafts/document-retention.md",
    ] {
        assert!(
            read(draft).contains("**DRAFT, not adopted.**"),
            "{draft} is marked as a draft"
        );
    }
}

/// `PL-02`: The policy catalog declares every source digest and every sample section
#[test]
fn policies_pl_02() {
    let register = read("policies/register.json");
    let snapshot = read("policies/snapshot.json");
    let catalog = read("app/src/Policies.lex.tex");
    let digests: Vec<String> = values(&register, "digest");
    assert_eq!(
        digests.len(),
        count(&register, "sources"),
        "every source carries one digest"
    );
    for digest in &digests {
        assert!(
            digest.starts_with("sha256:") && digest.len() == 71,
            "{digest} is a sha256 digest"
        );
        assert!(
            catalog.contains(&format!("digest := \"{digest}\"")),
            "the digest {digest} is declared"
        );
    }
    // Every fetch the policies snapshot made is a source of the register, so none is read unaddressed.
    let urls = values(&snapshot, "url");
    for url in &urls {
        assert!(
            register.contains(&format!("\"url\": \"{url}\"")),
            "the fetch of {url} is a source"
        );
    }
    // Every article and section of the IRS sample, I to VIII, is a ModelSection of model 0.
    for number in [
        "I", "II.1", "II.2", "III.1", "III.2", "III.3", "III.4", "IV", "V", "VI", "VII", "VIII",
    ] {
        assert!(
            catalog.contains(&format!("model := 0, number := \"{number}\",")),
            "the sample's {number} is declared"
        );
    }
    let sections = count(&register, "sections");
    assert_eq!(
        catalog
            .matches(&format!("(record {M}::ModelSection {{"))
            .count(),
        sections,
        "every model section is declared"
    );
    assert_eq!(
        count(&register, "derivations"),
        sections,
        "every model section is projected by one clause"
    );
}

/// `PL-03`: Uncovered requirements, unheld posts, unstated periods and staged acts are open claims
#[test]
fn policies_pl_03() {
    let register = read("policies/register.json");
    let catalog = read("app/src/Policies.lex.tex");
    let kind = |k: &str| {
        catalog
            .matches(&format!("subjectKind := (ctor {M}::SubjectKind.{k})"))
            .count()
    };
    let unstated = catalog
        .matches(&format!(
            "period := (ctor {M}::Period.unstated), years := 0"
        ))
        .count();
    assert!(unstated > 0, "the schedule carries unstated periods");
    assert_eq!(
        kind("recordClass"),
        unstated,
        "every unstated record class is one OpenClaim"
    );
    let unheld = catalog.matches("held := false").count();
    assert_eq!(kind("post"), unheld, "every unheld post is one OpenClaim");
    assert_eq!(
        kind("act"),
        count(&register, "acts"),
        "every staged act is one OpenClaim"
    );
    let claims = count(&register, "claims");
    assert_eq!(
        catalog
            .matches(&format!("(record {M}::OpenClaim {{"))
            .count(),
        claims,
        "every claim is declared"
    );
    assert!(
        catalog.contains(&format!("openClaimsCount := {claims}")),
        "the release counts every open claim"
    );
}
