//! The `standards` suite: one test per scenario in `features/suites/standards.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a part, standard, decision, digest or open
//! claim in `standards/register.json` missing from `app/src/Standards.lex.tex`,
//! or a gap missing from `standards/workstreams.md`, fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Standards.V1.Model";
const APPLICABLE: [&str; 5] = [
    "secured",
    "conditional",
    "mandatory",
    "adopted",
    "applicable",
];

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

/// The text of the register's top-level array `key`.
fn section<'a>(json: &'a str, key: &str) -> &'a str {
    let start = json
        .find(&format!("\n  \"{key}\": ["))
        .unwrap_or_else(|| panic!("the register has {key}"));
    let rest = &json[start + 1..];
    &rest[..rest.find("\n  ]").expect("a closed array")]
}

/// `ST-01`: The standards register is valid
#[test]
fn standards_st_01() {
    let catalog = read("app/src/Standards.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (facets) (checks) (parts) (standards) (decisions) (openClaims) (scopeClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Standards/V1/Model.lex.tex");
    for part in [
        "(decisionsOrdered decisions 0 0)",
        "(partsCovered decisions 0 false (partsTotal parts))",
        "(claimsMatch openClaims decisions)",
        "(implementedFaceted facets checks decisions)",
        "((outcomeCode (project decision outcome)) =? (decideApplicability (project decision owner) (project decision scope) (project decision inscope) (project decision force) (project decision jurisdiction) (project decision activity) (project decision adopted)))",
        "(agree (outcomeApplicable (project decision outcome)) (not (statusIsUnrated (project decision status))))",
        "(if (outcomeIsSecured (project decision outcome)) then (ownerIsSecurity (project decision owner)) else true)",
        "(if (statusIsImplemented (project decision status)) then (0 <? (project decision check)) else true)",
        "((facetPresentAt allFacets (project decision facet)) && ((checkFacetAt allChecks (project decision check)) =? (project decision facet)))",
        "((claimHeadIs claimList (project decision index) (ownerCode (project decision owner))) && (claimsMatch (claimTail claimList) rest))",
        "((applicableTotal decisions) =? (project release applicableCount))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
    // The table is the app's: one branch per rule, in the prompt's order.
    let prompt = read("apps/uor-standard-applicability.prompt.json");
    let table = &prompt[prompt.find("\"rules\": [").expect("the app's rules")..];
    let rules = table[..table.find("\"otherwise\":").expect("the otherwise answer")]
        .matches("\"then\": ")
        .count();
    let body = &model[model
        .find("name: decideApplicability,")
        .expect("the table is declared")..];
    let body = &body[..body.find("\n}").expect("closed")];
    assert_eq!(
        body.matches("(if ").count(),
        rules,
        "decideApplicability has one branch per rule of the app"
    );
}

/// `ST-02`: The standards catalog declares every part, standard, decision and digest
#[test]
fn standards_st_02() {
    let register = read("standards/register.json");
    let catalog = read("app/src/Standards.lex.tex");
    let parts = section(&register, "parts");
    let standards = section(&register, "standards");
    for id in values(parts, "id") {
        assert!(
            catalog.contains(&format!("identifier := \"{id}\"")),
            "the part {id} is declared"
        );
    }
    let ids = values(standards, "id");
    assert!(ids.len() > 50, "the register holds the candidate standards");
    for id in &ids {
        assert!(
            catalog.contains(&format!("identifier := \"{id}\"")),
            "the standard {id} is declared"
        );
    }
    for digest in values(standards, "sha256")
        .into_iter()
        .filter(|d| !d.is_empty())
    {
        assert!(
            catalog.contains(&format!("digest := \"sha256:{digest}\"")),
            "the issuer page sha256:{digest} is declared"
        );
    }
    for digest in values(section(&register, "inputs"), "sha256") {
        assert!(
            catalog.contains(&format!("#sha256:{digest}")),
            "the input sha256:{digest} is declared"
        );
    }
    let security = &register[register
        .find("\n  \"security\": {")
        .expect("the security table")..];
    let digest = &values(security, "sha256")[0];
    assert!(
        catalog.contains(&format!("#sha256:{digest}")),
        "the security facet's table is addressed"
    );
    let decisions = values(section(&register, "decisions"), "outcome").len();
    assert_eq!(
        catalog
            .matches(&format!("(record {M}::Decision {{"))
            .count(),
        decisions,
        "every decided pair is one Decision"
    );
    assert!(
        catalog.contains(&format!("decisionsCount := {decisions}")),
        "the release counts every decision"
    );
}

/// `ST-03`: Every gap is an open claim and belongs to a workstream
#[test]
fn standards_st_03() {
    let register = read("standards/register.json");
    let catalog = read("app/src/Standards.lex.tex");
    let workstreams = read("standards/workstreams.md");
    let decisions = section(&register, "decisions");
    let outcomes = values(decisions, "outcome");
    let statuses = values(decisions, "status");
    assert_eq!(outcomes.len(), statuses.len(), "every pair has one status");
    let gaps = outcomes
        .iter()
        .zip(&statuses)
        .filter(|(o, s)| {
            *o == "undecided" || (APPLICABLE.contains(&o.as_str()) && *s != "implemented")
        })
        .count();
    for (o, s) in outcomes.iter().zip(&statuses) {
        assert_eq!(
            APPLICABLE.contains(&o.as_str()),
            s != "unrated",
            "an applicable pair, and only one, has a status"
        );
    }
    assert!(gaps > 0, "the register carries its gaps");
    assert_eq!(
        catalog
            .matches(&format!("(record {M}::OpenClaim {{"))
            .count(),
        gaps,
        "every gap is one OpenClaim"
    );
    assert!(
        catalog.contains(&format!("openClaimsCount := {gaps}")),
        "the release counts every open claim"
    );
    let claimed = values(section(&register, "workstreams"), "id");
    assert!(!claimed.is_empty(), "the gaps are grouped into workstreams");
    for id in claimed {
        assert!(
            workstreams.contains(&format!("`{id}`")),
            "the workstream {id} is written to standards/workstreams.md"
        );
    }
}
