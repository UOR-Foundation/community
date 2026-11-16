//! The `bestpractices` suite: one test per scenario in `features/suites/bestpractices.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a criterion, repository commit, digest,
//! detective citation, open outcome or refusal in `bestpractices/register.json`
//! missing from `app/src/BestPractices.lex.tex` fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.BestPractices.V1.Model";

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
            let mut end = 0;
            let bytes = rest.as_bytes();
            while bytes[end] != b'"' {
                end += if bytes[end] == b'\\' { 2 } else { 1 };
            }
            rest[..end].to_string()
        })
        .collect()
}

/// Every number value of `key` in the register, in order.
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

/// The `counts` object of the register: the text between `"counts": {` and the next criteria array.
fn count(register: &str, key: &str) -> u64 {
    let start = register
        .find("\"counts\": {")
        .expect("the register has counts");
    let end = register[start..]
        .find("\"criteria\": [")
        .expect("criteria follow the counts")
        + start;
    numbers(&register[start..end], key)[0]
}

/// `BP-01`: The Best Practices register is valid
#[test]
fn bestpractices_bp_01() {
    let catalog = read("app/src/BestPractices.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (criteria) (repositories) (outcomes) (badgeQueries) (refusals)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/BestPractices/V1/Model.lex.tex");
    for part in [
        "(blockAligned criteria criteria 0 (project release repositoriesCount) outcomes)",
        "(((project outcome repository) =? position) && (outcomeAgrees criterion outcome))",
        "((project outcome criterion) =? (project criterion index))",
        "(agree (project outcome open) ((isMust (project criterion category)) && ((isUnmet (project outcome status)) || (isUnknown (project outcome status)))))",
        "((not (isNa (project outcome status))) || (project criterion naAllowed))",
        "| List.nil => (position =? width)",
        "(agree (isUnknown (project outcome status)) (noDetective (project outcome detective)))",
        "(repositoriesComplete (project release criteriaCount) repositories)",
        "((openTotal outcomes) =? (project release openCount))",
        "((repositoryOpenTotal repositories) =? (project release openCount))",
        "((clearPassingTotal repositories) =? (project release mustClearPassing))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
    let register = read("bestpractices/register.json");
    let criteria = count(&register, "criteria");
    let repositories = count(&register, "repositories");
    assert_eq!(repositories, 31, "the 31 public repositories are evaluated");
    assert_eq!(
        count(&register, "outcomes"),
        criteria * repositories,
        "one outcome for every criterion of every repository"
    );
    assert_eq!(
        catalog.matches(&format!("(record {M}::Outcome {{")).count() as u64,
        criteria * repositories,
        "every outcome is one record"
    );
    assert_eq!(
        catalog
            .matches(&format!("(record {M}::Criterion {{"))
            .count() as u64,
        criteria,
        "every criterion is one record, none dropped"
    );
}

/// `BP-02`: The Best Practices catalog declares the badge commit, the digests, every commit and every citation
#[test]
fn bestpractices_bp_02() {
    let register = read("bestpractices/register.json");
    let catalog = read("app/src/BestPractices.lex.tex");
    let sources = read("bestpractices/sources.json");
    let commit = &values(&sources, "commit")[0];
    assert_eq!(
        commit.len(),
        40,
        "the badge project is pinned by a full commit"
    );
    assert!(
        catalog.contains(&format!("badgeCommit := \"{commit}\"")),
        "the release names the badge commit"
    );
    let reading = read("bestpractices/criteria.json");
    for digest in values(&reading, "sha256") {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the release carries the source digest {digest}"
        );
    }
    let snapshot = read("bestpractices/snapshot.json");
    let licensing = read("licensing/snapshot.json");
    for (name, pinned) in values(&licensing, "repository")
        .iter()
        .zip(values(&licensing, "commit"))
    {
        assert!(
            snapshot.contains(&format!("\"commit\": \"{pinned}\"")),
            "{name} is read at {pinned}"
        );
        assert!(
            catalog.contains(&format!("commit := \"{pinned}\"")),
            "{name}'s record carries its commit"
        );
    }
    // Every outcome that is not unknown cites a detective line at the pinned commit.
    let statuses = values(&register, "status");
    let cites = values(&register, "cite");
    assert_eq!(
        statuses.len(),
        cites.len(),
        "every outcome has a status and a citation"
    );
    let prefix =
        format!("https://github.com/coreinfrastructure/best-practices-badge@{commit}:app/lib/");
    for (status, cite) in statuses.iter().zip(&cites) {
        if status == "unknown" {
            assert!(cite.is_empty(), "an unknown outcome cites no detective");
        } else {
            assert!(
                cite.starts_with(&prefix),
                "{cite} is a pinned detective file"
            );
            let line = cite.rsplit(':').next().expect("a line");
            assert!(line.parse::<u32>().is_ok(), "{cite} names its line");
            assert!(
                catalog.contains(&format!("cite := \"{cite}\"")),
                "{cite} is declared"
            );
        }
    }
}

/// `BP-03`: MUST outcomes Unmet or unknown are open, and every refusal is a record of its kind
#[test]
fn bestpractices_bp_03() {
    let register = read("bestpractices/register.json");
    let catalog = read("app/src/BestPractices.lex.tex");
    let open = count(&register, "open");
    assert!(
        catalog.contains(&format!("openCount := {open}")),
        "the release counts {open} open outcomes"
    );
    assert_eq!(
        catalog.matches("open := true").count() as u64,
        open,
        "every open outcome is declared open"
    );
    let unknown = count(&register, "unknown");
    assert!(
        catalog.contains(&format!("unknownCount := {unknown}")),
        "the unknown outcomes are counted, never restated"
    );
    assert!(
        unknown > 0 && open > 0,
        "outcomes only a person or the badge application can give stay open"
    );
    let refusals = values(&register, "refusal");
    for kind in &refusals {
        assert!(
            [
                "licenseAtLaterHead",
                "headersUnreadable",
                "selfDeclaredFile"
            ]
            .contains(&kind.as_str()),
            "{kind} is a declared refusal"
        );
    }
    assert_eq!(
        catalog
            .matches(&format!("(record {M}::OpenRefusal {{"))
            .count(),
        refusals.len(),
        "every refusal is one record"
    );
}
