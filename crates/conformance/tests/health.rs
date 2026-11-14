//! The `health` suite: one test per scenario in `features/suites/health.feature`.
//!
//! `registerValidHolds` in the Health catalog is checked by the Lean kernel when
//! `just vv` runs `prismpm verify` on `app/`. These tests hold fixed what it is
//! about, and that the register, the catalog and every surface are generated:
//! a hand edit anywhere fails the gate.

use std::path::{Path, PathBuf};
use std::process::Command;

const M: &str = "Foundation.Health.V1.Model";

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

fn node(root: &Path, script: &str) -> std::process::Output {
    Command::new("node")
        .arg(root.join(script))
        .arg("--check")
        .output()
        .expect("Node runs the script")
}

fn theorem() -> String {
    let catalog = read("app/src/Health.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    catalog[start..start + catalog[start..].find("\n}").expect("closed")].to_string()
}

/// `HL-01`: Every assessment's answer is its indicator app's compiled answer
#[test]
fn health_hl_01() {
    let theorem = theorem();
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (subjects) (periods) (indicators) (assessments) (evidence) (openClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "it is proved by decide"
    );
    let model = read("app/src/Foundation/Health/V1/Model.lex.tex");
    assert!(
        model.contains("((answerCode (project assessment outcome)) =? (verdict (project assessment model) (project assessment admitted) (project assessment refused)))"),
        "every assessment is checked against its verdict"
    );
    let register = read("health/register.json");
    for app in values(&register, "app") {
        let module: String = app
            .split('-')
            .map(|w| w[..1].to_uppercase() + &w[1..])
            .collect();
        let judge = format!("{}{}Judge", module[..1].to_lowercase(), &module[1..]);
        assert!(
            model.contains(&format!("\\importmodule{{{module}}}")),
            "the health model imports {module}"
        );
        assert!(
            model.contains(&format!("({module}::{judge} (record {module}::{module}Request {{admitted := admitted, refused := refused}}))")),
            "the verdict of {app} is its compiled judge"
        );
    }
}

/// `HL-02`: Every assessment's counts are what its evidence rows admit and refuse
#[test]
fn health_hl_02() {
    let model = read("app/src/Foundation/Health/V1/Model.lex.tex");
    for part in [
        "(tallied indicators assessments evidence 0 0 0 ",
        "((project assessment refused) =? (refused + (project indicator openMembers)))",
        "(floor <=? (prim subtract (project indicator measures) (project indicator openMembers) : Nat))",
        "((above floor rows) && (tallied indicators pending (drop rows) (admitted + (admits rows)) (refused + (refuses rows)) (next rows) more))",
        "(if (done pending) then (exhausted rows) else",
        "(((project evidence values) =? 0) || (1 <=? (project evidence permitted)))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
    let catalog = read("app/src/Health.lex.tex");
    let register = read("health/register.json");
    let assessments = register.matches("\"admitted\":").count();
    let fuel = format!(
        "(tallied indicators assessments evidence 0 0 0 {})",
        assessments + register.matches("\"position\":").count() + 1
    );
    assert!(
        model.contains(&fuel),
        "the walk's fuel covers every assessment and row: {fuel}"
    );
    assert!(
        catalog.contains(&format!("assessmentsCount := {assessments}")),
        "every assessment is declared"
    );
}

/// `HL-03`: The register and catalog are generated, and a hand-edited outcome is refused
#[test]
fn health_hl_03() {
    for script in ["health/project.mjs", "health/catalog.mjs"] {
        let ok = node(&root(), script);
        assert!(
            ok.status.success(),
            "{script}: {}",
            String::from_utf8_lossy(&ok.stderr)
        );
    }

    // The planted defect: a copy of the inputs whose register says one assessment answered otherwise.
    let scratch = std::env::temp_dir().join(format!("health-hl-03-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);
    for dir in ["health", "chaoss", "ecosystem", "observations", "apps"] {
        std::fs::create_dir_all(scratch.join(dir)).expect("a scratch directory");
    }
    for file in [
        "health/project.mjs",
        "chaoss/register.json",
        "ecosystem/register.json",
        "observations/register.json",
    ] {
        std::fs::copy(root().join(file), scratch.join(file)).expect("a copied input");
    }
    for entry in std::fs::read_dir(root().join("apps")).expect("apps") {
        let path = entry.expect("an entry").path();
        std::fs::copy(
            &path,
            scratch.join("apps").join(path.file_name().expect("a name")),
        )
        .expect("a copied prompt");
    }
    let register = read("health/register.json");
    let edited = register.replacen(
        "\"outcome\": \"unmeasured\"",
        "\"outcome\": \"complete\"",
        1,
    );
    assert_ne!(
        edited, register,
        "the register has an unmeasured assessment to edit"
    );
    std::fs::write(scratch.join("health/register.json"), edited).expect("the edit");
    let refused = node(&scratch, "health/project.mjs");
    let _ = std::fs::remove_dir_all(&scratch);
    assert!(
        !refused.status.success(),
        "a hand-edited outcome is refused"
    );
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains("health/register.json"),
        "the refusal names the register: {}",
        String::from_utf8_lossy(&refused.stderr)
    );
}

/// `HL-04`: Every view shows its models' health, and the health page and digest name every indicator
#[test]
fn health_hl_04() {
    let ok = node(&root(), "views/catalog.mjs");
    assert!(
        ok.status.success(),
        "HL-04: {}",
        String::from_utf8_lossy(&ok.stderr)
    );
    let register = read("health/register.json");
    let page = read("site/views/health.html");
    let twin = read("site/views/health.md");
    let digest = read("views/discord.json");
    for slug in values(&register, "slug") {
        let anchor = slug.trim_start_matches("metrics-model-");
        assert!(
            page.contains(&format!("id=\"{anchor}\"")),
            "the health page holds {slug}"
        );
    }
    assert!(
        twin.starts_with("# Community health\n"),
        "the twin is generated"
    );
    assert!(
        digest.contains("\"title\": \"Community health\""),
        "the Discord digest carries health"
    );
    for entry in std::fs::read_dir(root().join("site/views")).expect("site/views") {
        let path = entry.expect("an entry").path();
        let text = std::fs::read_to_string(&path).expect("a page");
        if path.extension().is_some_and(|e| e == "html")
            && text.contains("<h2>Metrics models <span class=\"n\">")
            && !text.contains("<span class=\"n\">0</span></h2>\n<p class=\"none\">No CHAOSS")
        {
            assert!(
                text.contains("Health now: <a href=\"health.html#"),
                "{} shows its models' health",
                path.display()
            );
        }
    }
}

/// `HL-05`: Unreached repositories, models with no indicator and unregistered subjects are open claims
#[test]
fn health_hl_05() {
    let register = read("health/register.json");
    let catalog = read("app/src/Health.lex.tex");
    let reasons = values(&register, "refusal");
    let details = values(&register, "detail");
    assert_eq!(reasons.len(), details.len(), "each refusal has its detail");
    for (reason, detail) in reasons.iter().zip(&details) {
        assert!(
            catalog.contains(&format!("name := \"{detail}\", reason := \"{reason}\"")),
            "the refusal {reason} ({detail}) is an OpenClaim"
        );
    }
}
