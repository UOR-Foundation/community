//! The `uor_remediation_lifecycle` suite: one test per scenario in `features/suites/uor_remediation_lifecycle.feature`.
//!
//! Written by the Prism-DevRel builder from the app's prompt. The theorems are
//! checked by the Lean kernel when `just vv` runs `prismpm verify` on `app/`.
//! What these tests hold fixed is what each theorem is about, so a weakened
//! statement that still verifies fails the gate.

use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/conformance is two below the root")
        .to_path_buf()
}

/// The body of the top-level declaration named `name`, up to its closing brace.
fn declaration<'a>(model: &'a str, name: &str) -> &'a str {
    let start = model
        .find(&format!("\n  name: {name},\n"))
        .unwrap_or_else(|| panic!("{name} is not declared"));
    let end = model[start..]
        .find("\n}\n")
        .unwrap_or_else(|| panic!("{name} is not closed"));
    &model[start..start + end]
}

fn module(path: &str) -> String {
    std::fs::read_to_string(root().join(path)).expect("the module")
}

/// The condition no request may meet, and the theorem that says none does.
fn pinned(breaks: &str, condition: &str, theorem: &str) {
    let model = module("app/src/UorRemediationLifecycleProofs.lex.tex");
    let found = declaration(&model, breaks);
    assert!(
        found.contains(condition),
        "the condition of {breaks} changed:\n{found}"
    );
    let holds = declaration(&model, theorem);
    let statement = format!("statement: (({breaks} request) = false),");
    assert!(
        holds.contains(&statement),
        "{theorem} must state that no request meets {breaks}:\n{holds}"
    );
}

/// `URL-01`: The app never answers opened when step is observed and approval is none
#[test]
fn uor_remediation_lifecycle_url_01() {
    pinned(
        "breaksInv001",
        "body: (((((((((project request step) <? 7) && ((project request approval) <? 2)) && ((project request pr) <? 4)) && ((project request settings) <? 2)) && ((project request outcome) <? 3)) && ((project request step) =? (UorRemediationLifecycle::uorRemediationLifecycleStepObserved))) && ((project request approval) =? (UorRemediationLifecycle::uorRemediationLifecycleApprovalNone))) && ((UorRemediationLifecycle::uorRemediationLifecycleJudge request) =? (UorRemediationLifecycle::uorRemediationLifecycleAnswerOpened)))",
        "inv001Holds",
    );
}

/// `URL-02`: The app never answers conformant when step is merged and outcome is conformant
#[test]
fn uor_remediation_lifecycle_url_02() {
    pinned(
        "breaksInv002",
        "body: (((((((((project request step) <? 7) && ((project request approval) <? 2)) && ((project request pr) <? 4)) && ((project request settings) <? 2)) && ((project request outcome) <? 3)) && ((project request step) =? (UorRemediationLifecycle::uorRemediationLifecycleStepMerged))) && ((project request outcome) =? (UorRemediationLifecycle::uorRemediationLifecycleOutcomeConformant))) && ((UorRemediationLifecycle::uorRemediationLifecycleJudge request) =? (UorRemediationLifecycle::uorRemediationLifecycleAnswerConformant)))",
        "inv002Holds",
    );
}

/// `URL-03`: The app always answers declined when step is declined
#[test]
fn uor_remediation_lifecycle_url_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((project request step) <? 7) && ((project request approval) <? 2)) && ((project request pr) <? 4)) && ((project request settings) <? 2)) && ((project request outcome) <? 3)) && ((project request step) =? (UorRemediationLifecycle::uorRemediationLifecycleStepDeclined))) && (not ((UorRemediationLifecycle::uorRemediationLifecycleJudge request) =? (UorRemediationLifecycle::uorRemediationLifecycleAnswerDeclined))))",
        "inv003Holds",
    );
}

/// `URL-04`: The app never answers conformant when step is applied and outcome is unobserved
#[test]
fn uor_remediation_lifecycle_url_04() {
    pinned(
        "breaksInv004",
        "body: (((((((((project request step) <? 7) && ((project request approval) <? 2)) && ((project request pr) <? 4)) && ((project request settings) <? 2)) && ((project request outcome) <? 3)) && ((project request step) =? (UorRemediationLifecycle::uorRemediationLifecycleStepApplied))) && ((project request outcome) =? (UorRemediationLifecycle::uorRemediationLifecycleOutcomeUnobserved))) && ((UorRemediationLifecycle::uorRemediationLifecycleJudge request) =? (UorRemediationLifecycle::uorRemediationLifecycleAnswerConformant)))",
        "inv004Holds",
    );
}

/// `URL-05`: The app always answers conformant when step is conformant
#[test]
fn uor_remediation_lifecycle_url_05() {
    pinned(
        "breaksInv005",
        "body: ((((((((project request step) <? 7) && ((project request approval) <? 2)) && ((project request pr) <? 4)) && ((project request settings) <? 2)) && ((project request outcome) <? 3)) && ((project request step) =? (UorRemediationLifecycle::uorRemediationLifecycleStepConformant))) && (not ((UorRemediationLifecycle::uorRemediationLifecycleJudge request) =? (UorRemediationLifecycle::uorRemediationLifecycleAnswerConformant))))",
        "inv005Holds",
    );
}

/// `URL-06`: The app always answers declined when step is declined
#[test]
fn uor_remediation_lifecycle_url_06() {
    pinned(
        "breaksInv006",
        "body: ((((((((project request step) <? 7) && ((project request approval) <? 2)) && ((project request pr) <? 4)) && ((project request settings) <? 2)) && ((project request outcome) <? 3)) && ((project request step) =? (UorRemediationLifecycle::uorRemediationLifecycleStepDeclined))) && (not ((UorRemediationLifecycle::uorRemediationLifecycleJudge request) =? (UorRemediationLifecycle::uorRemediationLifecycleAnswerDeclined))))",
        "inv006Holds",
    );
}
