//! The `assets` suite: one test per scenario in `features/suites/assets.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: an asset, digest or open claim in
//! `inventory/register.json` missing from `app/src/Assets.lex.tex` fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Asset.V1.Model";

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

/// The text of the register's top-level array `key`, up to the next top-level key.
fn section<'a>(json: &'a str, key: &str, next: &str) -> &'a str {
    let start = json
        .find(&format!("\n \"{key}\": ["))
        .expect("the section is present");
    let end = json[start..]
        .find(&format!("\n \"{next}\": "))
        .expect("the next section is present");
    &json[start..start + end]
}

/// Every string value of `key` in `json`, in order.
fn values(json: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\": \"");
    json.match_indices(&needle)
        .map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            rest[..rest.find('"').expect("a closed string")].to_string()
        })
        .collect()
}

/// Every number value of `key` in `json`, in order.
fn numbers(json: &str, key: &str) -> Vec<i64> {
    let needle = format!("\"{key}\": ");
    json.match_indices(&needle)
        .map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            let end = rest
                .find(|c: char| c != '-' && !c.is_ascii_digit())
                .expect("a number ends");
            rest[..end].parse().expect("a number")
        })
        .collect()
}

/// `AS-01`: The asset register is valid
#[test]
fn assets_as_01() {
    let catalog = read("app/src/Assets.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (assets) (communities) (domains) (packages) (services) (relationships) (documents) (openClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Asset/V1/Model.lex.tex");
    for part in [
        // Unique ids: assets are numbered in id order and each id's rank is its position.
        "((project asset rank) =? (project asset index))",
        "(assetsValid 0 assets)",
        // Resolution: a package, service or document names a repository asset, or is claimed.
        "(assetsResolved openClaims assets assets)",
        "(((project asset linked) && (repositoryAt allAssets (project asset repository))) || (claimed (project asset index) claims))",
        "(linksAreRepositories assets assets)",
        // Every domain has an RDAP observation, and a failed or expiring one is claimed.
        "(domainsObserved domains assets)",
        "(rdapAccounted openClaims domains)",
        "(resolutionAccounted openClaims domains)",
        "(expiryAccounted (project release expiryDays) openClaims domains)",
        // Every organization but the Foundation has a relationship whose relation is stated, or is claimed.
        "(organizationsRelated relationships (project release foundation) assets)",
        "(relationsAccounted openClaims relationships)",
        "(deploymentsAccounted openClaims services)",
        "(publicationsAccounted openClaims packages)",
        "((openClaimsTotal openClaims) =? (project release openClaimsCount))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
}

/// `AS-02`: The asset catalog declares every asset under its id, and its digests
#[test]
fn assets_as_02() {
    let register = read("inventory/register.json");
    let catalog = read("app/src/Assets.lex.tex");
    let ids = values(section(&register, "assets", "communities"), "id");
    assert!(
        ids.len() > 31,
        "the register holds more than the repositories"
    );
    let mut sorted = ids.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted, ids, "asset ids are unique and in id order");
    for (rank, id) in ids.iter().enumerate() {
        assert!(
            catalog.contains(&format!("identifier := \"{id}\", rank := {rank},")),
            "{id} is declared at rank {rank}"
        );
    }
    let ecosystem = read("ecosystem/register.json");
    for name in values(&ecosystem, "name")
        .iter()
        .filter(|n| ecosystem.contains(&format!("\n      \"name\": \"{n}\"")))
    {
        assert!(
            ids.contains(&format!("repo:{name}")),
            "the ecosystem repository {name} is an asset"
        );
    }
    let digests = values(&register, "sha256");
    assert!(
        digests.len() >= 12,
        "the snapshot, sources and standards are addressed"
    );
    for digest in &digests {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the digest {digest} is declared"
        );
    }
}

/// `AS-03`: Unresolved assets and unstated relations are open claims
#[test]
fn assets_as_03() {
    let register = read("inventory/register.json");
    let catalog = read("app/src/Assets.lex.tex");
    let assets = section(&register, "assets", "communities");
    let refusals = section(&register, "refusals", "excluded");
    let claimed = numbers(refusals, "asset");
    let declared = catalog
        .matches(&format!("(record {M}::OpenClaim {{"))
        .count();
    assert_eq!(declared, claimed.len(), "every refusal is one OpenClaim");
    assert!(
        catalog.contains(&format!("openClaimsCount := {declared}")),
        "the release counts every open claim"
    );
    // An asset that needs a repository and names none is claimed.
    for entry in assets.split("\n  {").skip(1) {
        let index = numbers(entry, "index")[0];
        let needs = entry.contains("\"needsRepository\": true");
        let repository = numbers(entry, "repository")[0];
        if needs && repository < 0 {
            assert!(
                claimed.contains(&index),
                "the unresolved asset {index} is claimed"
            );
        }
    }
    // A relationship whose relation is unstated is claimed.
    for entry in section(&register, "relationships", "documents")
        .split("\n  {")
        .skip(1)
    {
        if entry.contains("\"relation\": \"unstated\"") {
            let asset = numbers(entry, "asset")[0];
            assert!(
                claimed.contains(&asset),
                "the unstated relation of {asset} is claimed"
            );
        }
    }
    for refusal in values(refusals, "refusal") {
        assert!(
            catalog.contains(&format!("refusal := \"{refusal}\"")),
            "the refusal {refusal} is declared"
        );
    }
}
