#!/usr/bin/env node
/**
 * The merge controller: one pass over the open pull requests of this
 * repository, deciding each by the two decision apps beside it and acting on
 * the answer. It writes no rule of its own: what it does to a pull request is
 * what uor-stack-step (stack-step.prompt.json, OMG DMN 1.5) and then
 * uor-merge-admission (merge-admission.prompt.json, OASIS XACML 3.0) answer.
 * Both answers come from the same `respond` the compiled guest is checked
 * against (prism-code's journey/spec.mjs, at the builder commit apps/set.json
 * pins), and each prompt is re-checked first, every example and every
 * property over the whole request space; a prompt that fails refuses the run.
 *
 * This file only observes facts and turns them into requests:
 *   repository  automation/repos.json lists this repository as owned
 *   reach       reachOf: the diff's paths and its secrets references, and the speaks-outside label
 *   checks      every check run and status on the head
 *   human       humanOf: an approving human review of the head, or human-approved added after it
 *   draft       the pull request's draft flag
 *
 *   node automation/controller.mjs [--dry-run] [--events <file.jsonl>]
 *   node automation/controller.mjs --facts <facts.json>    decide given facts, touch nothing
 *
 * Every decision is written as a CloudEvents 1.0 record (JSON event format)
 * to --events and to the job summary; that log is the telemetry the agent
 * loop and the next development step read (AUTOMATION.md).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const dry = argv.includes('--dry-run');
const factsFile = opt('--facts');
const eventsFile = opt('--events');

// ---- The builder, addressed by the commit apps/set.json pins (as apps/build.sh fetches it) ----
async function builder() {
  if (process.env.PRISM_BUILDER) return dirname(process.env.PRISM_BUILDER);
  const set = JSON.parse(readFileSync(join(root, 'apps/set.json'), 'utf8')).builder;
  const dir = join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME, '.cache'), 'prism-devrel', set.commit);
  if (!existsSync(join(dir, 'builder/cli.mjs'))) {
    mkdirSync(dir, { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
    git('init', '-q');
    git('fetch', '-q', '--depth', '1', `https://github.com/${set.repository}`, set.commit);
    git('checkout', '-q', 'FETCH_HEAD');
  }
  const at = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (at !== set.commit) throw new Error(`builder checkout is ${at}, not ${set.commit}`);
  return join(dir, 'builder');
}
const b = await builder();
const { checkedSpec } = await import(join(b, 'model.mjs'));
const { judge, respond } = await import(join(b, 'vendor/prism-code/src/journey/spec.mjs'));
const load = (file) => checkedSpec(JSON.parse(readFileSync(join(here, file), 'utf8')).app);
const admission = load('merge-admission.prompt.json');
const stack = load('stack-step.prompt.json');
const decide = (spec, request) => {
  const text = spec.fields.map((f) => request[f.name]).join(' ');
  const outcome = respond(spec, new TextEncoder().encode(text));
  const { rule } = judge(spec, request);
  if (outcome === 'invalid') throw new Error(`${spec.name} refuses ${text}`);
  return { app: spec.name, request: text, outcome, rule: rule ?? 'otherwise' };
};

// ---- Telemetry: CloudEvents 1.0 ----
const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : 'urn:uor:automation:local';
let seq = 0;
function record(subject, data) {
  const event = { specversion: '1.0', id: `${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-${++seq}`, source: runUrl, type: 'org.uorfoundation.automation.decision', subject, time: new Date().toISOString(), datacontenttype: 'application/json', data };
  const line = JSON.stringify(event);
  console.log(line);
  if (eventsFile) appendFileSync(eventsFile, `${line}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `| ${subject} | \`${data.stack?.request ?? ''}\` ${data.stack?.outcome ?? ''} | \`${data.admission?.request ?? ''}\` ${data.admission?.outcome ?? ''} (${data.admission?.rule ?? ''}) | ${data.action} |\n`);
}

if (factsFile) {
  // Offline: decide the given facts, one object per pull request.
  for (const f of JSON.parse(readFileSync(factsFile, 'utf8'))) {
    const s = decide(stack, f);
    const a = s.outcome === 'hold' ? decide(admission, f) : null;
    record(f.subject, { stack: s, admission: a, action: 'none (facts)' });
  }
  process.exit(0);
}

// ---- GitHub ----
const repo = process.env.GITHUB_REPOSITORY;
const gh = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', input, maxBuffer: 1 << 28 });
const get = (path) => JSON.parse(gh([path]));
const all = (path) => JSON.parse(gh(['--paginate', '--slurp', path])).flat();
const act = (what, args, input) => {
  if (dry) return `${what} (dry run)`;
  try {
    gh(args, input);
    return what;
  } catch (e) {
    return `${what} failed: ${String(e.stderr ?? e.message).trim().split('\n').pop()}`;
  }
};

const registry = JSON.parse(readFileSync(join(here, 'repos.json'), 'utf8'));
const owned = registry.owned.some((r) => r.repository.toLowerCase() === repo.toLowerCase());
const self = registry.owned.find((r) => r.repository.toLowerCase() === repo.toLowerCase()) ?? {};
const defaultBranch = get(`repos/${repo}`).default_branch;

/** What the diff reaches (AUTOMATION.md: the human gates H1 to H3). */
function reachOf(pr, files) {
  if (pr.labels.some((l) => l.name === 'speaks-outside')) return 'outside';
  const trust = registry.trustRoot.map((p) => new RegExp(`^${p.replace(/[.]/g, '\\.').replace(/\*\*/g, '.*')}$`));
  if (files.some((f) => trust.some((t) => t.test(f.filename) || (f.previous_filename && t.test(f.previous_filename))))) return 'trust-root';
  const secret = /\$\{\{[^}]*\bsecrets\.|ORG_ADMIN_TOKEN/;
  if (files.some((f) => (f.patch ?? '').split('\n').some((l) => /^[+-]/.test(l) && secret.test(l)))) return 'secrets';
  if (files.some((f) => registry.secretsPaths.some((p) => f.filename.startsWith(p)))) return 'secrets';
  return 'inside';
}

/** A human's approval of exactly this head. */
function humanOf(pr, headDate) {
  const reviews = all(`repos/${repo}/pulls/${pr.number}/reviews`);
  if (reviews.some((r) => r.state === 'APPROVED' && r.commit_id === pr.head.sha && r.user.type === 'User' && r.user.login !== pr.user.login)) return 'approved';
  if (!pr.labels.some((l) => l.name === 'human-approved')) return 'none';
  const labeled = all(`repos/${repo}/issues/${pr.number}/events`).filter((e) => e.event === 'labeled' && e.label?.name === 'human-approved').pop();
  if (labeled && new Date(labeled.created_at) > headDate) return 'approved';
  act('removed a stale human-approved label', ['-X', 'DELETE', `repos/${repo}/issues/${pr.number}/labels/human-approved`]);
  return 'none';
}

function checksOf(sha) {
  const runs = all(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).flatMap((p) => p.check_runs ?? p).filter((c) => !/^automerge\b/.test(c.name));
  const statuses = get(`repos/${repo}/commits/${sha}/status`).statuses ?? [];
  if (!runs.some((c) => new RegExp(registry.gate).test(c.name))) return { checks: 'running', why: `no ${registry.gate} check run yet` };
  if (runs.some((c) => c.status !== 'completed') || statuses.some((s) => s.state === 'pending')) return { checks: 'running' };
  const bad = runs.filter((c) => !['success', 'skipped', 'neutral'].includes(c.conclusion)).map((c) => c.name).concat(statuses.filter((s) => s.state !== 'success').map((s) => s.context));
  return bad.length ? { checks: 'red', why: bad.join(', ') } : { checks: 'green' };
}

function upsertTask(pr, reason, detail) {
  const title = `agent-task: #${pr.number} ${reason}`;
  const open = all(`repos/${repo}/issues?state=open&labels=agent-task&per_page=100`).find((i) => i.title === title);
  const body = `${detail}\n\nPull request: #${pr.number} at ${pr.head.sha}\nDecided by ${runUrl}\n\nThe scheduled agent loop picks this up (automation/AUTOMATION.md, A3).`;
  if (open) return 'agent task already open';
  return act('opened an agent task', ['-X', 'POST', `repos/${repo}/issues`, '--input', '-'], JSON.stringify({ title, body, labels: ['agent-task'] }));
}
const label = (pr, name) => (pr.labels.some((l) => l.name === name) ? `kept ${name}` : act(`labeled ${name}`, ['-X', 'POST', `repos/${repo}/issues/${pr.number}/labels`, '--input', '-'], JSON.stringify({ labels: [name] })));
const unlabel = (pr, name) => (pr.labels.some((l) => l.name === name) ? act(`removed ${name}`, ['-X', 'DELETE', `repos/${repo}/issues/${pr.number}/labels/${encodeURIComponent(name)}`]) : null);

const open = all(`repos/${repo}/pulls?state=open&per_page=100`);
const closed = all(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`);
const mergedHeads = new Map(closed.filter((p) => p.merged_at).map((p) => [p.head.ref, p]));
const openHeads = new Set(open.map((p) => p.head.ref));
// A base is merged into first, then what is stacked on it: oldest base first.
open.sort((x, y) => (x.base.ref === defaultBranch ? 0 : 1) - (y.base.ref === defaultBranch ? 0 : 1) || x.number - y.number);
let merged = 0;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Merge controller${dry ? ' (dry run)' : ''}\n\n| pull request | stack step | merge admission | action |\n|---|---|---|---|\n`);

for (const listed of open) {
  const pr = get(`repos/${repo}/pulls/${listed.number}`);
  const subject = `${repo}#${pr.number}`;
  const base = pr.base.ref === defaultBranch ? 'default' : mergedHeads.has(pr.base.ref) && !openHeads.has(pr.base.ref) ? 'merged' : 'open';
  const mergeable = { dirty: 'conflict', behind: 'behind', unknown: 'unknown' }[pr.mergeable_state] ?? (pr.mergeable === null ? 'unknown' : 'clean');
  const s = decide(stack, { base, mergeable });
  if (s.outcome !== 'hold') {
    let action = 'waited';
    if (s.outcome === 'retarget') action = act(`retargeted to ${mergedHeads.get(pr.base.ref).base.ref}`, ['-X', 'PATCH', `repos/${repo}/pulls/${pr.number}`, '-f', `base=${mergedHeads.get(pr.base.ref).base.ref}`]);
    if (s.outcome === 'update') action = act('updated the branch', ['-X', 'PUT', `repos/${repo}/pulls/${pr.number}/update-branch`, '-f', `expected_head_sha=${pr.head.sha}`]);
    if (s.outcome === 'escalate') action = [label(pr, 'needs-rebase'), upsertTask(pr, 'conflicts with its base', `The head conflicts with \`${pr.base.ref}\`. Merge the base into the head, resolve, and push; regenerate generated files with their generators instead of editing them.`)].join('; ');
    record(subject, { head: pr.head.sha, stack: s, admission: null, action });
    continue;
  }
  unlabel(pr, 'needs-rebase');
  const files = all(`repos/${repo}/pulls/${pr.number}/files?per_page=100`);
  const headCommit = get(`repos/${repo}/commits/${pr.head.sha}`);
  const headDate = new Date(headCommit.commit.committer.date);
  const c = checksOf(pr.head.sha);
  const facts = { repository: owned ? 'owned' : 'shared', reach: reachOf(pr, files), checks: c.checks, human: owned ? humanOf(pr, headDate) : 'none', draft: pr.draft ? 'draft' : 'ready' };
  const a = decide(admission, facts);
  let action = 'none';
  if (a.outcome === 'permit') {
    unlabel(pr, 'held: human gate');
    unlabel(pr, 'held: red');
    const review = act('approved as the controller', ['-X', 'POST', `repos/${repo}/pulls/${pr.number}/reviews`, '--input', '-'], JSON.stringify({ commit_id: pr.head.sha, event: 'APPROVE', body: `Approved by the merge controller acting for the Organization Owner (PROV-O actedOnBehalfOf): uor-merge-admission answers **permit** for \`${a.request}\` (${a.rule}). Decided by ${runUrl}.` }));
    const merge = act('merged with a merge commit', ['-X', 'PUT', `repos/${repo}/pulls/${pr.number}/merge`, '-f', 'merge_method=merge', '-f', `sha=${pr.head.sha}`]);
    action = `${review}; ${merge}`;
    if (!/failed/.test(merge)) merged++;
  } else if (a.outcome === 'deny') {
    const red = facts.checks === 'red';
    action = [label(pr, red ? 'held: red' : 'held: human gate'), red ? upsertTask(pr, 'has failing checks', `Failing: ${c.why}. Reproduce, fix the cause on the head branch, and push; never skip or weaken a check.`) : null].filter(Boolean).join('; ');
  }
  record(subject, { head: pr.head.sha, facts, stack: s, admission: a, checks: c.why, action });
}

// A merge with this run's token starts no push workflow (GitHub Docs, Triggering a workflow from a workflow),
// so the workflows that verify and publish the default branch are dispatched on it.
if (merged && !dry) for (const w of self.dispatchAfterMerge ?? []) record(`${repo}@${defaultBranch}`, { action: act(`dispatched ${w}`, ['-X', 'POST', `repos/${repo}/actions/workflows/${w}/dispatches`, '-f', `ref=${defaultBranch}`]) });
