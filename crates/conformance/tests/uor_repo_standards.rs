//! The `uor_repo_standards` suite: one test per scenario in `features/suites/uor_repo_standards.feature`.
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
    let model = module("app/src/UorRepoStandardsProofs.lex.tex");
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

/// `URS-01`: The app never answers conformant when tiertags equals 0
#[test]
fn uor_repo_standards_urs_01() {
    pinned(
        "breaksInv001",
        "body: ((((((((project request tier) <? 4) && ((project request identity) <? 2)) && ((project request tiertags) <=? 4)) && ((project request statustags) <=? 4)) && ((project request versioning) <? 3)) && ((project request tiertags) =? 0)) && ((UorRepoStandards::uorRepoStandardsJudge request) =? (UorRepoStandards::uorRepoStandardsAnswerConformant)))",
        "inv001Holds",
    );
}

/// `URS-02`: The app never answers conformant when statustags is above 1
#[test]
fn uor_repo_standards_urs_02() {
    pinned(
        "breaksInv002",
        "body: ((((((((project request tier) <? 4) && ((project request identity) <? 2)) && ((project request tiertags) <=? 4)) && ((project request statustags) <=? 4)) && ((project request versioning) <? 3)) && (1 <? (project request statustags))) && ((UorRepoStandards::uorRepoStandardsJudge request) =? (UorRepoStandards::uorRepoStandardsAnswerConformant)))",
        "inv002Holds",
    );
}

/// `URS-03`: The app never answers conformant when tier is t1 and versioning is other
#[test]
fn uor_repo_standards_urs_03() {
    pinned(
        "breaksInv003",
        "body: (((((((((project request tier) <? 4) && ((project request identity) <? 2)) && ((project request tiertags) <=? 4)) && ((project request statustags) <=? 4)) && ((project request versioning) <? 3)) && ((project request tier) =? (UorRepoStandards::uorRepoStandardsTierT1))) && ((project request versioning) =? (UorRepoStandards::uorRepoStandardsVersioningOther))) && ((UorRepoStandards::uorRepoStandardsJudge request) =? (UorRepoStandards::uorRepoStandardsAnswerConformant)))",
        "inv003Holds",
    );
}

/// `URS-04`: The app never answers unversioned when tier is t3
#[test]
fn uor_repo_standards_urs_04() {
    pinned(
        "breaksInv004",
        "body: ((((((((project request tier) <? 4) && ((project request identity) <? 2)) && ((project request tiertags) <=? 4)) && ((project request statustags) <=? 4)) && ((project request versioning) <? 3)) && ((project request tier) =? (UorRepoStandards::uorRepoStandardsTierT3))) && ((UorRepoStandards::uorRepoStandardsJudge request) =? (UorRepoStandards::uorRepoStandardsAnswerUnversioned)))",
        "inv004Holds",
    );
}
