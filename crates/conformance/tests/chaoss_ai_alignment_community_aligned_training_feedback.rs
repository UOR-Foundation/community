//! The `chaoss_ai_alignment_community_aligned_training_feedback` suite: one test per scenario in `features/suites/chaoss_ai_alignment_community_aligned_training_feedback.feature`.
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
    let model = module("app/src/ChaossAiAlignmentCommunityAlignedTrainingFeedbackProofs.lex.tex");
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

/// `CAACATF-01`: The app never answers complete when refused is at least 1
#[test]
fn chaoss_ai_alignment_community_aligned_training_feedback_caacatf_01() {
    pinned(
        "breaksInv001",
        "body: (((((project request admitted) <=? 4) && ((project request refused) <=? 4)) && (1 <=? (project request refused))) && ((ChaossAiAlignmentCommunityAlignedTrainingFeedback::chaossAiAlignmentCommunityAlignedTrainingFeedbackJudge request) =? (ChaossAiAlignmentCommunityAlignedTrainingFeedback::chaossAiAlignmentCommunityAlignedTrainingFeedbackAnswerComplete)))",
        "inv001Holds",
    );
}

/// `CAACATF-02`: The app never answers complete when admitted is below 4
#[test]
fn chaoss_ai_alignment_community_aligned_training_feedback_caacatf_02() {
    pinned(
        "breaksInv002",
        "body: (((((project request admitted) <=? 4) && ((project request refused) <=? 4)) && ((project request admitted) <? 4)) && ((ChaossAiAlignmentCommunityAlignedTrainingFeedback::chaossAiAlignmentCommunityAlignedTrainingFeedbackJudge request) =? (ChaossAiAlignmentCommunityAlignedTrainingFeedback::chaossAiAlignmentCommunityAlignedTrainingFeedbackAnswerComplete)))",
        "inv002Holds",
    );
}

/// `CAACATF-03`: The app always answers complete when refused equals 0 and admitted is at least 4
#[test]
fn chaoss_ai_alignment_community_aligned_training_feedback_caacatf_03() {
    pinned(
        "breaksInv003",
        "body: ((((((project request admitted) <=? 4) && ((project request refused) <=? 4)) && ((project request refused) =? 0)) && (4 <=? (project request admitted))) && (not ((ChaossAiAlignmentCommunityAlignedTrainingFeedback::chaossAiAlignmentCommunityAlignedTrainingFeedbackJudge request) =? (ChaossAiAlignmentCommunityAlignedTrainingFeedback::chaossAiAlignmentCommunityAlignedTrainingFeedbackAnswerComplete))))",
        "inv003Holds",
    );
}

/// `CAACATF-04`: The app never answers unmeasured when admitted is at least 1 and refused equals 0
#[test]
fn chaoss_ai_alignment_community_aligned_training_feedback_caacatf_04() {
    pinned(
        "breaksInv004",
        "body: ((((((project request admitted) <=? 4) && ((project request refused) <=? 4)) && (1 <=? (project request admitted))) && ((project request refused) =? 0)) && ((ChaossAiAlignmentCommunityAlignedTrainingFeedback::chaossAiAlignmentCommunityAlignedTrainingFeedbackJudge request) =? (ChaossAiAlignmentCommunityAlignedTrainingFeedback::chaossAiAlignmentCommunityAlignedTrainingFeedbackAnswerUnmeasured)))",
        "inv004Holds",
    );
}
