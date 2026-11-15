//! The `security` suite: one test per scenario in `features/suites/security.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a subcategory, table cell, technique, pinned
//! source, open claim or indicator in `security/register.json` missing from
//! `app/src/SecurityRegister.lex.tex` fails the gate.

use std::path::PathBuf;

const MODEL: &str = "app/src/Foundation/Security/V1/Model.lex.tex";
const CATALOG: &str = "app/src/SecurityRegister.lex.tex";
const REGISTER: &str = "security/register.json";
const SOURCES: &str = "security/sources.json";

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

/// Every string value of `key` in a JSON text, in order.
fn values(json: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\": \"");
    json.match_indices(&needle)
        .map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            rest[..rest.find('"').expect("a closed string")].to_string()
        })
        .collect()
}

/// The text of one definition or theorem named `name` in `text`.
fn declaration<'a>(text: &'a str, name: &str) -> &'a str {
    let start = text
        .find(&format!("\n  name: {name},\n"))
        .unwrap_or_else(|| panic!("{name} is declared"));
    &text[start..start + text[start..].find("\n}\n").expect("closed")]
}

/// `SE-01`: The Foundation security register is valid
#[test]
fn security_se_01() {
    let catalog = read(CATALOG);
    let theorem = declaration(&catalog, "registerValidHolds");
    assert!(
        theorem.contains("statement: ((Foundation.Security.V1.Model::registerValid (release) (csfFunctions) (csfCategories) (subcategories) (cells) (techniques) (scorecardChecks) (threatSources) (elements) (controls) (threats) (threatControls) (threatTechniques) (evidence) (outcomes) (gaps) (strideSlots) (linddunSlots) (indicators) (openClaims)) = true),"),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read(MODEL);
    let valid = declaration(&model, "registerValid");
    for part in [
        "(threatsRated cells threats)",
        "(threatsControlled threats threatControls)",
        "(threatsTechniqued threats threatTechniques)",
        "(controlsEvidenced controls evidence)",
        "(subcategoriesAnswered subcategories outcomes gaps)",
        "(strideWalk elements 0 strideSlots)",
        "(linddunWalk elements 0 linddunSlots)",
        "((subcategoriesTotal subcategories) =? 106)",
        "((cellsTotal cells) =? 50)",
    ] {
        assert!(valid.contains(part), "registerValid still checks {part}");
    }
    // STRIDE per element: the applicability the walk reads is Microsoft SDL's.
    let applies = declaration(&model, "strideApplies");
    for arm in [
        "| ElementKind.externalEntity => ((category =? 0) || (category =? 2))",
        "| ElementKind.process => (category <? 6)",
        "| ElementKind.dataStore => ((0 <? category) && (category <? 5))",
        "| ElementKind.dataFlow => ((category =? 1) || ((category =? 3) || (category =? 4)))",
    ] {
        assert!(applies.contains(arm), "strideApplies keeps {arm}");
    }
    let technique = declaration(&model, "techniquesValid");
    assert!(
        technique.contains("(not (project technique revoked))")
            && technique.contains("(not (project technique deprecated))"),
        "no technique may be revoked or deprecated"
    );
}

/// `SE-02`: The catalog is the projection against the pinned standards
#[test]
fn security_se_02() {
    let register = read(REGISTER);
    let catalog = read(CATALOG);
    let sources = read(SOURCES);
    for digest in values(&sources, "sha256") {
        assert!(
            catalog.contains(&format!("#sha256:{digest}")),
            "the pinned source {digest} is declared"
        );
    }
    for commit in values(&sources, "commit") {
        assert!(
            catalog.contains(&commit),
            "the pinned commit {commit} is declared"
        );
    }
    for (kind, count) in [
        ("CsfFunction", 6),
        ("CsfCategory", 22),
        ("Subcategory", 106),
        ("Cell", 50),
        ("ScorecardCheck", 20),
    ] {
        assert_eq!(
            catalog
                .matches(&format!("(record Foundation.Security.V1.Model::{kind} {{"))
                .count(),
            count,
            "every {kind} is declared"
        );
    }
    let start = register.find("\"techniques\": [").expect("techniques");
    let end = start + register[start..].find("\n ],").expect("closed");
    let techniques = values(&register[start..end], "id");
    assert!(!techniques.is_empty(), "the register names techniques");
    for id in techniques {
        assert!(
            catalog.contains(&format!("code := \"{id}\"")),
            "the technique {id} is declared"
        );
    }
}

/// `SE-03`: Open claims and indicators are carried, never asserted
#[test]
fn security_se_03() {
    let register = read(REGISTER);
    let catalog = read(CATALOG);
    let start = register.find("\"openClaims\": [").expect("open claims");
    let claims = values(&register[start..], "id");
    assert!(claims.len() >= 5, "the assessment carries its open claims");
    assert_eq!(
        catalog
            .matches("(record Foundation.Security.V1.Model::OpenClaim {")
            .count(),
        claims.len(),
        "every open claim is one OpenClaim"
    );
    assert!(
        catalog.contains(&format!("openClaimsCount := {}", claims.len())),
        "the release counts every open claim"
    );
    let start = register.find("\"indicators\": [").expect("indicators");
    let end = start + register[start..].find("\n ],").expect("closed");
    let indicators = values(&register[start..end], "id");
    assert_eq!(
        catalog
            .matches("(record Foundation.Security.V1.Model::Indicator {")
            .count(),
        indicators.len(),
        "every indicator is one Indicator"
    );
    for text in values(&register[start..end], "text") {
        assert!(
            !text.contains("attributed to"),
            "an indicator never attributes: {text}"
        );
    }
}
