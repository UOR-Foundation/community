//! The `observations` suite: one test per scenario in `features/suites/observations.feature`.
//!
//! `registerValidHolds` is checked by the Lean kernel when `just vv` runs
//! `prismpm verify` on `app/`. These tests hold fixed what it is about, and that
//! the catalog is the register's and the register the corpus's:
//! `observations/project.mjs --check` re-derives every corpus digest on read in
//! the oracles workflow.

use std::path::PathBuf;

const M: &str = "Foundation.Observation.V1.Model";

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

/// The number after `"key": ` at its first occurrence.
fn number(json: &str, key: &str) -> usize {
    let needle = format!("\"{key}\": ");
    let at = json.find(&needle).expect("the key") + needle.len();
    let rest = &json[at..];
    rest[..rest.find(|c: char| !c.is_ascii_digit()).expect("a number")]
        .parse()
        .expect("a count")
}

/// Each corpus file's path and the digest that follows it; recorded responses are inputs, not files.
fn files(json: &str) -> Vec<(String, String)> {
    let digests = |from: usize| {
        values(&json[from..], "sha256")
            .into_iter()
            .next()
            .expect("a digest")
    };
    json.match_indices("\"path\": \"")
        .map(|(at, n)| {
            let rest = &json[at + n.len()..];
            (
                rest[..rest.find('"').expect("closed")].to_string(),
                digests(at),
            )
        })
        .filter(|(p, _)| p.ends_with(".jsonl.gz") && !p.starts_with("responses/"))
        .collect()
}

/// `OB-01`: every value is a function of admitted observations
#[test]
fn observations_ob_01() {
    let catalog = read("app/src/Observations.lex.tex");
    let start = catalog
        .find("\n  name: registerValidHolds,\n")
        .expect("registerValidHolds is declared");
    let theorem = &catalog[start..start + catalog[start..].find("\n}").expect("closed")];
    assert!(
        theorem.contains(&format!(
            "statement: (({M}::registerValid (release) (subjects) (periods) (metrics) (computations) (observations) (metricValues) (openClaims)) = true),"
        )),
        "registerValidHolds is about the whole register:\n{theorem}"
    );
    assert!(
        theorem.contains("proof: decide{}"),
        "registerValidHolds is proved by decide"
    );
    let model = read("app/src/Foundation/Observation/V1/Model.lex.tex");
    for part in [
        "((admissionDecided observation) && ",
        "((admittedTotal observations) =? (project release admittedCount))",
        "(valuesAdmitted observations metricValues)",
        "(((project observation index) =? (project value observation)) && ((admissionIsPermit (project observation admission)) && ((project observation metric) =? (project value metric))))",
        "(admissionIsPermit (project observation admission)))",
    ] {
        assert!(model.contains(part), "registerValid still checks {part}");
    }
    // The decision function is the app's: one branch per rule, in the app's order, then its default.
    let prompt = read("apps/uor-observation-admission.prompt.json");
    let rules = &prompt[prompt.find("\"rules\"").expect("the rules")..];
    let rules = rules[..rules.find("\"otherwise\"").expect("the default")]
        .matches("\"then\"")
        .count();
    let start = model
        .find("name: admissionDecided,")
        .expect("the decision function");
    let body = &model[start..start + model[start..].find("\n}").expect("closed")];
    assert_eq!(
        body.matches("(if ").count(),
        rules,
        "one branch per admission rule"
    );
}

/// `OB-02`: the corpus is frozen and replayable, and its digest is declared
#[test]
fn observations_ob_02() {
    let corpus = read("observations/corpus.json");
    let replay = read("observations/replay.json");
    let register = read("observations/register.json");
    let catalog = read("app/src/Observations.lex.tex");
    let committed = files(&corpus);
    assert!(!committed.is_empty(), "the corpus holds files");
    assert_eq!(
        files(&replay),
        committed,
        "an independent run reproduced every file, digest for digest"
    );
    let sources = read("observations/sources.json");
    for sha in values(&sources, "refs") {
        assert_eq!(sha.len(), 40, "a ref is pinned by its commit");
    }
    let corpus_digest = &values(&register, "sha256")[1];
    assert!(
        catalog.contains(&format!("corpusDigest := \"sha256:{corpus_digest}\"")),
        "the catalog declares the corpus digest"
    );
    assert_eq!(
        values(&replay, "corpus")[0],
        *corpus_digest,
        "the replay is of this corpus"
    );
}

