//! The `supply` suite: one test per scenario in `features/suites/supply.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's: a repository, SBOM digest, tool digest or open
//! claim in `supply/register.json` missing from `app/src/Supply.lex.tex`, or a
//! committed SBOM whose bytes are not the ones the catalog addresses, fails the gate.

use std::path::PathBuf;

const M: &str = "Foundation.Supply.V1.Model";

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

/// Every string value of `key` in the register, in order.
fn values(json: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\": \"");
    json.match_indices(&needle)
        .map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            rest[..rest.find('"').expect("a closed string")].to_string()
        })
        .collect()
}

/// FIPS 180-4 SHA-256, so a committed SBOM is re-addressed here rather than trusted.
fn sha256(bytes: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut message = bytes.to_vec();
    let length = (bytes.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&length.to_be_bytes());
    for block in message.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [
                t1.wrapping_add(t2),
                v[0],
                v[1],
                v[2],
                v[3].wrapping_add(t1),
                v[4],
                v[5],
                v[6],
            ];
        }
        for (a, b) in h.iter_mut().zip(v) {
            *a = a.wrapping_add(b);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

/// `SC-01`: The supply register is valid
#[test]
fn supply_sc_01() {
    assert_eq!(
        sha256(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "the digest is FIPS 180-4 SHA-256"
    );
    let catalog = read("app/src/Supply.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (repositories) (componentCounts) (licenseCounts) (packages) (edges) (repositoryClaims) (packageClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Supply/V1/Model.lex.tex");
    for part in [
        "((repositoriesTotal repositories) =? (project release repositoriesCount))",
        "((edgesTotal edges) =? (project release edgesCount))",
        "(edgesValid 0 (repositoriesTotal repositories) edges)",
        "((project edge dependent) <? repositoriesCount)",
        "((project edge dependency) <? repositoriesCount)",
        "(not ((project edge dependent) =? (project edge dependency)))",
        "((componentSum repositories) =? (project release componentTotal))",
        "(countsReconcile componentCounts licenseCounts repositories)",
        "((componentsOf (project repository index) allCounts) =? (project repository components))",
        "((licensesOf (project repository index) allLicenses) =? (project repository licenseEntries))",
        "(sbomsAccounted repositoryClaims repositories)",
        "(((project repository hasSbom) && (0 <? (project repository components))) || (repositoryClaimed (project repository index) claims))",
        "(packagesAccounted packageClaims packages)",
        "| RegistryStatus.published => true\n",
        "| RegistryStatus.absent => isPrivate\n",
        "| RegistryStatus.elsewhere => false\n",
        "| RegistryStatus.unread => false)",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
}

/// `SC-02`: The supply catalog declares every repository at its commit with its SBOM digest and the tool and standard digests
#[test]
fn supply_sc_02() {
    let register = read("supply/register.json");
    let catalog = read("app/src/Supply.lex.tex");
    let snapshot = read("supply/snapshot.json");
    let names = values(&snapshot, "name");
    let commits = values(&snapshot, "commit");
    assert_eq!(names.len(), commits.len(), "every pin has a commit");
    assert!(
        !names.is_empty(),
        "the snapshot pins the Foundation's repositories"
    );
    let paths = values(&register, "path");
    for (name, commit) in names.iter().zip(&commits) {
        assert!(
            catalog.contains(&format!(
                "name := \"{name}\", commit := \"{commit}\", sbomDigest := "
            )),
            "{name} is declared at {commit}"
        );
        let path = format!("supply/sboms/{name}.cdx.json");
        if paths.contains(&path) {
            let bytes = std::fs::read(root().join(&path)).expect("the committed SBOM");
            let digest = sha256(&bytes);
            assert!(
                catalog.contains(&format!(
                    "name := \"{name}\", commit := \"{commit}\", sbomDigest := \"sha256:{digest}\", hasSbom := true"
                )),
                "{path} has the digest the catalog declares"
            );
            let text = String::from_utf8(bytes).expect("UTF-8 JSON");
            assert!(
                text.starts_with(
                    "{\"$schema\":\"http://cyclonedx.org/schema/bom-1.6.schema.json\",\"bomFormat\":\"CycloneDX\",\"specVersion\":\"1.6\","
                ),
                "{path} is a CycloneDX 1.6 BOM"
            );
        } else {
            assert!(
                catalog.contains(&format!(
                    "name := \"{name}\", commit := \"{commit}\", sbomDigest := \"\", hasSbom := false"
                )),
                "{name} has no SBOM and is declared without one"
            );
        }
    }
    for digest in values(&register, "sha256") {
        assert!(
            catalog.contains(&format!("sha256:{digest}")),
            "the digest {digest} is declared"
        );
    }
    for key in ["binarySha256", "checksumsSha256"] {
        assert_eq!(
            values(&register, key).len(),
            1,
            "the register records syft's {key}"
        );
    }
    assert!(
        catalog.contains("syft := \"syft ") && catalog.contains("validator := \"ajv "),
        "the oracle and the validator are declared"
    );
}

/// `SC-03`: Unresolved repositories, references and packages are open claims
#[test]
fn supply_sc_03() {
    let register = read("supply/register.json");
    let catalog = read("app/src/Supply.lex.tex");
    let tail = &register[register.find("\n  \"refusals\": [").expect("refusals")..];
    let split = tail
        .find("\n  \"packageClaims\": [")
        .expect("package claims");
    let repository = values(&tail[..split], "refusal");
    let package = values(&tail[split..], "refusal");
    assert_eq!(
        catalog
            .matches(&format!("(record {M}::RepositoryClaim {{"))
            .count(),
        repository.len(),
        "every repository refusal is one RepositoryClaim"
    );
    assert_eq!(
        catalog
            .matches(&format!("(record {M}::PackageClaim {{"))
            .count(),
        package.len(),
        "every package refusal is one PackageClaim"
    );
    assert!(
        catalog.contains(&format!("repositoryClaimsCount := {}", repository.len()))
            && catalog.contains(&format!("packageClaimsCount := {}", package.len())),
        "the release counts every open claim"
    );
    // A repository whose SBOM catalogues nothing is claimed, never counted as covered.
    let empty = catalog.matches("components := 0,").count();
    let claimed = repository
        .iter()
        .filter(|r| *r == "sbom-empty" || *r == "sbom-invalid")
        .count();
    assert!(
        claimed >= empty,
        "every empty SBOM is an open claim ({empty} empty, {claimed} claimed)"
    );
    // A package declared for publication and absent from its registry is claimed.
    let absent = catalog
        .matches(&format!(
            "declaredPrivate := false, registry := (ctor {M}::RegistryStatus.absent)"
        ))
        .count();
    let unpublished = package.iter().filter(|r| *r == "unpublished").count();
    assert_eq!(
        absent, unpublished,
        "every unpublished package is one claim"
    );
}
