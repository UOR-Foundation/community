//! The `uor_repo_naming` suite: one test per scenario in `features/suites/uor_repo_naming.feature`.
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
    let model = module("app/src/UorRepoNamingProofs.lex.tex");
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

/// `URN-01`: The app never answers conformant when case is other
#[test]
fn uor_repo_naming_urn_01() {
    pinned(
        "breaksInv001",
        "body: ((((((((((project request case) <? 2) && ((project request version) <? 2)) && ((project request pattern) <? 2)) && ((project request branches) <? 2)) && ((project request commits) <? 2)) && ((project request domain) <? 2)) && ((project request technology) <? 2)) && ((project request case) =? (UorRepoNaming::uorRepoNamingCaseOther))) && ((UorRepoNaming::uorRepoNamingJudge request) =? (UorRepoNaming::uorRepoNamingAnswerConformant)))",
        "inv001Holds",
    );
}

/// `URN-02`: The app never answers conformant when version is present
#[test]
fn uor_repo_naming_urn_02() {
    pinned(
        "breaksInv002",
        "body: ((((((((((project request case) <? 2) && ((project request version) <? 2)) && ((project request pattern) <? 2)) && ((project request branches) <? 2)) && ((project request commits) <? 2)) && ((project request domain) <? 2)) && ((project request technology) <? 2)) && ((project request version) =? (UorRepoNaming::uorRepoNamingVersionPresent))) && ((UorRepoNaming::uorRepoNamingJudge request) =? (UorRepoNaming::uorRepoNamingAnswerConformant)))",
        "inv002Holds",
    );
}

/// `URN-03`: The app never answers conformant when commits is other
#[test]
fn uor_repo_naming_urn_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((((project request case) <? 2) && ((project request version) <? 2)) && ((project request pattern) <? 2)) && ((project request branches) <? 2)) && ((project request commits) <? 2)) && ((project request domain) <? 2)) && ((project request technology) <? 2)) && ((project request commits) =? (UorRepoNaming::uorRepoNamingCommitsOther))) && ((UorRepoNaming::uorRepoNamingJudge request) =? (UorRepoNaming::uorRepoNamingAnswerConformant)))",
        "inv003Holds",
    );
}

/// `URN-04`: The app never answers conformant when domain is incomplete
#[test]
fn uor_repo_naming_urn_04() {
    pinned(
        "breaksInv004",
        "body: ((((((((((project request case) <? 2) && ((project request version) <? 2)) && ((project request pattern) <? 2)) && ((project request branches) <? 2)) && ((project request commits) <? 2)) && ((project request domain) <? 2)) && ((project request technology) <? 2)) && ((project request domain) =? (UorRepoNaming::uorRepoNamingDomainIncomplete))) && ((UorRepoNaming::uorRepoNamingJudge request) =? (UorRepoNaming::uorRepoNamingAnswerConformant)))",
        "inv004Holds",
    );
}

/// `URN-05`: The app never answers conformant when pattern is other
#[test]
fn uor_repo_naming_urn_05() {
    pinned(
        "breaksInv005",
        "body: ((((((((((project request case) <? 2) && ((project request version) <? 2)) && ((project request pattern) <? 2)) && ((project request branches) <? 2)) && ((project request commits) <? 2)) && ((project request domain) <? 2)) && ((project request technology) <? 2)) && ((project request pattern) =? (UorRepoNaming::uorRepoNamingPatternOther))) && ((UorRepoNaming::uorRepoNamingJudge request) =? (UorRepoNaming::uorRepoNamingAnswerConformant)))",
        "inv005Holds",
    );
}

/// `URN-06`: The app always answers advisory when case is lowercase and version is absent and branches is conforming and commits is conventional and domain is complete and technology is complete and pattern is other
#[test]
fn uor_repo_naming_urn_06() {
    pinned(
        "breaksInv006",
        "body: ((((((((((((((((project request case) <? 2) && ((project request version) <? 2)) && ((project request pattern) <? 2)) && ((project request branches) <? 2)) && ((project request commits) <? 2)) && ((project request domain) <? 2)) && ((project request technology) <? 2)) && ((project request case) =? (UorRepoNaming::uorRepoNamingCaseLowercase))) && ((project request version) =? (UorRepoNaming::uorRepoNamingVersionAbsent))) && ((project request branches) =? (UorRepoNaming::uorRepoNamingBranchesConforming))) && ((project request commits) =? (UorRepoNaming::uorRepoNamingCommitsConventional))) && ((project request domain) =? (UorRepoNaming::uorRepoNamingDomainComplete))) && ((project request technology) =? (UorRepoNaming::uorRepoNamingTechnologyComplete))) && ((project request pattern) =? (UorRepoNaming::uorRepoNamingPatternOther))) && (not ((UorRepoNaming::uorRepoNamingJudge request) =? (UorRepoNaming::uorRepoNamingAnswerAdvisory))))",
        "inv006Holds",
    );
}
