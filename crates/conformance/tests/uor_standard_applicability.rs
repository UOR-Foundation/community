//! The `uor_standard_applicability` suite: one test per scenario in `features/suites/uor_standard_applicability.feature`.
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
    let model = module("app/src/UorStandardApplicabilityProofs.lex.tex");
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

/// `USA-01`: The app never answers applicable when owner is security and inscope is yes
#[test]
fn uor_standard_applicability_usa_01() {
    pinned(
        "breaksInv001",
        "body: (((((((((((project request owner) <? 2) && ((project request scope) <? 2)) && ((project request inscope) <? 2)) && ((project request force) <? 2)) && ((project request jurisdiction) <? 3)) && ((project request activity) <? 3)) && ((project request adopted) <? 2)) && ((project request owner) =? (UorStandardApplicability::uorStandardApplicabilityOwnerSecurity))) && ((project request inscope) =? (UorStandardApplicability::uorStandardApplicabilityInscopeYes))) && ((UorStandardApplicability::uorStandardApplicabilityJudge request) =? (UorStandardApplicability::uorStandardApplicabilityAnswerApplicable)))",
        "inv001Holds",
    );
}

/// `USA-02`: The app always answers undecided when owner is standards and scope is unread
#[test]
fn uor_standard_applicability_usa_02() {
    pinned(
        "breaksInv002",
        "body: (((((((((((project request owner) <? 2) && ((project request scope) <? 2)) && ((project request inscope) <? 2)) && ((project request force) <? 2)) && ((project request jurisdiction) <? 3)) && ((project request activity) <? 3)) && ((project request adopted) <? 2)) && ((project request owner) =? (UorStandardApplicability::uorStandardApplicabilityOwnerStandards))) && ((project request scope) =? (UorStandardApplicability::uorStandardApplicabilityScopeUnread))) && (not ((UorStandardApplicability::uorStandardApplicabilityJudge request) =? (UorStandardApplicability::uorStandardApplicabilityAnswerUndecided))))",
        "inv002Holds",
    );
}

/// `USA-03`: The app always answers inapplicable when owner is standards and scope is quoted and inscope is yes and force is law and jurisdiction is foreign
#[test]
fn uor_standard_applicability_usa_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((((((((project request owner) <? 2) && ((project request scope) <? 2)) && ((project request inscope) <? 2)) && ((project request force) <? 2)) && ((project request jurisdiction) <? 3)) && ((project request activity) <? 3)) && ((project request adopted) <? 2)) && ((project request owner) =? (UorStandardApplicability::uorStandardApplicabilityOwnerStandards))) && ((project request scope) =? (UorStandardApplicability::uorStandardApplicabilityScopeQuoted))) && ((project request inscope) =? (UorStandardApplicability::uorStandardApplicabilityInscopeYes))) && ((project request force) =? (UorStandardApplicability::uorStandardApplicabilityForceLaw))) && ((project request jurisdiction) =? (UorStandardApplicability::uorStandardApplicabilityJurisdictionForeign))) && (not ((UorStandardApplicability::uorStandardApplicabilityJudge request) =? (UorStandardApplicability::uorStandardApplicabilityAnswerInapplicable))))",
        "inv003Holds",
    );
}

/// `USA-04`: The app never answers inapplicable when owner is standards and scope is quoted and inscope is yes and force is law and jurisdiction is own and activity is undetermined
#[test]
fn uor_standard_applicability_usa_04() {
    pinned(
        "breaksInv004",
        "body: (((((((((((((((project request owner) <? 2) && ((project request scope) <? 2)) && ((project request inscope) <? 2)) && ((project request force) <? 2)) && ((project request jurisdiction) <? 3)) && ((project request activity) <? 3)) && ((project request adopted) <? 2)) && ((project request owner) =? (UorStandardApplicability::uorStandardApplicabilityOwnerStandards))) && ((project request scope) =? (UorStandardApplicability::uorStandardApplicabilityScopeQuoted))) && ((project request inscope) =? (UorStandardApplicability::uorStandardApplicabilityInscopeYes))) && ((project request force) =? (UorStandardApplicability::uorStandardApplicabilityForceLaw))) && ((project request jurisdiction) =? (UorStandardApplicability::uorStandardApplicabilityJurisdictionOwn))) && ((project request activity) =? (UorStandardApplicability::uorStandardApplicabilityActivityUndetermined))) && ((UorStandardApplicability::uorStandardApplicabilityJudge request) =? (UorStandardApplicability::uorStandardApplicabilityAnswerInapplicable)))",
        "inv004Holds",
    );
}

/// `USA-05`: The app always answers mandatory when owner is standards and scope is quoted and inscope is yes and force is law and jurisdiction is own and activity is present
#[test]
fn uor_standard_applicability_usa_05() {
    pinned(
        "breaksInv005",
        "body: (((((((((((((((project request owner) <? 2) && ((project request scope) <? 2)) && ((project request inscope) <? 2)) && ((project request force) <? 2)) && ((project request jurisdiction) <? 3)) && ((project request activity) <? 3)) && ((project request adopted) <? 2)) && ((project request owner) =? (UorStandardApplicability::uorStandardApplicabilityOwnerStandards))) && ((project request scope) =? (UorStandardApplicability::uorStandardApplicabilityScopeQuoted))) && ((project request inscope) =? (UorStandardApplicability::uorStandardApplicabilityInscopeYes))) && ((project request force) =? (UorStandardApplicability::uorStandardApplicabilityForceLaw))) && ((project request jurisdiction) =? (UorStandardApplicability::uorStandardApplicabilityJurisdictionOwn))) && ((project request activity) =? (UorStandardApplicability::uorStandardApplicabilityActivityPresent))) && (not ((UorStandardApplicability::uorStandardApplicabilityJudge request) =? (UorStandardApplicability::uorStandardApplicabilityAnswerMandatory))))",
        "inv005Holds",
    );
}
