//! The `chaoss_oss_project_viability_community` suite: one test per scenario in `features/suites/chaoss_oss_project_viability_community.feature`.
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
    let model = module("app/src/ChaossOssProjectViabilityCommunityProofs.lex.tex");
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

/// `COPVC-01`: The app never answers complete when refused is at least 1
#[test]
fn chaoss_oss_project_viability_community_copvc_01() {
    pinned(
        "breaksInv001",
        "body: (((((project request admitted) <=? 8) && ((project request refused) <=? 8)) && (1 <=? (project request refused))) && ((ChaossOssProjectViabilityCommunity::chaossOssProjectViabilityCommunityJudge request) =? (ChaossOssProjectViabilityCommunity::chaossOssProjectViabilityCommunityAnswerComplete)))",
        "inv001Holds",
    );
}

/// `COPVC-02`: The app never answers complete when admitted is below 8
#[test]
fn chaoss_oss_project_viability_community_copvc_02() {
    pinned(
        "breaksInv002",
        "body: (((((project request admitted) <=? 8) && ((project request refused) <=? 8)) && ((project request admitted) <? 8)) && ((ChaossOssProjectViabilityCommunity::chaossOssProjectViabilityCommunityJudge request) =? (ChaossOssProjectViabilityCommunity::chaossOssProjectViabilityCommunityAnswerComplete)))",
        "inv002Holds",
    );
}

/// `COPVC-03`: The app always answers complete when refused equals 0 and admitted is at least 8
#[test]
fn chaoss_oss_project_viability_community_copvc_03() {
    pinned(
        "breaksInv003",
        "body: ((((((project request admitted) <=? 8) && ((project request refused) <=? 8)) && ((project request refused) =? 0)) && (8 <=? (project request admitted))) && (not ((ChaossOssProjectViabilityCommunity::chaossOssProjectViabilityCommunityJudge request) =? (ChaossOssProjectViabilityCommunity::chaossOssProjectViabilityCommunityAnswerComplete))))",
        "inv003Holds",
    );
}

/// `COPVC-04`: The app never answers unmeasured when admitted is at least 1 and refused equals 0
#[test]
fn chaoss_oss_project_viability_community_copvc_04() {
    pinned(
        "breaksInv004",
        "body: ((((((project request admitted) <=? 8) && ((project request refused) <=? 8)) && (1 <=? (project request admitted))) && ((project request refused) =? 0)) && ((ChaossOssProjectViabilityCommunity::chaossOssProjectViabilityCommunityJudge request) =? (ChaossOssProjectViabilityCommunity::chaossOssProjectViabilityCommunityAnswerUnmeasured)))",
        "inv004Holds",
    );
}
