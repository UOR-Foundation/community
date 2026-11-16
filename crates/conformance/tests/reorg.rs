//! The `reorg` suite: one test per scenario in `features/suites/reorg.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a repository, commit, digest, candidate, norm
//! gap or act in `reorg/register.json` missing from `app/src/Reorg.lex.tex`, or
//! an act marked executed, fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Reorg.V1.Model";
const MODEL: &str = "app/src/Foundation/Reorg/V1/Model.lex.tex";
const CATALOG: &str = "app/src/Reorg.lex.tex";
const REGISTER: &str = "reorg/register.json";

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

/// `RO-01`: The reorganization register is valid
#[test]
fn reorg_ro_01() {
    let catalog = read(CATALOG);
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (repositories) (dependencies) (citations) (candidates) (normGaps) (acts)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read(MODEL);
    for part in [
        "(repositoriesValid 0 (repositoriesTotal repositories) repositories)",
        "(actsValid 0 (repositoriesTotal repositories) acts)",
        "(dispositionFollows repository)",
        "(consumerAgrees (project repository consumer) (project repository dependents))",
        "(not (project act executed))",
        "((((keptTotal repositories) + (archivedTotal repositories)) + ((foldedTotal repositories) + (reviewedTotal repositories))) =? (project release repositoriesCount))",
        "(foldsSound repositories repositories)",
        "(foldsSettle repositories repositories)",
        "(dispositionsCited citations repositories)",
        "(dependentsCounted dependencies repositories)",
        "(actsSound repositories acts)",
        "(reviewsClaimed candidates repositories)",
        "(candidatesSound repositories candidates)",
        "((not ((project repository host) =? (project repository index))) && (keptAt allRepos (project repository host)))",
        "(agree (project act conditional) (reviewAt allRepos (project act repository)))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
    // The table in the model is the app's: one branch per rule, in the app's order.
    let prompt = read("apps/uor-repo-disposition.prompt.json");
    let rules = prompt.matches("\"then\": ").count()
        - prompt.matches("\"kind\": \"always\"").count()
        - prompt.matches("\"kind\": \"never\"").count();
    let start = model
        .find("\n  name: firstRule,\n")
        .expect("firstRule is declared");
    let first = &model[start..start + model[start..].find("\n}").expect("closed")];
    assert_eq!(
        first.matches(" then ").count(),
        rules,
        "firstRule has one branch per rule of the app"
    );
}

/// `RO-02`: The reorganization catalog declares every repository with its commit and every digest
#[test]
fn reorg_ro_02() {
    let register = read(REGISTER);
    let catalog = read(CATALOG);
    let snapshot = read("reorg/snapshot.json");
    let names = values(&register, "name");
    let commits = values(&register, "commit");
    let expected = values(&snapshot, "defaultBranch").len();
    assert!(
        expected > 0,
        "the snapshot holds the Foundation's repositories"
    );
    // The register names the app first, then each repository; the builder commit follows the app.
    let repos: Vec<&String> = names.iter().skip(1).collect();
    assert_eq!(
        repos.len(),
        expected,
        "every snapshotted repository is in the register"
    );
    for name in &repos {
        assert!(
            catalog.contains(&format!("name := \"{name}\", commit := \"")),
            "{name} is declared with its commit"
        );
    }
    for commit in commits.iter().filter(|c| c.len() == 40) {
        assert!(
            catalog.contains(commit.as_str()),
            "the commit {commit} is declared"
        );
    }
    let digests = values(&register, "sha256");
    assert!(
        digests.len() >= 7,
        "the snapshot, the set, three norms, two platform documents and the app are addressed"
    );
    for digest in &digests {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the digest {digest} is declared"
        );
    }
    assert!(
        catalog.contains("appDigest := \"sha256:")
            && catalog.contains("builder := \"afflom/prism-devrel@"),
        "the app digest and the builder commit are declared"
    );
}

/// `RO-03`: Undecided candidates and norm gaps are open claims, and no act is executed
#[test]
fn reorg_ro_03() {
    let register = read(REGISTER);
    let catalog = read(CATALOG);
    let reviews = register.matches("\"disposition\": \"review\"").count();
    let candidates = catalog
        .matches(&format!("(record {M}::Candidate {{"))
        .count();
    assert_eq!(
        candidates, reviews,
        "every repository under review is one Candidate"
    );
    let gaps = values(&register, "refusal")
        .iter()
        .filter(|r| {
            [
                "fold-undefined",
                "inactivity-unquantified",
                "archival-application-unspecified",
                "status-without-stage",
                "issue-transfer-undefined",
            ]
            .contains(&r.as_str())
        })
        .count();
    assert_eq!(
        catalog.matches(&format!("(record {M}::NormGap {{")).count(),
        gaps,
        "every norm gap is one NormGap"
    );
    assert!(
        gaps > 0
            && values(&register, "refusal")
                .iter()
                .any(|r| r == "fold-undefined"),
        "the norms define no fold, and the register says so"
    );
    let acts = catalog.matches(&format!("(record {M}::Act {{")).count();
    assert_eq!(
        register.matches("\"executed\": false").count(),
        acts,
        "every staged act is declared unexecuted"
    );
    assert!(
        !register.contains("\"executed\": true") && !catalog.contains("executed := true"),
        "no act is executed"
    );
    assert!(
        catalog.contains(&format!("candidatesCount := {reviews}"))
            && catalog.contains(&format!("reviewCount := {reviews}")),
        "the release counts every candidate"
    );
}
