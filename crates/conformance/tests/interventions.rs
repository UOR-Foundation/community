//! The `interventions` suite: one test per scenario in
//! `features/suites/interventions.feature`.
//!
//! The register is re-derived by its projector, and its charts, effects and
//! untreated onsets are recomputed here by an independent reading of ISO
//! 7870-2:2023 and the three prompts, so neither a hand edit nor a projector
//! defect passes.

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

fn check(dir: &std::path::Path) -> std::process::Output {
    Command::new("node")
        .arg(dir.join("interventions/project.mjs"))
        .arg("--check")
        .output()
        .expect("Node runs the projector")
}

/// Runs `script` as an ES module from the root and asserts it prints `ok`.
fn recompute(script: &str) {
    let out = Command::new("node")
        .current_dir(root())
        .args(["--input-type=module", "-e", script])
        .output()
        .expect("Node runs the recomputation");
    assert!(
        out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "ok",
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

/// An independent first-hit reading of a prompt, the chart tests, and the register.
const COMMON: &str = r#"
import { readFileSync } from 'node:fs';
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const reg = json('interventions/register.json');
const cat = json('automation/interventions.json');
const prompt = (p) => { const a = json(p).app; return (req) => (a.rules.find((r) => r.when.every((c) => req[c.field] === c.value)) ?? { then: a.otherwise }).then; };
const signal = prompt('automation/intervention-signal.prompt.json');
const effect = prompt('automation/intervention-effect.prompt.json');
const { baseline: B, window: W, e2: E2 } = cat.chart;
const near = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
const limits = (xs) => {
  const b = xs.slice(0, -W);
  if (b.length < B) return null;
  const cl = b.reduce((s, x) => s + x, 0) / b.length;
  let mr = 0; for (let i = 1; i < b.length; i++) mr += Math.abs(b[i] - b[i - 1]);
  mr /= b.length - 1;
  return { cl, ucl: cl + E2 * mr, lcl: cl - E2 * mr };
};
const test = (w, l) => ({
  latest: w[w.length - 1] > l.ucl ? 'high' : w[w.length - 1] < l.lcl ? 'low' : 'inside',
  run: w.length < W ? 'none' : w.every((x) => x > l.cl) ? 'high' : w.every((x) => x < l.cl) ? 'low' : 'none',
});
const fail = (m) => { console.log(m); process.exit(1); };
"#;

/// `IV-01`: the register is the projection of its inputs, and a hand edit is refused
#[test]
fn interventions_iv_01() {
    let ok = check(&root());
    assert!(
        ok.status.success(),
        "interventions/project.mjs --check: {}",
        String::from_utf8_lossy(&ok.stderr)
    );

    // The planted defect: a tree whose register says one denied proposal was permitted.
    let scratch = std::env::temp_dir().join(format!("interventions-iv-01-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(scratch.join("interventions")).expect("a scratch directory");
    for dir in ["observations", "automation", "chaoss", "governance", "apps"] {
        std::os::unix::fs::symlink(root().join(dir), scratch.join(dir)).expect("a linked input");
    }
    std::fs::copy(
        root().join("interventions/project.mjs"),
        scratch.join("interventions/project.mjs"),
    )
    .expect("the projector");
    let register = read("interventions/register.json");
    let edited = register.replacen("\"admission\": \"deny\"", "\"admission\": \"permit\"", 1);
    assert_ne!(
        edited, register,
        "the register has a denied proposal to edit"
    );
    std::fs::write(scratch.join("interventions/register.json"), edited)
        .expect("the planted register");
    let planted = check(&scratch);
    let _ = std::fs::remove_dir_all(&scratch);
    assert!(
        !planted.status.success(),
        "a hand-edited register is refused"
    );
    assert!(
        String::from_utf8_lossy(&planted.stderr).contains("is not the projection"),
        "with the projection diagnostic"
    );
}

/// `IV-02`: every chart is an ISO 7870-2 individuals chart and its signal the app's answer
#[test]
fn interventions_iv_02() {
    recompute(&format!(
        "{COMMON}
for (const ch of reg.charts) {{
  const l = limits(ch.values);
  if (!l) {{ if (ch.request.baseline !== 'short' || ch.signal !== 'insufficient') fail(`${{ch.id}}: a short baseline is insufficient`); continue; }}
  if (!near(l.cl, ch.limits.cl) || !near(l.ucl, ch.limits.ucl) || !near(l.lcl, ch.limits.lcl)) fail(`${{ch.id}}: limits`);
  const t = test(ch.values.slice(-W), l);
  if (ch.request.baseline !== 'enough' || t.latest !== ch.request.latest || t.run !== ch.request.run) fail(`${{ch.id}}: tests`);
  if (signal(ch.request) !== ch.signal) fail(`${{ch.id}}: signal`);
}}
if (!reg.charts.length) fail('no chart');
console.log('ok');"
    ));
}

/// `IV-03`: nothing reaches people without a human
#[test]
fn interventions_iv_03() {
    let register = read("interventions/register.json");
    assert!(
        register.contains("\"reach\": \"people\""),
        "the register has proposals that reach people"
    );
    recompute(&format!(
        "{COMMON}
const ids = new Set(json('automation/intervention-approvals.json').approvals.map((a) => a.proposal));
for (const p of reg.proposals) {{
  if (p.reach === 'people' && p.admission !== 'deny') fail(`${{p.id}} reaches people and is ${{p.admission}}`);
  if (p.reach === 'agent-task' && p.admission === 'permit' && !ids.has(p.id)) fail(`${{p.id}}: an agent task without approval`);
  if (p.request.approval !== (ids.has(p.id) ? 'exact' : 'none')) fail(`${{p.id}}: approval`);
}}
console.log('ok');"
    ));
    let runner = read("automation/interventions.mjs");
    let writes: Vec<&str> = runner.matches("'-X', '").collect();
    assert_eq!(writes.len(), 1, "the runner makes one kind of write");
    assert!(
        runner.contains("gh(['-X', 'POST', `repos/${repo}/issues`")
            && runner.contains("if (repo !== HOME) return")
            && runner.contains("const HOME = 'UOR-Foundation/community';"),
        "and it is an issue in its own repository"
    );
    assert!(
        runner.contains("throw new Error(`${p.id}: a proposal that reaches people was permitted"),
        "a permitted people proposal refuses the run"
    );
    assert!(
        runner.contains("'interventions/project.mjs'), '--check'"),
        "the runner re-derives the register before it acts"
    );
    let repos = read("automation/repos.json");
    assert!(
        repos.contains("\"automation/**\""),
        "the approvals, the catalog and the prompts are in the trust root"
    );
}

/// `IV-04`: effects and untreated onsets are the effect app's answers
#[test]
fn interventions_iv_04() {
    recompute(&format!(
        "{COMMON}
const req = (s, l, post) => {{ const t = test(post.slice(0, W), l); return {{ signal: s, after: signal({{ baseline: 'enough', ...t }}), span: post.length >= W ? 'full' : 'partial' }}; }};
let n = 0;
for (const ch of reg.charts) {{
  let before = null;
  for (let t = B + W - 1; t < ch.values.length - 1; t++) {{
    const xs = ch.values.slice(0, t + 1);
    const l = limits(xs);
    const s = signal({{ baseline: 'enough', ...test(xs.slice(-W), l) }});
    const onset = (s === 'rise' || s === 'fall') && s !== before;
    before = s;
    if (!onset) continue;
    const u = reg.untreated[n++];
    const r = req(s, l, ch.values.slice(t + 1));
    if (!u || u.chart !== ch.id || u.at !== t || u.signal !== s || JSON.stringify(u.request) !== JSON.stringify(r) || u.effect !== effect(r)) fail(`${{ch.id}} at ${{t}}`);
  }}
}}
if (n !== reg.untreated.length) fail('untreated onsets');
for (const e of reg.effects) if (e.request && e.effect !== effect(e.request)) fail(`${{e.proposal}}: effect`);
console.log('ok');"
    ));
}

/// `IV-05`: what is not yet proved or charted is said so
#[test]
fn interventions_iv_05() {
    let set = read("apps/set.json");
    for app in [
        "intervention-signal",
        "intervention-admission",
        "intervention-effect",
    ] {
        assert!(
            !set.contains(app),
            "{app} is not in apps/set.json yet; when it is, IV-05 closes"
        );
    }
    let register = read("interventions/register.json");
    assert!(
        register.contains("\"refusal\": \"gapped\""),
        "a gapped chart is a refusal"
    );
    assert!(
        !register.contains("\"subject\": \"discord:"),
        "no chart of the Discord guild until a chat computation is bound"
    );
}
