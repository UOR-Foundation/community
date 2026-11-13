//! The `uor_toc_lifecycle` suite: one test per scenario in `features/suites/uor_toc_lifecycle.feature`.
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
    let model = module("app/src/UorTocLifecycleProofs.lex.tex");
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

/// `UTL-01`: The app never answers graduated when quorum is unmet and stage is incubation
#[test]
fn uor_toc_lifecycle_utl_01() {
    pinned(
        "breaksInv001",
        "body: ((((((((((project request stage) <? 5) && ((project request application2) <? 4)) && ((project request quorum) <? 2)) && ((project request vote) <? 4)) && ((project request evidence) <? 2)) && ((project request comment) <=? 365)) && ((project request quorum) =? (UorTocLifecycle::uorTocLifecycleQuorumUnmet))) && ((project request stage) =? (UorTocLifecycle::uorTocLifecycleStageIncubation))) && ((UorTocLifecycle::uorTocLifecycleJudge request) =? (UorTocLifecycle::uorTocLifecycleAnswerGraduated)))",
        "inv001Holds",
    );
}

/// `UTL-02`: The app never answers graduated when vote is majority and stage is incubation
#[test]
fn uor_toc_lifecycle_utl_02() {
    pinned(
        "breaksInv002",
        "body: ((((((((((project request stage) <? 5) && ((project request application2) <? 4)) && ((project request quorum) <? 2)) && ((project request vote) <? 4)) && ((project request evidence) <? 2)) && ((project request comment) <=? 365)) && ((project request vote) =? (UorTocLifecycle::uorTocLifecycleVoteMajority))) && ((project request stage) =? (UorTocLifecycle::uorTocLifecycleStageIncubation))) && ((UorTocLifecycle::uorTocLifecycleJudge request) =? (UorTocLifecycle::uorTocLifecycleAnswerGraduated)))",
        "inv002Holds",
    );
}

/// `UTL-03`: The app never answers graduated when comment is below 14 and stage is incubation
#[test]
fn uor_toc_lifecycle_utl_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((((project request stage) <? 5) && ((project request application2) <? 4)) && ((project request quorum) <? 2)) && ((project request vote) <? 4)) && ((project request evidence) <? 2)) && ((project request comment) <=? 365)) && ((project request comment) <? 14)) && ((project request stage) =? (UorTocLifecycle::uorTocLifecycleStageIncubation))) && ((UorTocLifecycle::uorTocLifecycleJudge request) =? (UorTocLifecycle::uorTocLifecycleAnswerGraduated)))",
        "inv003Holds",
    );
}

/// `UTL-04`: The app never answers incubation when stage is proposed
#[test]
fn uor_toc_lifecycle_utl_04() {
    pinned(
        "breaksInv004",
        "body: (((((((((project request stage) <? 5) && ((project request application2) <? 4)) && ((project request quorum) <? 2)) && ((project request vote) <? 4)) && ((project request evidence) <? 2)) && ((project request comment) <=? 365)) && ((project request stage) =? (UorTocLifecycle::uorTocLifecycleStageProposed))) && ((UorTocLifecycle::uorTocLifecycleJudge request) =? (UorTocLifecycle::uorTocLifecycleAnswerIncubation)))",
        "inv004Holds",
    );
}

/// `UTL-05`: The app never answers graduated when stage is sandbox
#[test]
fn uor_toc_lifecycle_utl_05() {
    pinned(
        "breaksInv005",
        "body: (((((((((project request stage) <? 5) && ((project request application2) <? 4)) && ((project request quorum) <? 2)) && ((project request vote) <? 4)) && ((project request evidence) <? 2)) && ((project request comment) <=? 365)) && ((project request stage) =? (UorTocLifecycle::uorTocLifecycleStageSandbox))) && ((UorTocLifecycle::uorTocLifecycleJudge request) =? (UorTocLifecycle::uorTocLifecycleAnswerGraduated)))",
        "inv005Holds",
    );
}

/// `UTL-06`: The app never answers sandbox when evidence is partial and stage is proposed
#[test]
fn uor_toc_lifecycle_utl_06() {
    pinned(
        "breaksInv006",
        "body: ((((((((((project request stage) <? 5) && ((project request application2) <? 4)) && ((project request quorum) <? 2)) && ((project request vote) <? 4)) && ((project request evidence) <? 2)) && ((project request comment) <=? 365)) && ((project request evidence) =? (UorTocLifecycle::uorTocLifecycleEvidencePartial))) && ((project request stage) =? (UorTocLifecycle::uorTocLifecycleStageProposed))) && ((UorTocLifecycle::uorTocLifecycleJudge request) =? (UorTocLifecycle::uorTocLifecycleAnswerSandbox)))",
        "inv006Holds",
    );
}

/// `UTL-07`: The app always answers graduated when stage is graduated and application is not archival
#[test]
fn uor_toc_lifecycle_utl_07() {
    pinned(
        "breaksInv007",
        "body: ((((((((((project request stage) <? 5) && ((project request application2) <? 4)) && ((project request quorum) <? 2)) && ((project request vote) <? 4)) && ((project request evidence) <? 2)) && ((project request comment) <=? 365)) && ((project request stage) =? (UorTocLifecycle::uorTocLifecycleStageGraduated))) && (not ((project request application2) =? (UorTocLifecycle::uorTocLifecycleApplication2Archival)))) && (not ((UorTocLifecycle::uorTocLifecycleJudge request) =? (UorTocLifecycle::uorTocLifecycleAnswerGraduated))))",
        "inv007Holds",
    );
}

/// `UTL-08`: The app always answers archived when stage is archived
#[test]
fn uor_toc_lifecycle_utl_08() {
    pinned(
        "breaksInv008",
        "body: (((((((((project request stage) <? 5) && ((project request application2) <? 4)) && ((project request quorum) <? 2)) && ((project request vote) <? 4)) && ((project request evidence) <? 2)) && ((project request comment) <=? 365)) && ((project request stage) =? (UorTocLifecycle::uorTocLifecycleStageArchived))) && (not ((UorTocLifecycle::uorTocLifecycleJudge request) =? (UorTocLifecycle::uorTocLifecycleAnswerArchived))))",
        "inv008Holds",
    );
}
