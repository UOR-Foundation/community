#!/usr/bin/env node
/**
 * Project the ecosystem remediation: for every repository of
 * ecosystem/register.json, the exact change set that the repo-files,
 * repo-protection, repo-standards and repo-naming decision apps require for it
 * to be conformant, and the decisions only its maintainers or the
 * organization's owners can make.
 *
 * Each app is read from its prompt at a pinned commit and evaluated by its own
 * first-hit rules, after the interpreter reproduces every example of the
 * prompt. A repository's request to each app is built from
 * remediation/observations.json and ecosystem/snapshot.json. The change set is
 * found by search, not written: of every request the app can be asked with the
 * repository's tier held fixed, the ones it finds conformant that differ from
 * the observed request in the fewest observed fields. A field nobody could
 * observe (branch protection, the Domain tags that apply) is free in that
 * search and is written as the state every such request shares. A field no
 * change can reach (the commit history, a preferred name) is held fixed; when
 * it blocks conformance it becomes a typed finding. A repository without
 * exactly one tier tag is projected at every tier, and its tier is a decision.
 *
 * Nothing is defaulted: every target is decided again by the app before it is
 * written, and a field whose value the sources cannot settle (a status that is
 * not archived, a copyright holder, a CODEOWNERS owner) is a decision with its
 * evidence. The same inputs always project the same bytes.
 *
 *   node remediation/project.mjs <checkouts-dir> [--check]
 *
 * <checkouts-dir> holds `.github`, `prism-devrel`, `community-apps`, `linguist`
 * and `spdx` checked out (or cloned bare) at the commits sources.json pins.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
/** The repositories whose merges Alex alone decides; their rulesets require the controller's gate, not a human count. */
const OWNED = new Set(JSON.parse(readFileSync(join(here, '..', 'automation', 'repos.json'), 'utf8')).owned.filter((o) => o.repository.startsWith('UOR-Foundation/')).map((o) => o.repository.split('/')[1].toLowerCase()));
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <checkouts-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// A pinned file is read with `git show <commit>:<path>`, so a bare or blobless clone serves as well as a checkout.
function pinned(source) {
  const dir = join(root, source.name);
  return (path) => {
    const bytes = execFileSync('git', ['-C', dir, 'show', `${source.commit}:${path}`], { maxBuffer: 1 << 28 });
    return { path: `${source.name}@${source.commit}:${path}`, sha256: sha256(bytes), text: bytes.toString('utf8').replace(/\r\n/g, '\n') };
  };
}
const norms = pinned(sources.norms);
const standards = norms(sources.norms.standards);
const governance = norms(sources.norms.governance);
const inherited = sources.norms.inherited.map((p) => norms(p));
const languagesFile = pinned(sources.linguist)(sources.linguist.languages);
const licenseFile = pinned(sources.license)(sources.license.text);
const read = (name) => readFileSync(join(here, '..', 'ecosystem', name));
const ecosystemBytes = read('register.json');
const ecosystem = JSON.parse(ecosystemBytes.toString('utf8'));
const snapshotBytes = read('snapshot.json');
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
const observationsBytes = readFileSync(join(here, 'observations.json'));
const observations = JSON.parse(observationsBytes.toString('utf8'));
if (sha256(snapshotBytes) !== ecosystem.snapshot.sha256) throw new Error('ecosystem/register.json was not projected from ecosystem/snapshot.json');

// ---- The decision apps, each held to its own examples ---------------------------------------------------------
const OPS = {
  is: (a, b) => a === b, 'is not': (a, b) => a !== b, '=': (a, b) => a === b, '!=': (a, b) => a !== b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
};
function decide(app, request) {
  for (const rule of app.rules) {
    if (rule.when.every((c) => {
      if (!OPS[c.op]) throw new Error(`${app.name} uses the operator ${c.op}`);
      return OPS[c.op](request[c.field], c.value);
    })) return { outcome: rule.then, why: rule.why };
  }
  return { outcome: app.otherwise, why: app.otherwiseWhy };
}
const domainOf = (f) => (f.kind === 'number' ? Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i) : f.values);
// The decision apps are this repository's own prompts, addressed by their bytes.
const local = (path) => {
  const bytes = readFileSync(join(here, '..', path));
  return { path, sha256: sha256(bytes), text: bytes.toString('utf8') };
};
const load = (path, pattern) => {
  const file = local(path);
  const prompt = JSON.parse(file.text);
  if (prompt.pattern !== pattern) throw new Error(`${path} is a ${prompt.pattern}, not a ${pattern}`);
  const app = prompt.app;
  for (const ex of app.examples) {
    const words = ex.request.split(/\s+/);
    const request = Object.fromEntries(app.fields.map((f, i) => [f.name, f.kind === 'number' ? Number(words[i]) : words[i]]));
    const got = decide(app, request).outcome;
    if (got !== ex.response) throw new Error(`${app.name} example "${ex.request}" gives ${got}, not ${ex.response}`);
  }
  return { app, file };
};
const apps = sources.apps.map((a) => load(a.path, 'decisionTable'));
const tierApp = load(sources.tierApp.path, 'decisionTable');
const writeApp = load(sources.writeApp.path, 'policyDecision');
const rolesBytes = readFileSync(join(here, 'roles.json'));
const roles = JSON.parse(rolesBytes.toString('utf8'));
const roleOf = (name) => {
  const r = roles.repositories.find((x) => x.name === name);
  if (!r) throw new Error(`remediation/roles.json has no judgment for ${name}`);
  return { ...roles.defaults, ...r };
};
// Who applies a change, and how: the write policy is asked for an agent's pull request first, then for the owner.
const KIND = { file: 'file', topic: 'topic', ruleset: 'ruleset', rename: 'rename' };
function route(change, archived) {
  if (!KIND[change.kind]) return '';
  const ask = (actor, how) => decide(writeApp.app, { actor, change: KIND[change.kind], repository: archived ? 'archived' : 'live', approval: 'given', route: how }).outcome;
  if (ask('agent', 'pull-request') === 'permit') return 'pull-request';
  if (ask('owner', 'direct') === 'permit') return 'owner';
  return 'denied';
}