/// `OB-03`: every contribution is credited by the attribution app, and no name or email is collected
#[test]
fn observations_ob_03() {
    let collect = read("observations/collect.py");
    assert!(
        collect.contains("'email': sha256((ident.get('email') or '').lower().encode())"),
        "an email enters the corpus only as a digest"
    );
    assert!(
        !collect.contains("'name': ident"),
        "a name never enters the corpus"
    );
    // The evaluation observations/project.mjs projects lives in evaluate.mjs.
    let project = read("observations/evaluate.mjs");
    assert!(
        project
            .contains("const attribution = app('apps/uor-contribution-attribution.prompt.json');"),
        "credit is decided by the attribution app"
    );
    assert!(
        project.contains("humans.length === 1 ? 'person' : 'none'"),
        "a delegation names exactly one person"
    );
    let register = read("observations/register.json");
    let credited: usize = ["permit", "deny", "not-applicable", "indeterminate"]
        .iter()
        .map(|o| {
            number(
                &register[register.find("\"attribution\": {").expect("counts")..],
                o,
            )
        })
        .sum();
    assert_eq!(
        credited,
        number(&register, "items"),
        "every contribution has one attribution outcome"
    );
}

/// `OB-04`: an unbound metric or an inexact computation is an open claim
#[test]
fn observations_ob_04() {
    let register = read("observations/register.json");
    let chaoss = read("chaoss/register.json");
    let catalog = read("app/src/Observations.lex.tex");
    let released = number(&chaoss, "metrics");
    let bound = number(&register, "metrics");
    let refused = values(&register, "kind")
        .iter()
        .filter(|k| *k == "metric")
        .count();
    assert_eq!(
        bound + refused,
        released,
        "every released metric is bound or an open claim"
    );
    let claims = number(&register, "refusals");
    assert_eq!(
        catalog
            .matches(&format!("(record {M}::OpenClaim {{"))
            .count(),
        claims,
        "every refusal is one OpenClaim"
    );
    assert!(
        catalog.contains(&format!("openClaimsCount := {claims}")),
        "the release counts every open claim"
    );
}

/// `OB-05`: GitHub enters only from recorded, token-free responses
#[test]
fn observations_ob_05() {
    let collect = read("observations/collect.py");
    let keep = &collect[collect.find("keep = (").expect("the kept headers")..];
    let keep = &keep[..keep.find(')').expect("closed")];
    assert!(
        !keep.contains("Authorization"),
        "no Authorization header is recorded"
    );
    assert!(
        collect.contains("USER_FIELDS = ('login', 'id', 'node_id', 'type')"),
        "a profile keeps its public identity only"
    );
    assert!(
        collect.contains("UNSET_FIELDS = ('name', 'email')")
            && collect.contains("**{k: None for k in UNSET_FIELDS}"),
        "a profile's name and email are recorded and replayed as null"
    );
    let workflow = read(".github/workflows/observations.yml");
    assert_eq!(
        workflow.matches("${{ github.token }}").count(),
        1,
        "the token reaches the recorder only"
    );
    let corpus = read("observations/corpus.json");
    let github = corpus.matches("\"source\": \"github\"").count();
    let discord = corpus.matches("\"source\": \"discord\"").count();
    assert_eq!(
        corpus.matches("\"responses\": {").count(),
        github + discord,
        "every GitHub and Discord file names the responses it was replayed from"
    );
    assert!(discord <= 1, "the Foundation has one guild");
    if discord == 1 {
        let guild = read("observations/responses/discord/guild.json");
        assert!(
            guild.contains("\"path\": \"apps/uor-discord-read.prompt.json\""),
            "every channel was decided by the read app"
        );
        let channels = values(&guild, "channel");
        let decisions = values(&guild, "decision");
        assert_eq!(channels.len(), decisions.len(), "every channel is decided");
        let dir = root().join("observations/responses/discord");
        for entry in std::fs::read_dir(&dir).expect("the Discord record") {
            let name = entry
                .expect("an entry")
                .file_name()
                .into_string()
                .expect("a name");
            if let Some(id) = name.strip_suffix(".jsonl.gz") {
                let at = channels
                    .iter()
                    .position(|c| c == id)
                    .expect("a recorded channel is decided");
                assert_eq!(
                    decisions[at], "permit",
                    "channel {id} was read only because the app permits it"
                );
            }
        }
    }
    for marker in ["MESSAGE_KEYS = ('id', 'channel_id', 'type', 'timestamp', 'edited_timestamp', 'pinned', 'flags')",
                   "'global_name': None", "'name': None if c['type'] in THREADS"] {
        assert!(collect.contains(marker), "the Discord record keeps no text or name: {marker}");
    }
}
