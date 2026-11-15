//! The `uor_deidentification` suite: one test per scenario in `features/suites/uor_deidentification.feature`.
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
    let model = module("app/src/UorDeidentificationProofs.lex.tex");
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

/// `UD-01`: The app never answers retain when role is content
#[test]
fn uor_deidentification_ud_01() {
    pinned(
        "breaksInv001",
        "body: ((((((project request role) <? 4) && ((project request origin) <? 2)) && ((project request key) <? 2)) && ((project request role) =? (UorDeidentification::uorDeidentificationRoleContent))) && ((UorDeidentification::uorDeidentificationJudge request) =? (UorDeidentification::uorDeidentificationAnswerRetain)))",
        "inv001Holds",
    );
}

/// `UD-02`: The app never answers retain when role is direct and origin is restricted
#[test]
fn uor_deidentification_ud_02() {
    pinned(
        "breaksInv002",
        "body: (((((((project request role) <? 4) && ((project request origin) <? 2)) && ((project request key) <? 2)) && ((project request role) =? (UorDeidentification::uorDeidentificationRoleDirect))) && ((project request origin) =? (UorDeidentification::uorDeidentificationOriginRestricted))) && ((UorDeidentification::uorDeidentificationJudge request) =? (UorDeidentification::uorDeidentificationAnswerRetain)))",
        "inv002Holds",
    );
}

/// `UD-03`: The app never answers pseudonymize when key is missing and role is direct and origin is restricted
#[test]
fn uor_deidentification_ud_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((project request role) <? 4) && ((project request origin) <? 2)) && ((project request key) <? 2)) && ((project request key) =? (UorDeidentification::uorDeidentificationKeyMissing))) && ((project request role) =? (UorDeidentification::uorDeidentificationRoleDirect))) && ((project request origin) =? (UorDeidentification::uorDeidentificationOriginRestricted))) && ((UorDeidentification::uorDeidentificationJudge request) =? (UorDeidentification::uorDeidentificationAnswerPseudonymize)))",
        "inv003Holds",
    );
}