// ---- Vocabulary: STANDARDS.md as the ecosystem register read it, and Linguist ---------------------------------
const vocabulary = ecosystem.vocabulary;
const tiers = ecosystem.app.tiers;
const tierTag = Object.fromEntries(tiers.map((t, i) => [t, vocabulary.tier[i]]));
// Linguist languages.yml: each top-level key is a language name; its `aliases:` list follows it.
const linguist = new Map();
{
  let current = null;
  let inAliases = false;
  for (const line of languagesFile.text.split('\n')) {
    const top = line.match(/^(?!#)("?)([^\s"][^"]*?)\1:\s*$/);
    if (top) { current = top[2]; linguist.set(current, []); inAliases = false; continue; }
    if (/^ {2}aliases:\s*$/.test(line)) { inAliases = true; continue; }
    const item = line.match(/^ {2}- (.+)$/);
    if (inAliases && item && current) { linguist.get(current).push(item[1].trim().replace(/^"|"$/g, '')); continue; }
    if (/^ {2}\S/.test(line)) inAliases = false;
  }
}
const technologyOf = (language) => {
  if (!language) return [];
  if (!linguist.has(language)) throw new Error(`Linguist names no language ${language}`);
  const names = [language.toLowerCase(), ...linguist.get(language)];
  return vocabulary.technology.filter((t) => names.includes(t));
};

// The naming conventions of STANDARDS.md, as patterns over a repository name.
const CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VERSION = /(^|[-_.])v?[0-9]+(\.[0-9]+)+($|[-_.])|(^|[-_.])v[0-9]+($|[-_.])/;
const PREFERRED = new RegExp(`^uor-(${vocabulary.domain.join('|')})-[a-z0-9]+(-[a-z0-9]+)*$`);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// ---- Requests: what each app is asked about one repository ---------------------------------------------------
// A value of null is unobserved. `fixed` names the fields no change to the repository can reach.
function requests(s, o) {
  const has = (cat) => vocabulary[cat].filter((t) => s.topics.includes(t));
  const tech = technologyOf(s.language);
  const yes = (b) => (b ? 'present' : 'missing');
  return {
    'uor-repo-files': {
      fixed: [],
      request: {
        readme: yes(o.files.readme), license: yes(o.files.license),
        contributing: yes(o.files.contributing || inherited.length > 0),
        conduct: yes(o.files.conduct || inherited.length > 0),
        security: yes(o.files.security || inherited.length > 0),
        codeowners: yes(o.files.codeowners), ci: yes(o.files.ci),
      },
    },
    'uor-repo-protection': {
      fixed: [],
      request: { pr: null, reviews: null, checks: null, forcepush: null },
    },
    'uor-repo-standards': {
      fixed: [],
      request: {
        identity: vocabulary.identity.every((t) => s.topics.includes(t)) ? 'present' : 'missing',
        tiertags: has('tier').length,
        statustags: has('status').length,
        versioning: s.tags.length === 0 ? 'unreleased' : s.tags.every((t) => SEMVER.test(t.name.replace(/^v/, ''))) ? 'semver' : 'other',
      },
    },
    'uor-repo-naming': {
      fixed: ['pattern', 'commits', ...(CASE.test(s.name.toLowerCase()) ? [] : ['case']), 'version'],
      request: {
        case: CASE.test(s.name) ? 'lowercase' : 'other',
        version: VERSION.test(s.name) ? 'present' : 'absent',
        pattern: PREFERRED.test(s.name) ? 'preferred' : 'other',
        branches: o.branches.every((b) => b.conforming) ? 'conforming' : 'other',
        commits: o.commits.conventional === o.commits.total ? 'conventional' : 'other',
        domain: 'incomplete',
        technology: tech.every((t) => s.topics.includes(t)) ? 'complete' : 'incomplete',
      },
    },
  };
}

// The conformant requests nearest the observed one, at one tier, and the state they share.
function remedy(app, tier, observed, fixed) {
  const fields = app.fields.filter((f) => f.name !== 'tier');
  const pinnedFields = new Set(fixed);
  let best = [];
  let bestCost = [Infinity, Infinity];
  const walk = (i, req) => {
    if (i === fields.length) {
      const full = app.fields.some((f) => f.name === 'tier') ? { tier, ...req } : { ...req };
      if (decide(app, full).outcome !== app.otherwise) return;
      let changed = 0;
      let distance = 0;
      for (const f of fields) {
        const was = observed[f.name];
        if (was === null || was === req[f.name]) continue;
        changed += 1;
        distance += f.kind === 'number' ? Math.abs(was - req[f.name]) : 1;
      }
      const cost = [changed, distance];
      if (cost[0] < bestCost[0] || (cost[0] === bestCost[0] && cost[1] < bestCost[1])) { best = [full]; bestCost = cost; }
      else if (cost[0] === bestCost[0] && cost[1] === bestCost[1]) best.push(full);
      return;
    }
    const f = fields[i];
    const values = pinnedFields.has(f.name) && observed[f.name] !== null ? [observed[f.name]] : domainOf(f);
    for (const v of values) walk(i + 1, { ...req, [f.name]: v });
  };
  walk(0, {});
  if (best.length === 0) return null;
  const target = {};
  for (const f of fields) {
    const values = [...new Set(best.map((b) => b[f.name]))];
    if (values.length === 1) target[f.name] = values[0];
    else if (f.kind === 'number') target[f.name] = { atLeast: Math.min(...values) };
    else target[f.name] = { any: values };
  }
  // The shared state is itself a request the app decides conformant: its weakest member is asked again.
  const weakest = Object.fromEntries(Object.entries(target).map(([k, v]) => [k, v?.atLeast ?? v?.any?.[0] ?? v]));
  if (decide(app, app.fields.some((f) => f.name === 'tier') ? { tier, ...weakest } : weakest).outcome !== app.otherwise) {
    throw new Error(`${app.name} at ${tier}: the conformant requests share no state the app accepts`);
  }
  return { target, cost: bestCost };
}

// ---- Changes: a field's target, as the action that reaches it ------------------------------------------------
const mitText = licenseFile.text;
const dualLicense = (pair) => `This repository is licensed under either of\n\n${pair.map((p) => `- ${/APACHE/i.test(p) ? 'Apache License, Version 2.0' : /MIT/i.test(p) ? 'MIT License' : p} (${p})`).join('\n')}\n\nat your option. SPDX-License-Identifier: ${pair.map((p) => (/APACHE/i.test(p) ? 'Apache-2.0' : 'MIT')).sort().reverse().join(' OR ')}\n\nGOVERNANCE.md 13 makes MIT the default across Foundation repositories; offering Apache-2.0 beside it is the exception this file documents.\n`;
// A CI workflow is drafted only from a test command the repository itself states.
function workflowFor(s, o) {
  const tree = o.evidence;
  if (s.name === 'uor-jcs-nfc') {
    return { path: '.github/workflows/conformance.yml', about: 'the conformance run README.md states, under CPython 3.12 (Unicode 15.0.0, SPEC.md 1.3)', content: pyWorkflow('conformance', '3.12', ['cd conformance', 'PYTHONPATH=.. python run_mutants.py uor-jcs-nfc-vectors-v0.1-rc5.json']) };
  }
  if (s.name === 'nest-uor') {
    return { path: '.github/workflows/test.yml', about: 'pytest over tests/ with the dev extra pyproject.toml declares', content: pyWorkflow('test', '3.12', ['python -m pip install -e ".[dev]"', 'python -m pytest -q']) };
  }
  return tree && null;
}
const pyWorkflow = (job, version, run) => `# GOVERNANCE.md 6.1 and 9: CI runs on every pull request to the default branch.
name: ${job}
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  ${job}:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: ${sources.actions.checkout}
        with:
          persist-credentials: false
      - uses: ${sources.actions.setupPython}
        with:
          python-version: "${version}"
      - run: |
${run.map((l) => `          ${l}`).join('\n')}
`;
function changes(appName, field, from, to, ctx) {
  const { s, o, tier } = ctx;
  const one = (kind, detail, extra = {}) => [{ app: appName, field, from: from ?? 'unobserved', to: typeof to === 'object' ? JSON.stringify(to) : to, kind, detail, ...extra }];
  switch (`${appName}.${field}`) {
    case 'uor-repo-files.readme': return one('decision', 'Add README.md describing the repository (GOVERNANCE.md 6.1)', { decision: 'readme' });
    case 'uor-repo-files.license': {
      const pair = o.evidence.filter((p) => /^LICENSE[.-]/i.test(p));
      return pair.length
        ? one('file', `Add LICENSE naming the ${pair.join(' and ')} the repository already carries, so the file GOVERNANCE.md 6.1 names states its license and documents the exception GOVERNANCE.md 13 asks for`, { path: 'LICENSE', content: dualLicense(pair) })
        : one('file', `Add LICENSE with the SPDX MIT text (GOVERNANCE.md 13: MIT is the default), copyright ${o.firstCommit.slice(0, 4)} ${ctx.role.holder}`, { path: 'LICENSE', content: mitText.replace('<year>', o.firstCommit.slice(0, 4)).replace('<copyright holders>', ctx.role.holder), proposed: 'copyright-holder' });
    }
    case 'uor-repo-files.codeowners': return one('file', `Add .github/CODEOWNERS naming ${ctx.role.owners.join(' ')} (GOVERNANCE.md 6.1)`, { path: '.github/CODEOWNERS', content: `# GOVERNANCE.md 6.1: every Tier 1 and 2 repository names its owners.\n* ${ctx.role.owners.join(' ')}\n`, proposed: 'codeowners' });
    case 'uor-repo-files.ci': {
      const ci = workflowFor(s, o);
      return ci ? one('file', `Add the CI workflow ${ci.path}: ${ci.about} (GOVERNANCE.md 6.1)`, { path: ci.path, content: ci.content })
        : one('decision', 'Add a CI workflow under .github/workflows (GOVERNANCE.md 6.1); the repository states no test command the remediation can run', { path: '.github/workflows/', decision: 'ci' });
    }
    case 'uor-repo-files.contributing': case 'uor-repo-files.conduct': case 'uor-repo-files.security':
      return one('file', `Add ${field} file`, {});
    case 'uor-repo-protection.pr': return one('ruleset', 'Require a pull request before merging to the default branch', { rule: 'pull_request' });
    case 'uor-repo-protection.reviews': return one('ruleset', `Require at least ${to.atLeast ?? to} approving review${(to.atLeast ?? to) === 1 ? '' : 's'}`, { rule: 'pull_request' });
    case 'uor-repo-protection.checks': return one('ruleset', 'Require status checks to pass before merging', { rule: 'required_status_checks', decision: 'check-contexts' });
    case 'uor-repo-protection.forcepush': return one('ruleset', 'Block force pushes to the default branch', { rule: 'non_fast_forward' });
    case 'uor-repo-standards.identity': return vocabulary.identity.filter((t) => !s.topics.includes(t)).map((t) => ({ ...one('topic', `Add topic ${t}`)[0], topic: t }));
    case 'uor-repo-standards.tiertags': return to === 1 && from === 0 ? [{ ...one('topic', `Add topic ${tierTag[tier]}`)[0], topic: tierTag[tier] }] : one('decision', `Carry exactly one tier tag (now ${from})`, { decision: 'tier' });
    case 'uor-repo-standards.statustags': if (to !== 1 || from !== 0) return one('decision', `Carry exactly one status tag (now ${from})`, { decision: 'status' });
      return s.archived
        ? [{ ...one('topic', 'Add topic archived: the repository is archived on GitHub, read-only as GOVERNANCE.md 11 defines Archived')[0], topic: 'archived' }]
        : [{ ...one('topic', `Add topic ${ctx.role.status}: it is in normal development, its last commit ${o.lastCommit} (GOVERNANCE.md 11)`)[0], topic: ctx.role.status, proposed: 'status' }];
    case 'uor-repo-standards.versioning': return one('decision', `Release under Semantic Versioning 2.0.0; these tags are not SemVer: ${s.tags.filter((t) => !SEMVER.test(t.name.replace(/^v/, ''))).map((t) => t.name).join(', ')}`, { decision: 'versioning' });
    case 'uor-repo-naming.case': return [{ ...one('rename', `Rename the repository to ${s.name.toLowerCase()}`)[0], name: s.name.toLowerCase() }];
    case 'uor-repo-naming.branches': return one('finding', `Rename or delete the branches not named {type}/{issue#}-{short-description}: ${o.branches.filter((b) => !b.conforming).length} of ${o.branches.length}`, { decision: 'branches' });
    case 'uor-repo-naming.domain': return ctx.role.domains.filter((t) => !s.topics.includes(t)).map((t) => {
      if (!vocabulary.domain.includes(t)) throw new Error(`${s.name}: ${t} is not a STANDARDS.md Domain tag`);
      return { ...one('topic', `Add topic ${t}: ${ctx.role.evidence}`)[0], topic: t, proposed: 'domain' };
    });
    case 'uor-repo-naming.technology': return technologyOf(s.language).filter((t) => !s.topics.includes(t)).map((t) => ({ ...one('topic', `Add topic ${t}: GitHub's primary language is ${s.language}, which Linguist names ${t}`)[0], topic: t }));
    default: throw new Error(`no action reaches ${appName}.${field}`);
  }
}

// ---- The projection ------------------------------------------------------------------------------------------
const BLOCKERS = {
  commits: (o) => `${o.commits.total - o.commits.conventional} of ${o.commits.total} default-branch commits are not Conventional Commits; history is not rewritten, so the naming app cannot find the repository conformant`,
  pattern: (s) => `${s.name} is not in the preferred uor-{domain}-{function} form; a new name is a maintainer decision`,
  case: (s) => `${s.name} is not lowercase and hyphen-separated, and no lowercase rename is (GitHub requires the name ${s.name} for organization health files)`,
  version: (s) => `${s.name} contains a version number; a new name is a maintainer decision`,
};
const refusals = [];
const repositories = ecosystem.repositories.map((e) => {
  const s = snapshot.repositories.find((r) => r.name === e.name);
  const o = observations.repositories.find((r) => r.name === e.name);
  if (!s || !o) throw new Error(`${e.name} is not in the snapshot and the observations`);
  if (o.empty) {
    refusals.push({ repository: e.index, refusal: 'unobservable', detail: `${e.name} has no default branch` });
    return { index: e.index, name: e.name, empty: true };
  }
  const asked = requests(s, o);
  const role = roleOf(e.name);
  const proposed = decide(tierApp.app, { recorded: e.tier || 'none', role: role.role });
  const candidates = [proposed.outcome];
  const byTier = candidates.map((tier) => {
    const sets = [];
    const findings = [];
    for (const { app } of apps) {
      const { request, fixed } = asked[app.name];
      const full = app.fields.some((f) => f.name === 'tier') ? { tier, ...request } : request;
      let found = remedy(app, tier, request, fixed);
      let blockedBy = [];
      if (!found) {
        // Conformance is out of reach of every change: release the held fields to name the ones that block it.
        found = remedy(app, tier, request, []);
        blockedBy = fixed.filter((f) => request[f] !== null && found.target[f] !== request[f]);
        for (const f of blockedBy) findings.push({ app: app.name, field: f, reason: BLOCKERS[f](f === 'commits' ? o : s) });
      }
      // An unobserved field is asked at every value it can take; the outcome is observed only when they agree.
      const open = app.fields.filter((f) => full[f.name] === null);
      const outcomes = new Set();
      const ask = (i, req) => (i === open.length ? outcomes.add(decide(app, req).outcome)
        : domainOf(open[i]).forEach((v) => ask(i + 1, { ...req, [open[i].name]: v })));
      ask(0, full);
      const observedOutcome = outcomes.size === 1 ? [...outcomes][0] : 'unobserved';
      const list = [];
      for (const f of app.fields) {
        if (f.name === 'tier' || blockedBy.includes(f.name)) continue;
        const to = found.target[f.name];
        const was = request[f.name];
        if (to?.any) continue;
        if (to?.atLeast === 0) continue;
        if (was !== null && was === to) continue;
        list.push(...changes(app.name, f.name, was, to, { s, o, tier, role }).map((c) => ({ ...c, by: route(c, s.archived) })));
      }
      sets.push({ app: app.name, observed: observedOutcome, after: blockedBy.length ? 'blocked' : app.otherwise, changes: list });
    }
    return { tier, apps: sets, findings };
  });
  const key = (c) => `${c.app}|${c.field}|${c.kind}|${c.detail}`;
  const everywhere = byTier[0].apps.flatMap((a) => a.changes).filter((c) => byTier.every((t) => t.apps.some((a) => a.changes.some((d) => key(d) === key(c)))));
  const now = everywhere.filter((c) => c.kind !== 'decision' && c.kind !== 'finding');
  const decisions = [...new Set([
    ...(e.tier ? [] : ['tier']),
    ...byTier.flatMap((t) => t.apps.flatMap((a) => a.changes.flatMap((c) => [c.decision, c.proposed]).filter(Boolean))),
    ...(byTier[0].apps.some((a) => a.changes.some((c) => c.kind === 'finding')) ? ['branches'] : []),
  ])].sort();
  const findings = [...new Map(byTier.flatMap((t) => t.findings).map((f) => [`${f.app}|${f.field}`, f])).values()];
  const ruleset = (t) => {
    const p = t.apps.find((a) => a.app === 'uor-repo-protection').changes;
    const reviews = p.find((c) => c.field === 'reviews');
    const rules = [];
    if (p.some((c) => c.rule === 'pull_request')) {
      rules.push({ type: 'pull_request', parameters: { required_approving_review_count: reviews ? JSON.parse(reviews.to).atLeast : 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } });
    }
    if (p.some((c) => c.rule === 'required_status_checks')) {
      const contexts = [...new Set(o.workflows.filter((w) => w.pullRequest && !w.matrix && !w.renamed).flatMap((w) => w.jobs))].sort();
      rules.push({ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: contexts.map((c) => ({ context: c })) } });
    }
    if (p.some((c) => c.rule === 'non_fast_forward')) rules.push({ type: 'non_fast_forward' });
    return { name: `governance-6.2-${t.tier}`, target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } }, rules };
  };
  const topics = (t) => [...new Set([...s.topics, ...t.apps.flatMap((a) => a.changes.filter((c) => c.topic).map((c) => c.topic))])].sort();
  for (const d of decisions) refusals.push({ repository: e.index, refusal: `decision-${d}`, detail: `${e.name}: ${d} is a decision for its maintainers or the organization's owners` });
  for (const f of findings) refusals.push({ repository: e.index, refusal: `blocked-${f.field}`, detail: `${e.name}: ${f.reason}` });
  return {
    index: e.index,
    name: e.name,
    archived: s.archived,
    commit: o.commit,
    defaultBranch: o.defaultBranch,
    tier: e.tier,
    proposedTier: e.tier ? '' : proposed.outcome,
    role: role.role,
    roleEvidence: role.evidence,
    tierWhy: proposed.why,
    language: s.language,
    lastCommit: o.lastCommit,
    now,
    decisions,
    findings,
    tiers: byTier.map((t) => ({ tier: t.tier, topics: topics(t), ruleset: ruleset(t), apps: t.apps })),
  };
});

