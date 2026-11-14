//! The `chaoss_collaboration_development_index` suite: one test per scenario in `features/suites/chaoss_collaboration_development_index.feature`.
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
    let model = module("app/src/ChaossCollaborationDevelopmentIndexProofs.lex.tex");
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

/// `CCDI-01`: The app never answers complete when refused is at least 1
#[test]
fn chaoss_collaboration_development_index_ccdi_01() {
    pinned(
        "breaksInv001",
        "body: (((((project request admitted) <=? 5) && ((project request refused) <=? 5)) && (1 <=? (project request refused))) && ((ChaossCollaborationDevelopmentIndex::chaossCollaborationDevelopmentIndexJudge request) =? (ChaossCollaborationDevelopmentIndex::chaossCollaborationDevelopmentIndexAnswerComplete)))",
        "inv001Holds",
    );
}

/// `CCDI-02`: The app never answers complete when admitted is below 5
#[test]
fn chaoss_collaboration_development_index_ccdi_02() {
    pinned(
        "breaksInv002",
        "body: (((((project request admitted) <=? 5) && ((project request refused) <=? 5)) && ((project request admitted) <? 5)) && ((ChaossCollaborationDevelopmentIndex::chaossCollaborationDevelopmentIndexJudge request) =? (ChaossCollaborationDevelopmentIndex::chaossCollaborationDevelopmentIndexAnswerComplete)))",
        "inv002Holds",
    );
}

/// `CCDI-03`: The app always answers complete when refused equals 0 and admitted is at least 5
#[test]
fn chaoss_collaboration_development_index_ccdi_03() {
    pinned(
        "breaksInv003",
        "body: ((((((project request admitted) <=? 5) && ((project request refused) <=? 5)) && ((project request refused) =? 0)) && (5 <=? (project request admitted))) && (not ((ChaossCollaborationDevelopmentIndex::chaossCollaborationDevelopmentIndexJudge request) =? (ChaossCollaborationDevelopmentIndex::chaossCollaborationDevelopmentIndexAnswerComplete))))",
        "inv003Holds",
    );
}

/// `CCDI-04`: The app never answers unmeasured when admitted is at least 1 and refused equals 0
#[test]
fn chaoss_collaboration_development_index_ccdi_04() {
    pinned(
        "breaksInv004",
        "body: ((((((project request admitted) <=? 5) && ((project request refused) <=? 5)) && (1 <=? (project request admitted))) && ((project request refused) =? 0)) && ((ChaossCollaborationDevelopmentIndex::chaossCollaborationDevelopmentIndexJudge request) =? (ChaossCollaborationDevelopmentIndex::chaossCollaborationDevelopmentIndexAnswerUnmeasured)))",
        "inv004Holds",
    );
}
