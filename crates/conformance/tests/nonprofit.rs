//! The `nonprofit` suite: one test per scenario in `features/suites/nonprofit.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a source digest, obligation or open claim in
//! `nonprofit/register.json` missing from `app/src/Nonprofit.lex.tex` fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Nonprofit.V1.Model";

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

/// `NP-01`: The nonprofit register is valid
#[test]
fn nonprofit_np_01() {
    let catalog = read("app/src/Nonprofit.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (sources) (authorities) (posts) (obligations) (citations) (filings) (observations) (statements) (lines) (needs) (openClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    assert!(
        catalog.contains(&format!(
            "jurisdiction := (ctor {M}::Jurisdiction.usCo), nonprofitStatusClaimed := \"Nonprofit501c3\""
        )),
        "the release holds the entity's ISO 3166-2 jurisdiction and its claimed status"
    );
    let model = read("app/src/Foundation/Nonprofit/V1/Model.lex.tex");
    for part in [
        "(obligationsValid 0 (authoritiesTotal authorities) (postsTotal posts) obligations)",
        "(citationsValid 0 (obligationsTotal obligations) (authoritiesTotal authorities) citations)",
        "((project post governanceIndex) =? position)",
        "(authoritiesGovern (project release jurisdiction) authorities)",
        "(((jurisdictionCode law) =? (jurisdictionCode home)) || ((jurisdictionCode law) =? (jurisdictionParent home)))",
        "(obligationsCited authorities citations obligations)",
        "((cites (project obligation index) (project obligation authority) allCitations) && ((bylawsAt allAuthorities (project obligation basis))",
        "(agree (project release recognitionObserved) (0 <? (recognitionMatched observations)))",
        "(claimsNamed (obligationsTotal obligations) (linesTotal lines) (statementsTotal statements) (needsTotal needs) (observationsTotal observations) openClaims)",
        "((project observation matched) <? ((project observation near) + 1))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
}

/// `NP-02`: The nonprofit catalog declares every source digest
#[test]
fn nonprofit_np_02() {
    let register = read("nonprofit/register.json");
    let snapshot = read("nonprofit/snapshot.json");
    let catalog = read("app/src/Nonprofit.lex.tex");
    let digests = values(&register, "digest");
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
    // Every fetch the snapshot made is a source of the register, so none is read unaddressed.
    let fetches = values(&snapshot, "fetchedAt").len();
    let addressed = digests.len() - 5 - 3;
    assert_eq!(
        fetches, addressed,
        "every snapshot fetch is one source: five in-repository inputs and three git documents besides"
    );
}

/// `NP-03`: Undischarged obligations and unanswered lines are open claims
#[test]
fn nonprofit_np_03() {
    let register = read("nonprofit/register.json");
    let catalog = read("app/src/Nonprofit.lex.tex");
    let statuses = values(&register, "status");
    let undischarged = statuses
        .iter()
        .filter(|s| ["undischarged", "unobservable", "undetermined", "active"].contains(&s.as_str()))
        .count();
    let open_lines = statuses.iter().filter(|s| *s == "open").count();
    let unverified = values(&register, "consistency")
        .iter()
        .filter(|c| *c == "unverified" || *c == "pending")
        .count();
    assert!(
        undischarged > 0,
        "the register carries undischarged obligations"
    );
    let kind = |k: &str| {
        catalog
            .matches(&format!("subjectKind := (ctor {M}::SubjectKind.{k})"))
            .count()
    };
    assert_eq!(
        kind("obligation"),
        undischarged,
        "every obligation not discharged is one OpenClaim"
    );
    assert_eq!(
        kind("line"),
        open_lines,
        "every open Part VI line is one OpenClaim"
    );
    assert_eq!(
        kind("need"),
        count(&register, "needs"),
        "every financial need is one OpenClaim"
    );
    assert_eq!(
        kind("statement"),
        unverified,
        "every unverified statement is one OpenClaim"
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
