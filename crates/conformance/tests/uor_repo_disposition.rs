//! The `uor_repo_disposition` suite: one test per scenario in `features/suites/uor_repo_disposition.feature`.
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
    let model = module("app/src/UorRepoDispositionProofs.lex.tex");
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

/// `URD-01`: The app always answers archive when archived is yes
#[test]
fn uor_repo_disposition_urd_01() {
    pinned(
        "breaksInv001",
        "body: ((((((((((project request archived) <? 2) && ((project request reserved) <? 2)) && ((project request statement) <? 4)) && ((project request family) <? 3)) && ((project request consumer) <? 3)) && ((project request overlap) <? 2)) && ((project request activity) <? 2)) && ((project request archived) =? (UorRepoDisposition::uorRepoDispositionArchivedYes))) && (not ((UorRepoDisposition::uorRepoDispositionJudge request) =? (UorRepoDisposition::uorRepoDispositionAnswerArchive))))",
        "inv001Holds",
    );
}

/// `URD-02`: The app never answers fold when statement is none
#[test]
fn uor_repo_disposition_urd_02() {
    pinned(
        "breaksInv002",
        "body: ((((((((((project request archived) <? 2) && ((project request reserved) <? 2)) && ((project request statement) <? 4)) && ((project request family) <? 3)) && ((project request consumer) <? 3)) && ((project request overlap) <? 2)) && ((project request activity) <? 2)) && ((project request statement) =? (UorRepoDisposition::uorRepoDispositionStatementNone))) && ((UorRepoDisposition::uorRepoDispositionJudge request) =? (UorRepoDisposition::uorRepoDispositionAnswerFold)))",
        "inv002Holds",
    );
}

/// `URD-03`: The app never answers fold when statement is relocated
#[test]
fn uor_repo_disposition_urd_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((((project request archived) <? 2) && ((project request reserved) <? 2)) && ((project request statement) <? 4)) && ((project request family) <? 3)) && ((project request consumer) <? 3)) && ((project request overlap) <? 2)) && ((project request activity) <? 2)) && ((project request statement) =? (UorRepoDisposition::uorRepoDispositionStatementRelocated))) && ((UorRepoDisposition::uorRepoDispositionJudge request) =? (UorRepoDisposition::uorRepoDispositionAnswerFold)))",
        "inv003Holds",
    );
}

/// `URD-04`: The app always answers review when archived is no and reserved is no and statement is none and family is member
#[test]
fn uor_repo_disposition_urd_04() {
    pinned(
        "breaksInv004",
        "body: (((((((((((((project request archived) <? 2) && ((project request reserved) <? 2)) && ((project request statement) <? 4)) && ((project request family) <? 3)) && ((project request consumer) <? 3)) && ((project request overlap) <? 2)) && ((project request activity) <? 2)) && ((project request archived) =? (UorRepoDisposition::uorRepoDispositionArchivedNo))) && ((project request reserved) =? (UorRepoDisposition::uorRepoDispositionReservedNo))) && ((project request statement) =? (UorRepoDisposition::uorRepoDispositionStatementNone))) && ((project request family) =? (UorRepoDisposition::uorRepoDispositionFamilyMember))) && (not ((UorRepoDisposition::uorRepoDispositionJudge request) =? (UorRepoDisposition::uorRepoDispositionAnswerReview))))",
        "inv004Holds",
    );
}

/// `URD-05`: The app never answers archive when archived is no and statement is none
#[test]
fn uor_repo_disposition_urd_05() {
    pinned(
        "breaksInv005",
        "body: (((((((((((project request archived) <? 2) && ((project request reserved) <? 2)) && ((project request statement) <? 4)) && ((project request family) <? 3)) && ((project request consumer) <? 3)) && ((project request overlap) <? 2)) && ((project request activity) <? 2)) && ((project request archived) =? (UorRepoDisposition::uorRepoDispositionArchivedNo))) && ((project request statement) =? (UorRepoDisposition::uorRepoDispositionStatementNone))) && ((UorRepoDisposition::uorRepoDispositionJudge request) =? (UorRepoDisposition::uorRepoDispositionAnswerArchive)))",
        "inv005Holds",
    );
}

/// `URD-06`: The app always answers keep when archived is no and reserved is yes
#[test]
fn uor_repo_disposition_urd_06() {
    pinned(
        "breaksInv006",
        "body: (((((((((((project request archived) <? 2) && ((project request reserved) <? 2)) && ((project request statement) <? 4)) && ((project request family) <? 3)) && ((project request consumer) <? 3)) && ((project request overlap) <? 2)) && ((project request activity) <? 2)) && ((project request archived) =? (UorRepoDisposition::uorRepoDispositionArchivedNo))) && ((project request reserved) =? (UorRepoDisposition::uorRepoDispositionReservedYes))) && (not ((UorRepoDisposition::uorRepoDispositionJudge request) =? (UorRepoDisposition::uorRepoDispositionAnswerKeep))))",
        "inv006Holds",
    );
}
