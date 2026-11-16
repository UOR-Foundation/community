//! The `conventions` suite: one test per scenario in `features/suites/conventions.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a repository, commit, digest, oracle or claim
//! in `conventions/register.json` missing from `app/src/Conventions.lex.tex`
//! fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Conventions.V1.Model";

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

/// The text of the register's top-level array `key`, up to the next top-level key.
fn array<'a>(json: &'a str, key: &str) -> &'a str {
    let open = format!("\n  \"{key}\": [");
    let at = json.find(&open).expect("the array") + open.len();
    let rest = &json[at..];
    &rest[..rest.find("\n  \"").unwrap_or(rest.len())]
}

/// Every string value of `key`, in order.
fn values(json: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\": \"");
    json.match_indices(&needle)
        .map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            rest[..rest.find('"').expect("a closed string")].to_string()
        })
        .collect()
}

/// Every number value of `key`, in order.
fn numbers(json: &str, key: &str) -> Vec<u64> {
    let needle = format!("\"{key}\": ");
    json.match_indices(&needle)
        .filter_map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
            digits.parse().ok()
        })
        .collect()
}

/// `CV-01`: The conventions register is valid
#[test]
fn conventions_cv_01() {
    let catalog = read("app/src/Conventions.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (conventions) (norms) (clauses) (repositories) (outcomes) (tags) (manifests) (violations) (changelogChecks) (openClaims) (policyClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Conventions/V1/Model.lex.tex");
    for part in [
        "(outcomesOrdered 0 0 (project release conventionsCount) (project release repositoriesCount) outcomes)",
        "(outcomesHold conventions norms repositories openClaims outcomes)",
        "(recordsReconcile tags manifests changelogChecks openClaims repositories)",
        "(statusFits (project outcome status) (observableAt allConventions (project outcome convention)) (project outcome measured) (project outcome failing))",
        "(claimed (project outcome repository) (project outcome convention) claims)",
        "((reqCode (project outcome requirement)) =? (requiredIn allRepositories (project outcome repository) (normCode allNorms (project outcome convention))))",
        "(((project repository conforming) + (project repository nonconforming)) =? (project repository commitsEvaluated))",
        "((project repository conforming) <? ((project repository parserAccepted) + 1))",
        "((conformingSum repositories) =? (project release commitsConforming))",
        "((statusCount outcomes true) =? (project release metCount))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
    // One outcome per repository and convention.
    let register = read("conventions/register.json");
    let repositories = values(array(&register, "repositories"), "commit").len();
    let conventions = values(array(&register, "conventions"), "key").len();
    let outcomes = values(array(&register, "outcomes"), "status");
    assert_eq!(repositories, 31, "the 31 public repositories are observed");
    assert_eq!(conventions, 5, "five conventions");
    assert_eq!(
        outcomes.len(),
        repositories * conventions,
        "one outcome per repository and convention"
    );
    let met = outcomes.iter().filter(|s| *s == "met").count();
    assert!(
        catalog.contains(&format!("metCount := {met}")),
        "the release counts {met} met outcomes"
    );
    let conforming: u64 = numbers(array(&register, "repositories"), "conforming")
        .iter()
        .sum();
    assert!(
        catalog.contains(&format!("commitsConforming := {conforming}")),
        "the release counts {conforming} conforming commits"
    );
}

/// `CV-02`: The conventions catalog declares the sources, oracles and every commit
#[test]
fn conventions_cv_02() {
    let register = read("conventions/register.json");
    let catalog = read("app/src/Conventions.lex.tex");
    let snapshot = read("licensing/snapshot.json");
    let names = values(&snapshot, "repository");
    let commits = values(&snapshot, "commit");
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
    for digest in values(array(&register, "sources"), "sha256")
        .into_iter()
        .chain(values(array(&register, "inputs"), "sha256"))
        .chain(values(array(&register, "scanInputs"), "sha256"))
    {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the digest {digest} is declared"
        );
    }
    let tools = &register[register.find("\n  \"tools\": {").expect("tools")..];
    let tools = &tools[..tools.find("\n  },").expect("closed")];
    let oracles = values(tools, "name");
    let versions = values(tools, "version");
    let integrity = values(tools, "integrity");
    assert!(oracles.iter().any(|o| o == "semver"), "semver is an oracle");
    assert!(
        oracles.iter().any(|o| o == "conventional-commits-parser"),
        "the parser is an oracle"
    );
    assert!(
        oracles
            .iter()
            .any(|o| o == "@commitlint/config-conventional"),
        "commitlint is an oracle"
    );
    assert!(
        oracles.iter().any(|o| o == "keep-a-changelog"),
        "keep-a-changelog is an oracle"
    );
    for ((name, version), sri) in oracles.iter().zip(&versions).zip(&integrity) {
        assert!(
            catalog.contains(&format!("{name}@{version} {sri}")),
            "{name} is declared by version and integrity"
        );
    }
    let regex = values(
        &register[register.find("\"semverRegex\"").expect("regex")..],
        "sha256",
    )[0]
    .clone();
    assert!(
        catalog.contains(&format!("sha256:{regex}")),
        "the SemVer expression's digest is declared"
    );
    for commit in [
        "88e3357f2213196669a6fdefc5a59afe5ec17bee",
        "7d293dc59e88abc8ce6c6698344d4da518ff3f27",
        "08d0df5a7e93b71d902def8be0f0d40025b56289",
        "92da114114fc9b76cbf2c5168e29d409b62ddde8",
    ] {
        assert!(
            catalog.contains(&format!("@{commit}:")),
            "the source pinned at {commit} is declared"
        );
    }
}

/// `CV-03`: Unmet and unobserved conventions and undecidable clauses are open claims
#[test]
fn conventions_cv_03() {
    let register = read("conventions/register.json");
    let catalog = read("app/src/Conventions.lex.tex");
    let outcomes = array(&register, "outcomes");
    let required = values(outcomes, "requirement");
    let status = values(outcomes, "status");
    let owed = required
        .iter()
        .zip(&status)
        .filter(|(r, s)| {
            (*r == "mandatory" || *r == "conditional") && (*s == "unmet" || *s == "unobserved")
        })
        .count();
    let refusals = values(array(&register, "refusals"), "refusal");
    let claimed = refusals
        .iter()
        .filter(|r| r.ends_with("-unmet") || r.ends_with("-unobserved"))
        .count();
    assert_eq!(
        owed, claimed,
        "every mandatory or conditional outcome that is unmet or unobserved is one claim"
    );
    assert!(
        owed > 0,
        "the register is not vacuous: some required convention is unmet"
    );
    let declared = catalog
        .matches(&format!("(record {M}::OpenClaim {{"))
        .count();
    assert_eq!(
        declared,
        refusals.len(),
        "every refusal is one OpenClaim record"
    );
    let policy = values(array(&register, "policyClaims"), "refusal");
    let declared_policy = catalog
        .matches(&format!("(record {M}::PolicyClaim {{"))
        .count();
    assert_eq!(
        declared_policy,
        policy.len(),
        "every policy claim is one PolicyClaim record"
    );
    let undecidable = values(array(&register, "clauses"), "check")
        .iter()
        .filter(|c| *c == "undecidable")
        .count();
    assert!(
        policy.iter().filter(|r| *r == "clause-undecidable").count() > undecidable,
        "every undecidable clause, and the profile's imperative mood, is a clause-undecidable claim"
    );
    assert!(
        catalog.contains(&format!("(ctor {M}::Refusal.mandatoryUnmet)")),
        "the unmet mandatory conventions are declared by kind"
    );
}
