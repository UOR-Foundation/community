//! The `chaoss` suite: one test per scenario in `features/suites/chaoss.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a slug, digest or open claim in
//! `chaoss/register.json` missing from `app/src/Chaoss.lex.tex` fails the gate.

use std::path::PathBuf;

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

/// `CC-01`: The CHAOSS register is valid
#[test]
fn chaoss_cc_01() {
    let catalog = read("app/src/Chaoss.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}\n").expect("closed")];
    assert!(theorem.contains("statement: ((Foundation.Community.V1.Model::registerValid (release) (metrics) (models) (openClaims)) = true),"), "registerValidHolds is about the whole register:\n{theorem}");
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Community/V1/Model.lex.tex");
    for part in [
        "(metricsNumbered 0 metrics)",
        "(modelsNumbered 0 models)",
        "(modelsWellFormed (metricTotal metrics) models)",
        "(claimsNumbered 0 (modelTotal models) claims)",
        "((claimTotal claims) =? (project release openClaimCount))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
}

/// `CC-02`: The CHAOSS catalog declares every metric and metrics model with its source digest
#[test]
fn chaoss_cc_02() {
    let register = read("chaoss/register.json");
    let catalog = read("app/src/Chaoss.lex.tex");
    let slugs = values(&register, "slug");
    let digests = values(&register, "sha256");
    assert!(
        slugs.len() >= 117,
        "the register holds every released metric and model, and its refusals"
    );
    for slug in &slugs {
        assert!(
            catalog.contains(&format!("slug := \"{slug}\"")),
            "{slug} is declared in the catalog"
        );
    }
    for digest in &digests {
        assert!(
            catalog.contains(&format!("sourceDigest := \"sha256:{digest}\"")),
            "the digest {digest} is declared"
        );
    }
}

/// `CC-03`: An unmatched released item is an open claim
#[test]
fn chaoss_cc_03() {
    let register = read("chaoss/register.json");
    let catalog = read("app/src/Chaoss.lex.tex");
    let refusals = values(&register, "refusal");
    let declared = catalog
        .matches("(record Foundation.Community.V1.Model::OpenClaim {")
        .count();
    assert_eq!(declared, refusals.len(), "every refusal is one OpenClaim");
    assert!(
        catalog.contains(&format!("openClaimCount := {}", refusals.len())),
        "the release counts every open claim"
    );
}

/// The value of every `"key": <number>` in `json`, in order.
fn numbers(json: &str, key: &str) -> Vec<usize> {
    let needle = format!("\"{key}\": ");
    json.match_indices(&needle)
        .filter_map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            let end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            rest[..end].parse().ok()
        })
        .collect()
}

/// `CC-04`: Every CHAOSS metric and metrics model has a complete ISO/IEC 15939 mapping
#[test]
fn chaoss_cc_04() {
    let theorem = |path: &str, name: &str| {
        let text = read(path);
        let start = text
            .find(&format!("\n  name: {name},\n"))
            .unwrap_or_else(|| panic!("{name} is declared in {path}"));
        let end = start + text[start..].find("\n}").expect("closed");
        text[start..end].to_string()
    };
    let holds = theorem("app/src/Measures.lex.tex", "measuresValidHolds");
    assert!(
        holds.contains("statement: ((measuresValid) = true),") && holds.contains("proof: decide{}"),
        "measuresValidHolds is proved by decide:\n{holds}"
    );
    let mapped = theorem("app/src/MeasurementMapping.lex.tex", "registerValidHolds");
    assert!(
        mapped.contains("proof: decide{}"),
        "the mapping register is proved valid by decide"
    );
    let measures = read("app/src/Measures.lex.tex");
    for part in [
        "((project (MeasurementMapping::release) metricCount) =? (project (Chaoss::release) metricCount))",
        "((project (MeasurementMapping::release) itemsCount) =? ((project (Chaoss::release) metricCount) + (project (Chaoss::release) modelCount)))",
        "(conceptsNumbered 0 (needTotal (needs)) (concepts))",
    ] {
        assert!(measures.contains(part), "measuresValid still checks {part}");
    }
    let facet = read("app/src/Foundation/Community/V1/Measurement.lex.tex");
    for part in [
        "(planned (project release metricCount) (project release itemsCount) 0 0 mappings)",
        "((step + 1) =? 7)",
        "((step + 1) =? 6)",
        "((statedTotal mappings) =? (project release statedCount))",
    ] {
        assert!(facet.contains(part), "registerValid still checks {part}");
    }
    // Every item is the register's, in its order, and every stated element cites a digest.
    let register = read("chaoss/register.json");
    let mapping = read("chaoss/measurement.json");
    let catalog = read("app/src/MeasurementMapping.lex.tex");
    let slugs = values(&register, "slug");
    let mapped = values(&mapping, "slug");
    let released = slugs.len() - values(&register, "refusal").len();
    assert_eq!(
        &mapped[..],
        &slugs[..released],
        "the mapping lists every metric and model in register order"
    );
    for slug in &mapped {
        assert!(
            catalog.contains(&format!("slug := \"{slug}\"")),
            "{slug} is mapped"
        );
    }
    let digests = values(&mapping, "digest");
    let stated = numbers(&mapping, "stated")[0];
    assert_eq!(digests.len(), stated, "every stated element has a digest");
    for digest in &digests {
        assert!(
            digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit()),
            "{digest} is a sha256"
        );
        assert!(
            catalog.contains(&format!("evidence := \"sha256:{digest}\"")),
            "the digest {digest} is declared"
        );
    }
    assert!(
        catalog.contains(&format!("statedCount := {stated}")),
        "the release counts every stated element"
    );
}

/// `CC-05`: An element CHAOSS does not carry is an open claim with its reason
#[test]
fn chaoss_cc_05() {
    let mapping = read("chaoss/measurement.json");
    let catalog = read("app/src/MeasurementMapping.lex.tex");
    let reasons = values(&mapping, "reason");
    let open = numbers(&mapping, "open")[0];
    assert_eq!(reasons.len(), open, "every open element names its reason");
    for reason in &reasons {
        assert!(
            [
                "no-template-section",
                "section-absent",
                "section-ambiguous",
                "section-empty"
            ]
            .contains(&reason.as_str()),
            "{reason} is a typed refusal"
        );
        assert!(
            catalog.contains(&format!("evidence := \"{reason}\"")),
            "{reason} is declared"
        );
    }
    assert_eq!(
        catalog.matches("stated := false").count(),
        open,
        "every open element is a Mapping that is not stated"
    );
}
