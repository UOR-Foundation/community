//! The `uor_repo_tier` suite: one test per scenario in `features/suites/uor_repo_tier.feature`.
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
    let model = module("app/src/UorRepoTierProofs.lex.tex");
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

/// `URT-01`: The app always answers t2 when recorded is t2 and role is framework
#[test]
fn uor_repo_tier_urt_01() {
    pinned(
        "breaksInv001",
        "body: ((((((project request recorded) <? 5) && ((project request role) <? 8)) && ((project request recorded) =? (UorRepoTier::uorRepoTierRecordedT2))) && ((project request role) =? (UorRepoTier::uorRepoTierRoleFramework))) && (not ((UorRepoTier::uorRepoTierJudge request) =? (UorRepoTier::uorRepoTierAnswerT2))))",
        "inv001Holds",
    );
}

/// `URT-02`: The app never answers t1 when recorded is none and role is experiment
#[test]
fn uor_repo_tier_urt_02() {
    pinned(
        "breaksInv002",
        "body: ((((((project request recorded) <? 5) && ((project request role) <? 8)) && ((project request recorded) =? (UorRepoTier::uorRepoTierRecordedNone))) && ((project request role) =? (UorRepoTier::uorRepoTierRoleExperiment))) && ((UorRepoTier::uorRepoTierJudge request) =? (UorRepoTier::uorRepoTierAnswerT1)))",
        "inv002Holds",
    );
}

/// `URT-03`: The app always answers t3 when recorded is none and role is website
#[test]
fn uor_repo_tier_urt_03() {
    pinned(
        "breaksInv003",
        "body: ((((((project request recorded) <? 5) && ((project request role) <? 8)) && ((project request recorded) =? (UorRepoTier::uorRepoTierRecordedNone))) && ((project request role) =? (UorRepoTier::uorRepoTierRoleWebsite))) && (not ((UorRepoTier::uorRepoTierJudge request) =? (UorRepoTier::uorRepoTierAnswerT3))))",
        "inv003Holds",
    );
}