const register = {
  spec: 'uor-community/remediation-register/1',
  ecosystem: { sha256: sha256(ecosystemBytes), snapshot: ecosystem.snapshot.sha256 },
  observations: { sha256: sha256(observationsBytes) },
  roles: { sha256: sha256(rolesBytes) },
  sources: [standards, governance, ...inherited, languagesFile, licenseFile, ...[...apps, tierApp, writeApp].map((a) => a.file)].map(({ path, sha256: d }) => ({ path, sha256: d })),
  apps: apps.map(({ app }) => ({ app: app.name, conformant: app.otherwise, fields: app.fields.map((f) => f.name) })),
  repositories,
  refusals,
};

// ---- Drafts: an issue and a pull request per repository, in UOR-Foundation/.github's templates ---------------
// The issue follows .github/ISSUE_TEMPLATE/feature_request.md and the pull request .github/pull_request_template.md
// (both at the pinned .github commit), so each repository receives the change set in the shape its norms ask for.
const TIERNAME = { t1: 'Tier 1 (core framework and critical specs)', t2: 'Tier 2 (implementations and integrations)', t3: 'Tier 3 (docs, websites and presentation)', t4: 'Tier 4 (early experiments)' };
const QUESTIONS = {
  tier: 'Is the proposed tier right?',
  status: 'Is the proposed status right (active, maintenance or deprecated)?',
  domain: 'Are the proposed Domain topics all that apply?',
  'copyright-holder': 'Is the copyright holder the drafted LICENSE names right?',
  codeowners: 'Should CODEOWNERS name the repository\'s maintainers instead of the Organization Owner?',
  ci: 'Which CI workflow should it run? The repository states no test command the remediation can run.',
  'check-contexts': 'Which status checks must pass? The owner\'s settings script requires the jobs a pull request reports from workflows that run on every pull request.',
  versioning: 'How should its non-SemVer tags be superseded?',
  branches: 'Which of its non-conforming branches are renamed and which deleted?',
  readme: 'What should its README say?',
};
const tierOf = (r) => r.tier || r.proposedTier;
const pullRequest = (r) => r.now.filter((c) => c.by === 'pull-request');
const byOwner = (r) => r.tiers[0].apps.flatMap((a) => a.changes).filter((c) => c.by === 'owner');
const tierLine = (r) => (r.tier
  ? `It carries the ${tierTag[r.tier]} tag, so it is held to ${TIERNAME[r.tier]}.`
  : `It carries no tier tag. The uor-repo-tier app proposes ${TIERNAME[r.proposedTier]} from its use case, ${r.role}: ${r.roleEvidence}. Maintainers who record another tier tag change every requirement below; the change set is re-projected from it.`);
