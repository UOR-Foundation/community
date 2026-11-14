//! The `uor_observation_admission` suite: one test per scenario in `features/suites/uor_observation_admission.feature`.
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
    let model = module("app/src/UorObservationAdmissionProofs.lex.tex");
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

/// `UOA-01`: The app never answers permit when metric is unreleased
#[test]
fn uor_observation_admission_uoa_01() {
    pinned(
        "breaksInv001",
        "body: (((((((((project request metric) <? 2) && ((project request oracle) <? 3)) && ((project request source) <? 2)) && ((project request replay) <? 3)) && ((project request collection) <? 5)) && ((project request attribution) <? 5)) && ((project request metric) =? (UorObservationAdmission::uorObservationAdmissionMetricUnreleased))) && ((UorObservationAdmission::uorObservationAdmissionJudge request) =? (UorObservationAdmission::uorObservationAdmissionAnswerPermit)))",
        "inv001Holds",
    );
}

/// `UOA-02`: The app never answers permit when oracle is not covers
#[test]
fn uor_observation_admission_uoa_02() {
    pinned(
        "breaksInv002",
        "body: (((((((((project request metric) <? 2) && ((project request oracle) <? 3)) && ((project request source) <? 2)) && ((project request replay) <? 3)) && ((project request collection) <? 5)) && ((project request attribution) <? 5)) && (not ((project request oracle) =? (UorObservationAdmission::uorObservationAdmissionOracleCovers)))) && ((UorObservationAdmission::uorObservationAdmissionJudge request) =? (UorObservationAdmission::uorObservationAdmissionAnswerPermit)))",
        "inv002Holds",
    );
}

/// `UOA-03`: The app never answers permit when source is unpinned
#[test]
fn uor_observation_admission_uoa_03() {
    pinned(
        "breaksInv003",
        "body: (((((((((project request metric) <? 2) && ((project request oracle) <? 3)) && ((project request source) <? 2)) && ((project request replay) <? 3)) && ((project request collection) <? 5)) && ((project request attribution) <? 5)) && ((project request source) =? (UorObservationAdmission::uorObservationAdmissionSourceUnpinned))) && ((UorObservationAdmission::uorObservationAdmissionJudge request) =? (UorObservationAdmission::uorObservationAdmissionAnswerPermit)))",
        "inv003Holds",
    );
}

/// `UOA-04`: The app never answers permit when replay is not reproduced
#[test]
fn uor_observation_admission_uoa_04() {
    pinned(
        "breaksInv004",
        "body: (((((((((project request metric) <? 2) && ((project request oracle) <? 3)) && ((project request source) <? 2)) && ((project request replay) <? 3)) && ((project request collection) <? 5)) && ((project request attribution) <? 5)) && (not ((project request replay) =? (UorObservationAdmission::uorObservationAdmissionReplayReproduced)))) && ((UorObservationAdmission::uorObservationAdmissionJudge request) =? (UorObservationAdmission::uorObservationAdmissionAnswerPermit)))",
        "inv004Holds",
    );
}

/// `UOA-05`: The app never answers permit when collection is deny
#[test]
fn uor_observation_admission_uoa_05() {
    pinned(
        "breaksInv005",
        "body: (((((((((project request metric) <? 2) && ((project request oracle) <? 3)) && ((project request source) <? 2)) && ((project request replay) <? 3)) && ((project request collection) <? 5)) && ((project request attribution) <? 5)) && ((project request collection) =? (UorObservationAdmission::uorObservationAdmissionCollectionDeny))) && ((UorObservationAdmission::uorObservationAdmissionJudge request) =? (UorObservationAdmission::uorObservationAdmissionAnswerPermit)))",
        "inv005Holds",
    );
}

/// `UOA-06`: The app never answers permit when collection is outside
#[test]
fn uor_observation_admission_uoa_06() {
    pinned(
        "breaksInv006",
        "body: (((((((((project request metric) <? 2) && ((project request oracle) <? 3)) && ((project request source) <? 2)) && ((project request replay) <? 3)) && ((project request collection) <? 5)) && ((project request attribution) <? 5)) && ((project request collection) =? (UorObservationAdmission::uorObservationAdmissionCollectionOutside))) && ((UorObservationAdmission::uorObservationAdmissionJudge request) =? (UorObservationAdmission::uorObservationAdmissionAnswerPermit)))",
        "inv006Holds",
    );
}

/// `UOA-07`: The app never answers permit when attribution is deny
#[test]
fn uor_observation_admission_uoa_07() {
    pinned(
        "breaksInv007",
        "body: (((((((((project request metric) <? 2) && ((project request oracle) <? 3)) && ((project request source) <? 2)) && ((project request replay) <? 3)) && ((project request collection) <? 5)) && ((project request attribution) <? 5)) && ((project request attribution) =? (UorObservationAdmission::uorObservationAdmissionAttributionDeny))) && ((UorObservationAdmission::uorObservationAdmissionJudge request) =? (UorObservationAdmission::uorObservationAdmissionAnswerPermit)))",
        "inv007Holds",
    );
}

/// `UOA-08`: The app always answers deny when metric is released and collection is deny
#[test]
fn uor_observation_admission_uoa_08() {
    pinned(
        "breaksInv008",
        "body: ((((((((((project request metric) <? 2) && ((project request oracle) <? 3)) && ((project request source) <? 2)) && ((project request replay) <? 3)) && ((project request collection) <? 5)) && ((project request attribution) <? 5)) && ((project request metric) =? (UorObservationAdmission::uorObservationAdmissionMetricReleased))) && ((project request collection) =? (UorObservationAdmission::uorObservationAdmissionCollectionDeny))) && (not ((UorObservationAdmission::uorObservationAdmissionJudge request) =? (UorObservationAdmission::uorObservationAdmissionAnswerDeny))))",
        "inv008Holds",
    );
}
