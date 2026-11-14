//! The `governance` suite: one test per scenario in `features/suites/governance.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a provision, source, delegation or open claim
//! in `governance/register.json` missing from `app/src/Governance.lex.tex` fails
//! the gate.

use std::path::PathBuf;

const MODEL: &str = "app/src/Foundation/Governance/V1/Model.lex.tex";
const CATALOG: &str = "app/src/Governance.lex.tex";
const REGISTER: &str = "governance/register.json";

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

/// The `registerValid` definition of the type module.
fn register_valid() -> String {
    let model = read(MODEL);
    let start = model
        .find("\n  name: registerValid,\n")
        .expect("registerValid is declared");
    model[start..start + model[start..].find("\n}\n").expect("closed")].to_string()
}

/// `GV-01`: The Foundation governance register is valid
#[test]
fn governance_gv_01() {
    let catalog = read(CATALOG);
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}\n").expect("closed")];
    assert!(
        theorem.contains("statement: ((Foundation.Governance.V1.Model::registerValid (release) (provisions) (units) (subOrganizations) (posts) (roles) (voteRules) (stages) (bylawNumbers) (serviceLevels) (tiers) (topicTags) (rungs) (people) (holdings) (memberships) (delegations) (references) (openClaims)) = true),"),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let valid = register_valid();
    for part in [
        "(unitsValid 0 (provisionsTotal provisions) units)",
        "(postsValid 0 (unitsTotal units) (provisionsTotal provisions) posts)",
        "(voteRulesValid 0 (unitsTotal units) (provisionsTotal provisions) voteRules)",
        "(stagesValid 0 (voteRulesTotal voteRules) (provisionsTotal provisions) stages)",
        "(referencesValid 0 (provisionsTotal provisions) references)",
        "(positionsHeldOnce posts holdings (project release board))",
        "((project release boardMinimum) <? ((seatsIn posts holdings (project release board)) + 1))",
        "((seatsIn posts holdings (project release board)) <? ((project release boardMaximum) + 1))",
        "(stagesDecidedBy voteRules stages (project release toc))",
        "(rulesHaveQuorum voteRules voteRules)",
        "((openClaimsTotal openClaims) =? (project release openClaimsCount))",
    ] {
        assert!(valid.contains(part), "registerValid still checks {part}");
    }
}

/// `GV-02`: The governance catalog declares every provision with its source digest
#[test]
fn governance_gv_02() {
    let register = read(REGISTER);
    let catalog = read(CATALOG);
    let keys = values(&register, "key");
    let digests = values(&register, "sha256");
    let commits = values(&register, "commit");
    assert!(
        keys.len() >= 100,
        "the register holds every provision of every pinned source"
    );
    for digest in &digests {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the digest {digest} is declared"
        );
    }
    for commit in &commits {
        assert!(
            catalog.contains(commit),
            "the source commit {commit} is declared"
        );
    }
    assert!(
        catalog.contains(&format!("provisionsCount := {}", keys.len())),
        "the release counts every provision"
    );
}

/// `GV-03`: Every refusal is an open claim
#[test]
fn governance_gv_03() {
    let register = read(REGISTER);
    let catalog = read(CATALOG);
    let refusals = values(&register, "refusal");
    let declared = catalog
        .matches("(record Foundation.Governance.V1.Model::OpenClaim {")
        .count();
    assert_eq!(declared, refusals.len(), "every refusal is one OpenClaim");
    assert!(
        catalog.contains(&format!("openClaimsCount := {}", refusals.len())),
        "the release counts every open claim"
    );
    for refusal in &refusals {
        assert!(
            catalog.contains(&format!("refusal := \"{refusal}\"")),
            "{refusal} is carried"
        );
    }
}

/// `GV-04`: Agents are SoftwareApplication and act on behalf of a Person
#[test]
fn governance_gv_04() {
    let register = read(REGISTER);
    let catalog = read(CATALOG);
    let valid = register_valid();
    for part in [
        "(delegationsTyped people delegations)",
        "(membershipsTyped people memberships)",
        "(holdingsTyped people holdings)",
    ] {
        assert!(valid.contains(part), "registerValid still checks {part}");
    }
    let delegations = register.matches("\"onBehalfOf\": ").count();
    assert!(
        delegations >= 1,
        "the register holds the delegations its commits record"
    );
    assert_eq!(
        catalog
            .matches("(record Foundation.Governance.V1.Model::Delegation {")
            .count(),
        delegations,
        "every delegation is declared"
    );
    assert!(
        catalog.contains(
            "actorType := (ctor Foundation.Governance.V1.Model::ActorType.softwareApplication)"
        ),
        "agents are declared as SoftwareApplication"
    );
}