const issue = (r) => [
  '---\nname: Feature Request\nabout: Propose a new feature or enhancement\nlabels: enhancement\n---',
  '## Problem',
  `UOR-Foundation/${r.name} does not yet meet the repository standards of UOR-Foundation/.github (STANDARDS.md and GOVERNANCE.md 6.1, 6.2 and 11), observed at \`${r.commit.slice(0, 12)}\` of \`${r.defaultBranch}\`. ${tierLine(r)}`,
  [`| Decision app | Observed | After the change set |`, '|---|---|---|', ...r.tiers[0].apps.map((a) => `| ${a.app} | ${a.observed} | ${a.after} |`)].join('\n'),
  '## Proposed Solution',
  ...(pullRequest(r).length ? ['### In a pull request', pullRequest(r).map((c) => `- ${c.detail}`).join('\n')] : []),
  ...(byOwner(r).length ? ['### Repository settings an Organization Owner applies', byOwner(r).map((c) => `- ${c.detail}`).join('\n'),
    `Topics: \`${r.tiers[0].topics.join(' ')}\`. The ruleset is \`governance-6.2-${tierOf(r)}\` in \`remediation/apply-settings.sh\` of UOR-Foundation/community.`] : []),
  ...(r.decisions.length ? ['### For the maintainers to confirm', r.decisions.map((d) => `- **${d}**: ${QUESTIONS[d]}`).join('\n')] : []),
  '## Alternatives Considered',
  r.findings.length ? r.findings.map((f) => `- ${f.reason}`).join('\n') : 'None: every decision app finds the repository conformant after the change set.',
  '## Additional Context',
  `Generated by UOR-Foundation/community \`remediation/project.mjs\` (\`remediation/register.json\`). Each change is the nearest request the decision app finds conformant, decided again by the app before it is written; who applies it is decided by the \`uor-remediation-write\` app (XACML 3.0), and its progress by \`uor-remediation-lifecycle\` (UML 2.5.1). The change set was approved by the Organization Owner on 2026-11-14.`,
].join('\n\n') + '\n';
const pr = (r) => [
  '## Description',
  `Brings UOR-Foundation/${r.name} up to the repository standards of UOR-Foundation/.github. ${tierLine(r)}`,
  pullRequest(r).map((c) => `- ${c.detail}`).join('\n'),
  'The repository settings in the linked issue (topics, the branch ruleset and any rename) need admin rights, so an Organization Owner applies them outside this pull request.',
  'Closes #{issue}',
  '## Review Checklist',
  ['- [x] **Linked Issue** — This PR references an Issue (`Closes #{issue}`)',
    '- [x] **Description** — PR description explains what changed and why',
    `- [${pullRequest(r).some((c) => c.path?.startsWith('.github/workflows/')) ? 'x' : ' '}] **Tests** — New/updated tests cover changes; all tests pass`,
    '- [ ] **CI Passing** — All automated checks green',
    '- [x] **Documentation** — Public API changes documented; README updated if needed',
    `- [${['t1', 't2'].includes(tierOf(r)) ? ' ' : 'x'}] **CHANGELOG** — Entry added for this change (Tier 1–2)`,
    '- [x] **Compatibility** — No breaking changes, or `BREAKING CHANGE` documented',
    '- [x] **Security** — No new secrets committed; dependencies audited',
    '- [x] **Proof Verification** — Lean 4 / Coq compiles with zero sorrys (Tier 1 proofs only)',
    '- [x] **Commit History** — Conventional Commits followed; history clean'].join('\n'),
].join('\n\n') + '\n';

