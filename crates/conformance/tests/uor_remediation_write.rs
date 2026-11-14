//! The `uor_remediation_write` suite: one test per scenario in `features/suites/uor_remediation_write.feature`.
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
    let model = module("app/src/UorRemediationWriteProofs.lex.tex");
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

/// `URW-01`: The app never answers permit when approval is none and actor is agent
#[test]
fn uor_remediation_write_urw_01() {
    pinned(
        "breaksInv001",
        "body: (((((((((project request actor) <? 5) && ((project request change) <? 4)) && ((project request repository) <? 2)) && ((project request approval) <? 2)) && ((project request route) <? 2)) && ((project request approval) =? (UorRemediationWrite::uorRemediationWriteApprovalNone))) && ((project request actor) =? (UorRemediationWrite::uorRemediationWriteActorAgent))) && ((UorRemediationWrite::uorRemediationWriteJudge request) =? (UorRemediationWrite::uorRemediationWriteAnswerPermit)))",
        "inv001Holds",
    );
}

/// `URW-02`: The app never answers permit when change is file and route is direct
#[test]
fn uor_remediation_write_urw_02() {
    pinned(
        "breaksInv002",
        "body: (((((((((project request actor) <? 5) && ((project request change) <? 4)) && ((project request repository) <? 2)) && ((project request approval) <? 2)) && ((project request route) <? 2)) && ((project request change) =? (UorRemediationWrite::uorRemediationWriteChangeFile))) && ((project request route) =? (UorRemediationWrite::uorRemediationWriteRouteDirect))) && ((UorRemediationWrite::uorRemediationWriteJudge request) =? (UorRemediationWrite::uorRemediationWriteAnswerPermit)))",
        "inv002Holds",
    );
}

/// `URW-03`: The app never answers permit when change is ruleset and actor is agent
#[test]
fn uor_remediation_write_urw_03() {
    pinned(
        "breaksInv003",
        "body: (((((((((project request actor) <? 5) && ((project request change) <? 4)) && ((project request repository) <? 2)) && ((project request approval) <? 2)) && ((project request route) <? 2)) && ((project request change) =? (UorRemediationWrite::uorRemediationWriteChangeRuleset))) && ((project request actor) =? (UorRemediationWrite::uorRemediationWriteActorAgent))) && ((UorRemediationWrite::uorRemediationWriteJudge request) =? (UorRemediationWrite::uorRemediationWriteAnswerPermit)))",
        "inv003Holds",
    );
}

/// `URW-04`: The app always answers permit when actor is agent and change is file and repository is live and approval is given and route is pull-request
#[test]
fn uor_remediation_write_urw_04() {
    pinned(
        "breaksInv004",
        "body: ((((((((((((project request actor) <? 5) && ((project request change) <? 4)) && ((project request repository) <? 2)) && ((project request approval) <? 2)) && ((project request route) <? 2)) && ((project request actor) =? (UorRemediationWrite::uorRemediationWriteActorAgent))) && ((project request change) =? (UorRemediationWrite::uorRemediationWriteChangeFile))) && ((project request repository) =? (UorRemediationWrite::uorRemediationWriteRepositoryLive))) && ((project request approval) =? (UorRemediationWrite::uorRemediationWriteApprovalGiven))) && ((project request route) =? (UorRemediationWrite::uorRemediationWriteRoutePullRequest))) && (not ((UorRemediationWrite::uorRemediationWriteJudge request) =? (UorRemediationWrite::uorRemediationWriteAnswerPermit))))",
        "inv004Holds",
    );
}
