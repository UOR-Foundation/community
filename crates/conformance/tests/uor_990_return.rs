//! The `uor_990_return` suite: one test per scenario in `features/suites/uor_990_return.feature`.
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
    let model = module("app/src/Uor990ReturnProofs.lex.tex");
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

/// `U9R-01`: The app never answers form990n when normally is large
#[test]
fn uor_990_return_u9r_01() {
    pinned(
        "breaksInv001",
        "body: (((((((project request normally) <? 2) && ((project request receipts) <? 2)) && ((project request assets) <? 2)) && ((project request kind) <? 4)) && ((project request normally) =? (Uor990Return::uor990ReturnNormallyLarge))) && ((Uor990Return::uor990ReturnJudge request) =? (Uor990Return::uor990ReturnAnswerForm990n)))",
        "inv001Holds",
    );
}

/// `U9R-02`: The app never answers form990n when kind is supporting
#[test]
fn uor_990_return_u9r_02() {
    pinned(
        "breaksInv002",
        "body: (((((((project request normally) <? 2) && ((project request receipts) <? 2)) && ((project request assets) <? 2)) && ((project request kind) <? 4)) && ((project request kind) =? (Uor990Return::uor990ReturnKindSupporting))) && ((Uor990Return::uor990ReturnJudge request) =? (Uor990Return::uor990ReturnAnswerForm990n)))",
        "inv002Holds",
    );
}

/// `U9R-03`: The app always answers form990 when normally is large and receipts is large
#[test]
fn uor_990_return_u9r_03() {
    pinned(
        "breaksInv003",
        "body: ((((((((project request normally) <? 2) && ((project request receipts) <? 2)) && ((project request assets) <? 2)) && ((project request kind) <? 4)) && ((project request normally) =? (Uor990Return::uor990ReturnNormallyLarge))) && ((project request receipts) =? (Uor990Return::uor990ReturnReceiptsLarge))) && (not ((Uor990Return::uor990ReturnJudge request) =? (Uor990Return::uor990ReturnAnswerForm990))))",
        "inv003Holds",
    );
}

/// `U9R-04`: The app always answers form990 when normally is large and assets is large
#[test]
fn uor_990_return_u9r_04() {
    pinned(
        "breaksInv004",
        "body: ((((((((project request normally) <? 2) && ((project request receipts) <? 2)) && ((project request assets) <? 2)) && ((project request kind) <? 4)) && ((project request normally) =? (Uor990Return::uor990ReturnNormallyLarge))) && ((project request assets) =? (Uor990Return::uor990ReturnAssetsLarge))) && (not ((Uor990Return::uor990ReturnJudge request) =? (Uor990Return::uor990ReturnAnswerForm990))))",
        "inv004Holds",
    );
}

/// `U9R-05`: The app always answers form990ez when normally is large and receipts is small and assets is small and kind is public
#[test]
fn uor_990_return_u9r_05() {
    pinned(
        "breaksInv005",
        "body: ((((((((((project request normally) <? 2) && ((project request receipts) <? 2)) && ((project request assets) <? 2)) && ((project request kind) <? 4)) && ((project request normally) =? (Uor990Return::uor990ReturnNormallyLarge))) && ((project request receipts) =? (Uor990Return::uor990ReturnReceiptsSmall))) && ((project request assets) =? (Uor990Return::uor990ReturnAssetsSmall))) && ((project request kind) =? (Uor990Return::uor990ReturnKindPublic))) && (not ((Uor990Return::uor990ReturnJudge request) =? (Uor990Return::uor990ReturnAnswerForm990ez))))",
        "inv005Holds",
    );
}

/// `U9R-06`: The app never answers form990ez when normally is large and kind is sponsor
#[test]
fn uor_990_return_u9r_06() {
    pinned(
        "breaksInv006",
        "body: ((((((((project request normally) <? 2) && ((project request receipts) <? 2)) && ((project request assets) <? 2)) && ((project request kind) <? 4)) && ((project request normally) =? (Uor990Return::uor990ReturnNormallyLarge))) && ((project request kind) =? (Uor990Return::uor990ReturnKindSponsor))) && ((Uor990Return::uor990ReturnJudge request) =? (Uor990Return::uor990ReturnAnswerForm990ez)))",
        "inv006Holds",
    );
}