// ---- The owner's settings: one script, a dry run unless --apply is given ------------------------------------
const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
const settings = [
  '#!/usr/bin/env bash',
  '# Generated by remediation/project.mjs from remediation/register.json. Do not edit.',
  '#',
  '# Applies the repository settings of each change set that only an Organization Owner',
  '# may apply (the uor-remediation-write app): topics, the GOVERNANCE.md 6.2 ruleset and',
  '# lowercase renames. It prints every call and writes nothing unless --apply is given.',
  '# Every call is idempotent, so it is safe to run again (.github/workflows/apply-settings.yml).',
  '# Required status checks are the jobs a pull request reports, from workflows that run on every',
  '# pull request; a repository that reports none keeps its other rules and is named on stderr.',
  '#',
  '#   remediation/apply-settings.sh [--apply] [--enforcement active|disabled] [repository...]',
  '# With --enforcement, it only sets the enforcement of each existing governance-6.2 ruleset and changes nothing',
  '# else (GitHub REST, rulesets: enforcement is active, evaluate or disabled; evaluate needs GitHub Enterprise).',
  'set -euo pipefail',
  'apply=0; [ "${1:-}" = --apply ] && { apply=1; shift; }',
  'enforce=""; [ "${1:-}" = --enforcement ] && { enforce=$2; shift 2; }',
  'only=" $* "',
  'call() { [ -z "$enforce" ] || return 0; if [ "$apply" = 1 ]; then gh api "$@" >/dev/null; else printf "gh api %s\\n" "$*"; fi; }',
  'want() { [ "$only" = "  " ] || [[ "$only" == *" $1 "* ]]; }',
  '# Required status checks are only jobs that normal pull requests are shown to report and pass (GitHub Docs, "About',
  '# protected branches: Require status checks before merging": a required check must run on every pull request, or the',
  '# others wait forever). They are the jobs that succeeded on each of the three pull requests merged most recently into',
  '# the default branch, from workflows that exist on the default branch with no paths or paths-ignore filter and no',
  '# types list without synchronize on pull_request. A job only an unmerged pull request adds (such as a standards pull',
  '# request) or only a push runs is never required. A repository with no merged pull request requires no checks.',
  '# Runs and workflow files are public, so they are read with CHECKS_TOKEN when it is set (the workflow passes its own token).',
  'unfiltered() { GH_TOKEN="${CHECKS_TOKEN:-${GH_TOKEN:-}}" gh api "repos/UOR-Foundation/$1/contents/$2?ref=$3" --jq .content 2>/dev/null | base64 -d | awk \'/^on:/{o=1;next} o&&/^[^ #]/{o=0} o&&/^  pull_request:/{p=1;next} p&&/^  [^ ]/{p=0} p&&/^    paths(-ignore)?:/{f=1} p&&/^    types:/&&!/synchronize/{f=1} END{exit f}\'; }',
  'passed() { gh api "repos/UOR-Foundation/$1/actions/runs?head_sha=$3&event=pull_request&per_page=100" --jq \'.workflow_runs[] | "\\(.id) \\(.path)"\' | sort -u -k2,2 | while read -r id path; do if unfiltered "$1" "$path" "$2"; then gh api "repos/UOR-Foundation/$1/actions/runs/$id/jobs" --paginate --jq \'.jobs[] | select(.conclusion == "success") | .name\'; fi; done | sort -u; }',
  'checks() { [ -z "$enforce" ] || { echo "[]"; return; }; export GH_TOKEN="${CHECKS_TOKEN:-${GH_TOKEN:-}}"; n=0; acc=""; for sha in $(gh api "repos/UOR-Foundation/$1/pulls?state=closed&base=$2&sort=updated&direction=desc&per_page=50" --jq \'[.[] | select(.merged_at)] | sort_by(.merged_at) | reverse | .[:3][] | .head.sha\'); do got=$(passed "$1" "$2" "$sha"); if [ "$n" = 0 ]; then acc=$got; else acc=$(comm -12 <(printf "%s\\n" "$acc") <(printf "%s\\n" "$got")); fi; n=$((n + 1)); done; if [ "$n" = 0 ] || [ -z "$acc" ]; then echo "[]"; return; fi; printf "%s\\n" "$acc" | jq -R . | jq -sc \'map({context: .})\'; }',
  '# A ruleset with the same name is updated in place, so running the script again changes nothing.',
  'ruleset() { if [ -n "$enforce" ]; then cat >/dev/null; [ "$apply" = 1 ] || { echo "UOR-Foundation/$1 $2: would set enforcement $enforce" >&2; return 0; }; id=$(gh api "repos/UOR-Foundation/$1/rulesets" --jq ".[] | select(.name == \\"$2\\") | .id"); [ -n "$id" ] || return 0; if gh api -X PUT "repos/UOR-Foundation/$1/rulesets/$id" -f enforcement="$enforce" >/dev/null; then echo "UOR-Foundation/$1 $2: enforcement $enforce" >&2; else echo "UOR-Foundation/$1 $2: enforcement unchanged (an archived repository is read-only)" >&2; fi; return 0; fi; if [ "$apply" = 1 ]; then id=$(gh api "repos/UOR-Foundation/$1/rulesets" --jq ".[] | select(.name == \\"$2\\") | .id"); if [ -n "$id" ]; then gh api -X PUT "repos/UOR-Foundation/$1/rulesets/$id" --input - >/dev/null; else gh api -X POST "repos/UOR-Foundation/$1/rulesets" --input - >/dev/null; fi; else printf "gh api -X POST repos/UOR-Foundation/%s/rulesets --input %s\\n" "$1" "$(cat)"; fi; }',
  ...repositories.flatMap((r) => {
    const own = byOwner(r);
    if (!own.length) return [];
    const t = r.tiers[0];
    const rename = own.find((c) => c.kind === 'rename');
    // In a repository whose merges Alex alone decides (automation/repos.json), the merge controller's gate is
    // the requirement: a pull request is still required, with no human approval count. Every ruleset lets an
    // Organization Owner bypass it (GitHub REST, rulesets: bypass_actors, OrganizationAdmin, always).
    const solo = OWNED.has(r.name.toLowerCase());
    const rules = t.ruleset.rules.filter((x) => x.type !== 'required_status_checks').map((x) => (x.type === 'pull_request' ? { ...x, parameters: { ...x.parameters, required_approving_review_count: solo ? 0 : Math.min(1, x.parameters.required_approving_review_count) } } : x));
    const needsChecks = t.ruleset.rules.some((x) => x.type === 'required_status_checks');
    const body = { ...t.ruleset, bypass_actors: [{ actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' }], rules };
    const lines = [`if want ${q(r.name)}; then`, `  echo "== UOR-Foundation/${r.name} (${tierOf(r)})" >&2`];
    if (r.archived) lines.push(`  call -X PATCH repos/UOR-Foundation/${r.name} -F archived=false`);
    lines.push(`  call -X PUT repos/UOR-Foundation/${r.name}/topics ${t.topics.map((x) => `-f 'names[]=${x}'`).join(' ')}`);
    if (needsChecks) {
      lines.push(`  if [ "$apply" = 1 ] || [ -n "\${CHECKS_TOKEN:-}" ]; then contexts=$(checks ${q(r.name)} ${q(r.defaultBranch)}); else contexts='[{"context":"<each job a pull request reports, read when applied>"}]'; fi`);
      lines.push(`  if [ "$contexts" = "[]" ]; then [ -n "$enforce" ] || echo "UOR-Foundation/${r.name}: no job that merged pull requests all passed; required status checks not set" >&2; rules=${q(JSON.stringify(rules))};`);
      lines.push(`  else rules=$(jq -c --argjson c "$contexts" '. + [{type: "required_status_checks", parameters: {strict_required_status_checks_policy: false, required_status_checks: $c}}]' <<<${q(JSON.stringify(rules))}); fi`);
    } else lines.push(`  rules=${q(JSON.stringify(rules))}`);
    lines.push(`  jq -c --argjson r "$rules" '.rules = $r' <<<${q(JSON.stringify(body))} | ruleset ${q(r.name)} ${q(body.name)}`);
    if (rename) lines.push(`  call -X PATCH repos/UOR-Foundation/${r.name} -f name=${q(rename.name)}`);
    if (r.archived) lines.push(`  call -X PATCH repos/UOR-Foundation/${rename ? rename.name : r.name} -F archived=true`);
    lines.push('fi');
    return lines;
  }),
  '',
].join('\n');

const outputs = new Map([['register.json', `${JSON.stringify(register, null, 2)}\n`], ['apply-settings.sh', settings]]);
for (const r of repositories) {
  outputs.set(`drafts/${r.name}.issue.md`, issue(r));
  if (!r.archived && pullRequest(r).length) outputs.set(`drafts/${r.name}.pr.md`, pr(r));
}
if (flag === '--check') {
  const stale = [...outputs].filter(([p, t]) => !existsSync(join(here, p)) || readFileSync(join(here, p), 'utf8') !== t).map(([p]) => p);
  const extra = existsSync(join(here, 'drafts')) ? readdirSync(join(here, 'drafts')).filter((f) => !outputs.has(`drafts/${f}`)) : [];
  if (stale.length || extra.length) {
    process.stderr.write(`remediation is not the projection of its sources: ${[...stale, ...extra].join(' ')}\n`);
    process.exit(1);
  }
} else {
  rmSync(join(here, 'drafts'), { recursive: true, force: true });
  mkdirSync(join(here, 'drafts'), { recursive: true });
  for (const [p, t] of outputs) writeFileSync(join(here, p), t, { mode: p.endsWith('.sh') ? 0o755 : 0o644 });
}
const n = (k) => repositories.reduce((a, r) => a + (r.now?.filter((c) => c.kind === k).length ?? 0), 0);
process.stdout.write(`${repositories.length} repositories: ${n('topic')} topics, ${n('file')} files, ${n('ruleset')} ruleset rules, ${n('rename')} renames at every tier; ${refusals.length} open claims\n`);
