//! The `uor_repo_protection` suite: one test per scenario in `features/suites/uor_repo_protection.feature`.
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
    let model = module("app/src/UorRepoProtectionProofs.lex.tex");
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

/// `URP-01`: The app never answers conformant when forcepush is allowed
#[test]
fn uor_repo_protection_urp_01() {
    pinned(
        "breaksInv001",
        "body: ((((((((project request tier) <? 4) && ((project request pr) <? 2)) && ((project request reviews) <=? 8)) && ((project request checks) <? 2)) && ((project request forcepush) <? 2)) && ((project request forcepush) =? (UorRepoProtection::uorRepoProtectionForcepushAllowed))) && ((UorRepoProtection::uorRepoProtectionJudge request) =? (UorRepoProtection::uorRepoProtectionAnswerConformant)))",
        "inv001Holds",
    );
}

/// `URP-02`: The app never answers conformant when tier is t1 and reviews is below 2
#[test]
fn uor_repo_protection_urp_02() {
    pinned(
        "breaksInv002",
        "body: (((((((((project request tier) <? 4) && ((project request pr) <? 2)) && ((project request reviews) <=? 8)) && ((project request checks) <? 2)) && ((project request forcepush) <? 2)) && ((project request tier) =? (UorRepoProtection::uorRepoProtectionTierT1))) && ((project request reviews) <? 2)) && ((UorRepoProtection::uorRepoProtectionJudge request) =? (UorRepoProtection::uorRepoProtectionAnswerConformant)))",
        "inv002Holds",
    );
}

/// `URP-03`: The app never answers conformant when tier is t2 and checks is optional
#[test]
fn uor_repo_protection_urp_03() {
    pinned(
        "breaksInv003",
        "body: (((((((((project request tier) <? 4) && ((project request pr) <? 2)) && ((project request reviews) <=? 8)) && ((project request checks) <? 2)) && ((project request forcepush) <? 2)) && ((project request tier) =? (UorRepoProtection::uorRepoProtectionTierT2))) && ((project request checks) =? (UorRepoProtection::uorRepoProtectionChecksOptional))) && ((UorRepoProtection::uorRepoProtectionJudge request) =? (UorRepoProtection::uorRepoProtectionAnswerConformant)))",
        "inv003Holds",
    );
}

/// `URP-04`: The app always answers conformant when tier is t4 and forcepush is blocked
#[test]
fn uor_repo_protection_urp_04() {
    pinned(
        "breaksInv004",
        "body: (((((((((project request tier) <? 4) && ((project request pr) <? 2)) && ((project request reviews) <=? 8)) && ((project request checks) <? 2)) && ((project request forcepush) <? 2)) && ((project request tier) =? (UorRepoProtection::uorRepoProtectionTierT4))) && ((project request forcepush) =? (UorRepoProtection::uorRepoProtectionForcepushBlocked))) && (not ((UorRepoProtection::uorRepoProtectionJudge request) =? (UorRepoProtection::uorRepoProtectionAnswerConformant))))",
        "inv004Holds",
    );
}
