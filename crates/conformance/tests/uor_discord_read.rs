//! The `uor_discord_read` suite: one test per scenario in `features/suites/uor_discord_read.feature`.
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
    let model = module("app/src/UorDiscordReadProofs.lex.tex");
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

/// `UDR-01`: The app never answers permit when kind is dm
#[test]
fn uor_discord_read_udr_01() {
    pinned(
        "breaksInv001",
        "body: ((((((((project request kind) <? 4) && ((project request visibility) <? 2)) && ((project request label) <? 3)) && ((project request install) <? 2)) && ((project request intent) <? 2)) && ((project request kind) =? (UorDiscordRead::uorDiscordReadKindDm))) && ((UorDiscordRead::uorDiscordReadJudge request) =? (UorDiscordRead::uorDiscordReadAnswerPermit)))",
        "inv001Holds",
    );
}

/// `UDR-02`: The app never answers permit when visibility is restricted
#[test]
fn uor_discord_read_udr_02() {
    pinned(
        "breaksInv002",
        "body: ((((((((project request kind) <? 4) && ((project request visibility) <? 2)) && ((project request label) <? 3)) && ((project request install) <? 2)) && ((project request intent) <? 2)) && ((project request visibility) =? (UorDiscordRead::uorDiscordReadVisibilityRestricted))) && ((UorDiscordRead::uorDiscordReadJudge request) =? (UorDiscordRead::uorDiscordReadAnswerPermit)))",
        "inv002Holds",
    );
}

/// `UDR-03`: The app never answers permit when label is not public
#[test]
fn uor_discord_read_udr_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((project request kind) <? 4) && ((project request visibility) <? 2)) && ((project request label) <? 3)) && ((project request install) <? 2)) && ((project request intent) <? 2)) && (not ((project request label) =? (UorDiscordRead::uorDiscordReadLabelPublic)))) && ((UorDiscordRead::uorDiscordReadJudge request) =? (UorDiscordRead::uorDiscordReadAnswerPermit)))",
        "inv003Holds",
    );
}

/// `UDR-04`: The app never answers permit when install is other
#[test]
fn uor_discord_read_udr_04() {
    pinned(
        "breaksInv004",
        "body: ((((((((project request kind) <? 4) && ((project request visibility) <? 2)) && ((project request label) <? 3)) && ((project request install) <? 2)) && ((project request intent) <? 2)) && ((project request install) =? (UorDiscordRead::uorDiscordReadInstallOther))) && ((UorDiscordRead::uorDiscordReadJudge request) =? (UorDiscordRead::uorDiscordReadAnswerPermit)))",
        "inv004Holds",
    );
}

/// `UDR-05`: The app never answers permit when intent is missing
#[test]
fn uor_discord_read_udr_05() {
    pinned(
        "breaksInv005",
        "body: ((((((((project request kind) <? 4) && ((project request visibility) <? 2)) && ((project request label) <? 3)) && ((project request install) <? 2)) && ((project request intent) <? 2)) && ((project request intent) =? (UorDiscordRead::uorDiscordReadIntentMissing))) && ((UorDiscordRead::uorDiscordReadJudge request) =? (UorDiscordRead::uorDiscordReadAnswerPermit)))",
        "inv005Holds",
    );
}
