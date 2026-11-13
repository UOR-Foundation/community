//! The `grimoirelab` suite: one test per scenario in
//! `features/suites/grimoirelab.feature`.
//!
//! The oracle itself (upstream's suites at the pinned commits) runs in the
//! `oracles` workflow, keyed by the digest of everything it reads. These tests
//! hold fixed what that run is bound to: the record, its digests, and the
//! wrapper's refusals.

use std::path::PathBuf;
use std::process::Command;

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

/// Every string value of `key` in a JSON text, in order.
fn values(json: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\": \"");
    json.match_indices(&needle)
        .map(|(at, _)| {
            let rest = &json[at + needle.len()..];
            rest[..rest.find('"').expect("a closed string")].to_string()
        })
        .collect()
}

fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

const LOCK: &str = "oracles/grimoirelab/oracle.lock.json";

/// `GL-01`: the oracle record pins every component and binds its digests
#[test]
fn grimoirelab_gl_01() {
    let lock = read(LOCK);
    for canonical in [
        "chaoss/grimoirelab-perceval",
        "chaoss/grimoirelab-sortinghat",
        "chaoss/grimoirelab",
        "discord/discord-api-docs",
    ] {
        assert!(
            lock.contains(&format!("\"canonical_id\": \"{canonical}\"")),
            "{canonical} is an authority"
        );
    }
    let revisions = values(&lock, "revision");
    assert!(
        revisions.len() >= 5,
        "every authority and upstream corpus names a revision"
    );
    for revision in &revisions {
        assert!(is_hex(revision, 40), "{revision} is a full commit id");
    }
    for digest in values(&lock, "upstream_payload_sha256")
        .iter()
        .chain(values(&lock, "wrapper_sha256").iter())
    {
        assert!(is_hex(digest, 64), "{digest} is a SHA-256");
    }
    let ids = values(&lock, "id");
    for oracle in [
        "grimoirelab-perceval-1.6.2",
        "grimoirelab-sortinghat-1.16.0",
    ] {
        assert!(ids.iter().any(|id| id == oracle), "{oracle} is declared");
    }
    assert_eq!(
        lock.matches("\"covers\": [").count(),
        2,
        "each oracle declares covers"
    );
    assert_eq!(
        lock.matches("\"does_not_cover\": [").count(),
        2,
        "each oracle declares does_not_cover"
    );
    // The SDK's lock stays the SDK's bytes; this record sits beside it.
    assert!(
        !read("standards.lock").contains("grimoirelab"),
        "standards.lock is the SDK's own"
    );
    let result = Command::new("node")
        .args(["oracles/grimoirelab/lock.mjs", "--check"])
        .current_dir(root())
        .output()
        .expect("Node runs the lock check");
    assert!(
        result.status.success(),
        "GL-01: the wrapper and corpus digests match their bytes\n{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

/// `GL-02`: the Discord backend is new files only, with archive replay
#[test]
fn grimoirelab_gl_02() {
    let verify = read("oracles/grimoirelab/verify.sh");
    for refusal in [
        "overlay would replace upstream",
        "the lock pins",
        "--require-hashes",
        "run_tests.py",
        "NO_PROXY='*'",
    ] {
        assert!(verify.contains(refusal), "verify.sh keeps {refusal}");
    }
    let backend = read("oracles/grimoirelab/perceval-discord/perceval/backends/core/discord.py");
    for part in [
        "class Discord(Backend)",
        "class DiscordClient(HttpClient, RateLimitHandler)",
        "class DiscordCommand(BackendCommand)",
        "def sanitize_for_archive",
    ] {
        assert!(backend.contains(part), "the backend declares {part}");
    }
    let tests = read("oracles/grimoirelab/perceval-discord/tests/test_discord.py");
    assert!(
        tests.contains("class TestDiscordBackendArchive(TestCaseBackendArchive)"),
        "the backend is replayed from an archive"
    );
    assert!(!tests.contains("skip"), "no Discord test is skipped");
}

/// `GL-03`: live Discord retrieval is open, and no token is committed
#[test]
fn grimoirelab_gl_03() {
    let lock = read(LOCK);
    assert!(
        lock.contains("live Discord retrieval: that needs the read-only bot"),
        "live retrieval is declared not covered"
    );
    let mut stack = vec![root().join("oracles")];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).expect("a directory").flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(text) = std::fs::read_to_string(&path) {
                // A Discord bot token is three base64url parts joined by dots,
                // the first of which encodes a snowflake (starts "M" or "N").
                let leaked = text
                    .split(|c: char| {
                        !(c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
                    })
                    .any(|word| {
                        let parts: Vec<&str> = word.split('.').collect();
                        parts.len() == 3
                            && parts[0].len() >= 24
                            && parts[1].len() >= 6
                            && parts[2].len() >= 27
                            && (parts[0].starts_with('M') || parts[0].starts_with('N'))
                    });
                assert!(
                    !leaked,
                    "{} holds what looks like a Discord token",
                    path.display()
                );
            }
        }
    }
}
