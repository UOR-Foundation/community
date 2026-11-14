//! The `uor_repo_files` suite: one test per scenario in `features/suites/uor_repo_files.feature`.
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
    let model = module("app/src/UorRepoFilesProofs.lex.tex");
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

/// `URF-01`: The app never answers conformant when readme is missing
#[test]
fn uor_repo_files_urf_01() {
    pinned(
        "breaksInv001",
        "body: (((((((((((project request tier) <? 4) && ((project request readme) <? 2)) && ((project request license) <? 2)) && ((project request contributing) <? 2)) && ((project request conduct) <? 2)) && ((project request security) <? 2)) && ((project request codeowners) <? 2)) && ((project request ci) <? 2)) && ((project request readme) =? (UorRepoFiles::uorRepoFilesReadmeMissing))) && ((UorRepoFiles::uorRepoFilesJudge request) =? (UorRepoFiles::uorRepoFilesAnswerConformant)))",
        "inv001Holds",
    );
}

/// `URF-02`: The app always answers missing-file when readme is present and license is missing
#[test]
fn uor_repo_files_urf_02() {
    pinned(
        "breaksInv002",
        "body: ((((((((((((project request tier) <? 4) && ((project request readme) <? 2)) && ((project request license) <? 2)) && ((project request contributing) <? 2)) && ((project request conduct) <? 2)) && ((project request security) <? 2)) && ((project request codeowners) <? 2)) && ((project request ci) <? 2)) && ((project request readme) =? (UorRepoFiles::uorRepoFilesReadmePresent))) && ((project request license) =? (UorRepoFiles::uorRepoFilesLicenseMissing))) && (not ((UorRepoFiles::uorRepoFilesJudge request) =? (UorRepoFiles::uorRepoFilesAnswerMissingFile))))",
        "inv002Holds",
    );
}

/// `URF-03`: The app never answers conformant when tier is t1 and security is missing
#[test]
fn uor_repo_files_urf_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((((((project request tier) <? 4) && ((project request readme) <? 2)) && ((project request license) <? 2)) && ((project request contributing) <? 2)) && ((project request conduct) <? 2)) && ((project request security) <? 2)) && ((project request codeowners) <? 2)) && ((project request ci) <? 2)) && ((project request tier) =? (UorRepoFiles::uorRepoFilesTierT1))) && ((project request security) =? (UorRepoFiles::uorRepoFilesSecurityMissing))) && ((UorRepoFiles::uorRepoFilesJudge request) =? (UorRepoFiles::uorRepoFilesAnswerConformant)))",
        "inv003Holds",
    );
}

/// `URF-04`: The app never answers advisory when tier is t4
#[test]
fn uor_repo_files_urf_04() {
    pinned(
        "breaksInv004",
        "body: (((((((((((project request tier) <? 4) && ((project request readme) <? 2)) && ((project request license) <? 2)) && ((project request contributing) <? 2)) && ((project request conduct) <? 2)) && ((project request security) <? 2)) && ((project request codeowners) <? 2)) && ((project request ci) <? 2)) && ((project request tier) =? (UorRepoFiles::uorRepoFilesTierT4))) && ((UorRepoFiles::uorRepoFilesJudge request) =? (UorRepoFiles::uorRepoFilesAnswerAdvisory)))",
        "inv004Holds",
    );
}
