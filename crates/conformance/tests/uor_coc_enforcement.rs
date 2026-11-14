//! The `uor_coc_enforcement` suite: one test per scenario in `features/suites/uor_coc_enforcement.feature`.
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
    let model = module("app/src/UorCocEnforcementProofs.lex.tex");
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

/// `UCE-01`: The app never answers banned when authority is other and record is clear
#[test]
fn uor_coc_enforcement_uce_01() {
    pinned(
        "breaksInv001",
        "body: ((((((((project request record2) <? 5) && ((project request finding) <? 3)) && ((project request severity) <? 4)) && ((project request authority) <? 3)) && ((project request authority) =? (UorCocEnforcement::uorCocEnforcementAuthorityOther))) && ((project request record2) =? (UorCocEnforcement::uorCocEnforcementRecord2Clear))) && ((UorCocEnforcement::uorCocEnforcementJudge request) =? (UorCocEnforcement::uorCocEnforcementAnswerBanned)))",
        "inv001Holds",
    );
}

/// `UCE-02`: The app never answers warned when finding is pending and record is clear
#[test]
fn uor_coc_enforcement_uce_02() {
    pinned(
        "breaksInv002",
        "body: ((((((((project request record2) <? 5) && ((project request finding) <? 3)) && ((project request severity) <? 4)) && ((project request authority) <? 3)) && ((project request finding) =? (UorCocEnforcement::uorCocEnforcementFindingPending))) && ((project request record2) =? (UorCocEnforcement::uorCocEnforcementRecord2Clear))) && ((UorCocEnforcement::uorCocEnforcementJudge request) =? (UorCocEnforcement::uorCocEnforcementAnswerWarned)))",
        "inv002Holds",
    );
}

/// `UCE-03`: The app never answers limited when finding is none and record is warned
#[test]
fn uor_coc_enforcement_uce_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((project request record2) <? 5) && ((project request finding) <? 3)) && ((project request severity) <? 4)) && ((project request authority) <? 3)) && ((project request finding) =? (UorCocEnforcement::uorCocEnforcementFindingNone))) && ((project request record2) =? (UorCocEnforcement::uorCocEnforcementRecord2Warned))) && ((UorCocEnforcement::uorCocEnforcementJudge request) =? (UorCocEnforcement::uorCocEnforcementAnswerLimited)))",
        "inv003Holds",
    );
}

/// `UCE-04`: The app never answers warned when record is limited
#[test]
fn uor_coc_enforcement_uce_04() {
    pinned(
        "breaksInv004",
        "body: (((((((project request record2) <? 5) && ((project request finding) <? 3)) && ((project request severity) <? 4)) && ((project request authority) <? 3)) && ((project request record2) =? (UorCocEnforcement::uorCocEnforcementRecord2Limited))) && ((UorCocEnforcement::uorCocEnforcementJudge request) =? (UorCocEnforcement::uorCocEnforcementAnswerWarned)))",
        "inv004Holds",
    );
}

/// `UCE-05`: The app never answers clear when record is suspended
#[test]
fn uor_coc_enforcement_uce_05() {
    pinned(
        "breaksInv005",
        "body: (((((((project request record2) <? 5) && ((project request finding) <? 3)) && ((project request severity) <? 4)) && ((project request authority) <? 3)) && ((project request record2) =? (UorCocEnforcement::uorCocEnforcementRecord2Suspended))) && ((UorCocEnforcement::uorCocEnforcementJudge request) =? (UorCocEnforcement::uorCocEnforcementAnswerClear)))",
        "inv005Holds",
    );
}

/// `UCE-06`: The app always answers banned when finding is violation and authority is moderators and severity is severe
#[test]
fn uor_coc_enforcement_uce_06() {
    pinned(
        "breaksInv006",
        "body: (((((((((project request record2) <? 5) && ((project request finding) <? 3)) && ((project request severity) <? 4)) && ((project request authority) <? 3)) && ((project request finding) =? (UorCocEnforcement::uorCocEnforcementFindingViolation))) && ((project request authority) =? (UorCocEnforcement::uorCocEnforcementAuthorityModerators))) && ((project request severity) =? (UorCocEnforcement::uorCocEnforcementSeveritySevere))) && (not ((UorCocEnforcement::uorCocEnforcementJudge request) =? (UorCocEnforcement::uorCocEnforcementAnswerBanned))))",
        "inv006Holds",
    );
}

/// `UCE-07`: The app always answers banned when record is banned
#[test]
fn uor_coc_enforcement_uce_07() {
    pinned(
        "breaksInv007",
        "body: (((((((project request record2) <? 5) && ((project request finding) <? 3)) && ((project request severity) <? 4)) && ((project request authority) <? 3)) && ((project request record2) =? (UorCocEnforcement::uorCocEnforcementRecord2Banned))) && (not ((UorCocEnforcement::uorCocEnforcementJudge request) =? (UorCocEnforcement::uorCocEnforcementAnswerBanned))))",
        "inv007Holds",
    );
}
