//! The `compliance` suite: one test per scenario in `features/suites/compliance.feature`.
//!
//! The OSCAL document exists only after `prismpm verify` has built the model,
//! so `just app` runs the oracle on it. These tests hold fixed that it does so
//! on the build the attestation names, with the oracle `standards.lock` pins,
//! and that the model declares the control set the document is emitted from.

use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/conformance is two below the root")
        .to_path_buf()
}

fn read(path: &str) -> String {
    std::fs::read_to_string(root().join(path)).expect("the file")
}

/// `CP-01`: The verified build's OSCAL 1.1.0 component definition is accepted by the locked oracle
#[test]
fn compliance_cp_01() {
    let justfile = read("Justfile");
    let start = justfile.find("\napp:\n").expect("the app recipe");
    let recipe: Vec<&str> = justfile[start + 1..]
        .lines()
        .skip(1)
        .take_while(|line| line.starts_with("    ") || line.is_empty())
        .map(str::trim)
        .collect();
    let at = |needle: &str| {
        recipe
            .iter()
            .position(|line| line.starts_with(needle))
            .unwrap_or_else(|| panic!("the app recipe runs `{needle}`"))
    };
    let verify = at("prismpm --project app verify");
    let build = at("build=$(sed -n");
    let oracle = at("oscal-validator ");
    assert!(
        verify < build && build < oracle,
        "the oracle reads the build verify made"
    );
    assert!(
        recipe[build].contains("app/.prism/verified/$attestation/manifest.json"),
        "the build is the one the attestation names"
    );
    assert_eq!(
        recipe[build + 1],
        "test -n \"$build\"",
        "a missing build id fails"
    );
    assert_eq!(
        recipe[oracle],
        "oscal-validator \"app/.prism/build/$build/oscal/component-definition.json\""
    );
    let lock = read("standards.lock");
    for needle in [
        "\"id\":\"oscal-1.1.0-structural\"",
        "\"executable\":\"oscal-validator\"",
        "\"id\":\"OSCAL-1-1-0\"",
    ] {
        assert!(lock.contains(needle), "standards.lock pins {needle}");
    }
    let security = read("app/src/Security.lex.tex");
    assert!(
        security.contains("\n  name: controlSet,\n"),
        "the model declares the control set"
    );
    assert!(
        security.contains("\n  name: strideEnumerated,\n"),
        "the threat model enumerates STRIDE per element"
    );
    let compliance = read("app/src/Compliance.lex.tex");
    assert!(
        compliance.contains("NIST OSCAL 1.1.0"),
        "OSCAL is a compliance obligation"
    );
}
