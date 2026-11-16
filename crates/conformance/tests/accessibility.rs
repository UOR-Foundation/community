//! The `accessibility` suite: one test per scenario in `features/suites/accessibility.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a criterion, rule, page, reading, digest,
//! tool version or open claim in `accessibility/register.json` missing from
//! `app/src/Accessibility.lex.tex` fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Accessibility.V1.Model";

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

/// Every string value of `key` in the JSON text, in order.
fn values(json: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\": \"");
    json.match_indices(&needle)
        .map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            rest[..rest.find('"').expect("a closed string")].to_string()
        })
        .collect()
}

/// The text of the register between `"key": [` and the next top-level key.
fn section<'a>(json: &'a str, key: &str) -> &'a str {
    let start = json
        .find(&format!("\n \"{key}\": "))
        .expect("the register has the section");
    let rest = &json[start + 1..];
    let end = rest[1..].find("\n \"").map_or(rest.len(), |e| e + 1);
    &rest[..end]
}

/// `AX-01`: The accessibility register is valid
#[test]
fn accessibility_ax_01() {
    let catalog = read("app/src/Accessibility.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (criteria) (requirements) (rules) (pages) (readings) (outcomes) (openClaims) (refusals) (clauses) (exclusions)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Accessibility/V1/Model.lex.tex");
    for part in [
        "(slotsValid 0 (project release targetedCount) criteria)",
        "(readingsCover 0 0 (project release configurationCount) (pagesTotal pages) readings)",
        "(outcomesCover 0 0 (project release targetedCount) (pagesTotal pages) criteria outcomes)",
        "(claimsAccounted openClaims outcomes)",
        "((failedOutcomes outcomes) =? (project release failedCount))",
        "((passedOutcomes outcomes) =? (project release passedCount))",
        "(clausesOrdered 0 criteria clauses)",
        "((enRequiringClauses clauses) =? (project release enRequiredCount))",
        "((enRequiredCriteria criteria) =? (project release enRequiredCount))",
        "(criterionSound criterion)",
        "(outcomeAgrees outcome)",
        "((project outcome page) <? pagesCount)",
        "((project outcome criterion) <? criteriaCount)",
        "((project openClaim outcome) <? outcomesCount)",
        "(agree (isPassed (project outcome result)) (((project outcome violated) =? 0) && (((project outcome incomplete) =? 0) && (0 <? (project outcome passed)))))",
        "(agree (isUncovered (project outcome result)) ((project outcome rulesMapped) =? 0))",
        "(if (isPassed (project outcome result)) then (claimsAccounted claims rest) else ((claimNames (project outcome index) (project outcome result) claims) && (claimsAccounted (claimRest claims) rest)))",
        "((criterionMatches (project outcome criterion) atSlot (project outcome rulesMapped) table)",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
}

/// `AX-02`: The accessibility catalog declares every criterion, rule, page, reading and outcome, and every digest and tool version
#[test]
fn accessibility_ax_02() {
    let register = read("accessibility/register.json");
    let snapshot = read("accessibility/snapshot.json");
    let catalog = read("app/src/Accessibility.lex.tex");
    let nums = values(section(&register, "criteria"), "num");
    assert_eq!(nums.len(), 87, "every criterion of the WCAG 2.2 source");
    for num in &nums {
        assert!(
            catalog.contains(&format!("num := \"{num}\"")),
            "{num} is declared"
        );
    }
    let rules = values(section(&register, "rules"), "id");
    assert!(!rules.is_empty(), "the axe rules are registered");
    for id in &rules {
        assert!(
            catalog.contains(&format!("name := \"{id}\"")),
            "the rule {id} is declared"
        );
    }
    let pages = section(&register, "pages");
    let urls = values(pages, "url");
    assert!(!urls.is_empty(), "the register holds pages");
    for url in &urls {
        assert!(
            catalog.contains(&format!("url := \"{url}\"")),
            "{url} is declared"
        );
    }
    let fetched = values(pages, "fetchedAt");
    assert_eq!(fetched.len(), urls.len() * 4, "four readings per page");
    for at in &fetched {
        assert!(
            catalog.contains(&format!("fetchedAt := \"{at}\"")),
            "the reading fetched at {at} is declared"
        );
    }
    for digest in values(pages, "sha256").iter().filter(|d| !d.is_empty()) {
        assert!(
            catalog.contains(&format!("digest := \"sha256:{digest}\"")),
            "the document digest {digest} is declared"
        );
    }
    for digest in values(&register, "sha256")
        .iter()
        .filter(|d| !d.is_empty() && !pages.contains(d.as_str()))
    {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the source digest {digest} is declared"
        );
    }
    let version = values(&snapshot, "version")[0].clone();
    let integrity = values(&snapshot, "integrity")[0].clone();
    let browser = values(&snapshot, "browser")[0].clone();
    let playwright = values(&snapshot, "playwright")[0].clone();
    for (field, value) in [
        ("axeVersion", &version),
        ("axeIntegrity", &integrity),
        ("browser", &browser),
        ("playwright", &playwright),
    ] {
        assert!(
            catalog.contains(&format!("{field} := \"{value}\"")),
            "{field} {value} is declared"
        );
    }
    let lock = read("package-lock.json");
    assert!(
        lock.contains(&format!("\"version\": \"{version}\""))
            && lock.contains(&format!("\"integrity\": \"{integrity}\"")),
        "the axe-core that ran is the one package-lock.json pins"
    );
    let outcomes = catalog.matches(&format!("(record {M}::Outcome {{")).count();
    let targeted = section(&register, "criteria")
        .matches("\"targeted\": true")
        .count();
    assert_eq!(targeted, 55, "WCAG 2.2 has 55 Level A and AA criteria");
    assert_eq!(
        outcomes,
        urls.len() * targeted,
        "one outcome per page and targeted criterion"
    );
}

/// `AX-03`: Every outcome that is not a pass is an open claim, never restated as conformance
#[test]
fn accessibility_ax_03() {
    let register = read("accessibility/register.json");
    let catalog = read("app/src/Accessibility.lex.tex");
    let kinds = values(section(&register, "outcomes"), "outcome");
    let open = kinds.iter().filter(|k| *k != "passed").count();
    let declared = catalog
        .matches(&format!("(record {M}::OpenClaim {{"))
        .count();
    assert_eq!(declared, open, "every outcome but a pass is one OpenClaim");
    assert_eq!(
        values(section(&register, "openClaims"), "kind").len(),
        open,
        "the register names each one"
    );
    for kind in ["failed", "needsReview", "passed", "untested", "uncovered"] {
        let n = kinds.iter().filter(|k| *k == kind).count();
        assert!(
            catalog.contains(&format!("{kind}Count := {n}")),
            "the release counts {n} {kind} outcomes"
        );
    }
    let refusals = values(section(&register, "refusals"), "kind");
    assert_eq!(
        refusals
            .iter()
            .filter(|k| *k == "requirement-unreviewed")
            .count(),
        5,
        "each WCAG conformance requirement stays open"
    );
    assert!(
        refusals.iter().any(|k| k == "en-criterion-obsolete"),
        "EN 301 549 9.4.1.1 (WCAG 2.1 4.1.1) stays open"
    );
}
