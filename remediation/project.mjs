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
const apps = sources.apps.map((s) => {
  const file = pinned(s)(s.prompt);
  const prompt = JSON.parse(file.text);
  if (prompt.pattern !== 'decisionTable') throw new Error(`${s.prompt} is a ${prompt.pattern}, not a decisionTable`);
  const app = prompt.app;
  for (const ex of app.examples) {
    const words = ex.request.split(/\s+/);
    const request = Object.fromEntries(app.fields.map((f, i) => [f.name, f.kind === 'number' ? Number(words[i]) : words[i]]));
    const got = decide(app, request).outcome;
    if (got !== ex.response) throw new Error(`${app.name} example "${ex.request}" gives ${got}, not ${ex.response}`);
  }
  return { app, file };
});
const appNamed = (n) => {
  const a = apps.find((x) => x.app.name === n);
  if (!a) throw new Error(`sources.json pins no ${n} prompt`);
  return a.app;
};

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
        domain: null,
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
function changes(appName, field, from, to, ctx) {
  const { s, o, tier } = ctx;
  const one = (kind, detail, extra = {}) => [{ app: appName, field, from: from ?? 'unobserved', to: typeof to === 'object' ? JSON.stringify(to) : to, kind, detail, ...extra }];
  switch (`${appName}.${field}`) {
    case 'uor-repo-files.readme': return one('decision', 'Add README.md describing the repository (GOVERNANCE.md 6.1)', { decision: 'readme' });
    case 'uor-repo-files.license': return o.evidence.some((p) => /^LICENSE[.-]/i.test(p))
      ? one('decision', `Add LICENSE; the repository carries ${o.evidence.filter((p) => /^LICENSE[.-]/i.test(p)).join(' and ')}, which GOVERNANCE.md 6.1 does not name`, { decision: 'license-file' })
      : one('file', `Add LICENSE with the SPDX MIT text (GOVERNANCE.md 13), copyright year ${o.firstCommit.slice(0, 4)}`, { path: 'LICENSE', decision: 'copyright-holder' });
    case 'uor-repo-files.codeowners': return one('decision', 'Add .github/CODEOWNERS naming the repository\'s maintainers (GOVERNANCE.md 6.1)', { path: '.github/CODEOWNERS', decision: 'codeowners' });
    case 'uor-repo-files.ci': return one('decision', 'Add a CI workflow under .github/workflows (GOVERNANCE.md 6.1)', { path: '.github/workflows/', decision: 'ci' });
    case 'uor-repo-files.contributing': case 'uor-repo-files.conduct': case 'uor-repo-files.security':
      return one('file', `Add ${field} file`, {});
    case 'uor-repo-protection.pr': return one('ruleset', 'Require a pull request before merging to the default branch', { rule: 'pull_request' });
    case 'uor-repo-protection.reviews': return one('ruleset', `Require at least ${to.atLeast ?? to} approving review${(to.atLeast ?? to) === 1 ? '' : 's'}`, { rule: 'pull_request' });
    case 'uor-repo-protection.checks': return one('ruleset', 'Require status checks to pass before merging', { rule: 'required_status_checks', decision: 'check-contexts' });
    case 'uor-repo-protection.forcepush': return one('ruleset', 'Block force pushes to the default branch', { rule: 'non_fast_forward' });
    case 'uor-repo-standards.identity': return vocabulary.identity.filter((t) => !s.topics.includes(t)).map((t) => ({ ...one('topic', `Add topic ${t}`)[0], topic: t }));
    case 'uor-repo-standards.tiertags': return to === 1 && from === 0 ? [{ ...one('topic', `Add topic ${tierTag[tier]}`)[0], topic: tierTag[tier] }] : one('decision', `Carry exactly one tier tag (now ${from})`, { decision: 'tier' });
    case 'uor-repo-standards.statustags': return to === 1 && from === 0 && s.archived
      ? [{ ...one('topic', 'Add topic archived: the repository is archived on GitHub, read-only as GOVERNANCE.md 11 defines Archived')[0], topic: 'archived' }]
      : one('decision', `Carry exactly one status tag (now ${from})`, { decision: 'status' });
    case 'uor-repo-standards.versioning': return one('decision', `Release under Semantic Versioning 2.0.0; these tags are not SemVer: ${s.tags.filter((t) => !SEMVER.test(t.name.replace(/^v/, ''))).map((t) => t.name).join(', ')}`, { decision: 'versioning' });
    case 'uor-repo-naming.case': return [{ ...one('rename', `Rename the repository to ${s.name.toLowerCase()}`)[0], name: s.name.toLowerCase() }];
    case 'uor-repo-naming.branches': return one('decision', `Rename or delete the branches not named {type}/{issue#}-{short-description}: ${o.branches.filter((b) => !b.conforming).length} of ${o.branches.length}`, { decision: 'branches' });
    case 'uor-repo-naming.domain': return one('decision', `Add every Domain topic that applies, from: ${vocabulary.domain.join(', ')}`, { decision: 'domain' });
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
  const candidates = e.tier ? [e.tier] : tiers;
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
        list.push(...changes(app.name, f.name, was, to, { s, o, tier }));
      }
      sets.push({ app: app.name, observed: observedOutcome, after: blockedBy.length ? 'blocked' : app.otherwise, changes: list });
    }
    return { tier, apps: sets, findings };
  });
  const key = (c) => `${c.app}|${c.field}|${c.kind}|${c.detail}`;
  const everywhere = byTier[0].apps.flatMap((a) => a.changes).filter((c) => byTier.every((t) => t.apps.some((a) => a.changes.some((d) => key(d) === key(c)))));
  const now = everywhere.filter((c) => !c.decision || c.kind !== 'decision');
  const decisions = [...new Set([
    ...(e.tier ? [] : ['tier']),
    ...byTier.flatMap((t) => t.apps.flatMap((a) => a.changes.map((c) => c.decision).filter(Boolean))),
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
  sources: [standards, governance, ...inherited, languagesFile, licenseFile, ...apps.map((a) => a.file)].map(({ path, sha256: d }) => ({ path, sha256: d })),
  apps: apps.map(({ app }) => ({ app: app.name, conformant: app.otherwise, fields: app.fields.map((f) => f.name) })),
  repositories,
  refusals,
};

// ---- Drafts: one issue per repository, in the shape of UOR-Foundation/.github's feature request template ------
const QUESTIONS = {
  tier: 'Which tier is it? GOVERNANCE.md 5: Tier 1 core framework and critical specs; Tier 2 implementations and integrations; Tier 3 docs, websites and presentation; Tier 4 early experiments.',
  status: 'Which status is it: active, maintenance or deprecated? (GOVERNANCE.md 11, STANDARDS.md Status)',
  domain: `Which Domain topics apply? (${vocabulary.domain.join(', ')}; all that apply)`,
  'copyright-holder': 'Who holds the copyright the LICENSE names?',
  'license-file': 'GOVERNANCE.md 6.1 names LICENSE. Add a LICENSE file, or amend 6.1 to accept the LICENSE-MIT and LICENSE-APACHE pair the template ships?',
  codeowners: 'Who are its maintainers, for .github/CODEOWNERS?',
  ci: 'Which CI workflow should it run?',
  'check-contexts': 'Which status checks must pass? The draft ruleset lists the jobs its pull-request workflows run.',
  versioning: 'How should its non-SemVer tags be superseded?',
  branches: 'Which of its non-conforming branches are renamed and which deleted?',
  readme: 'What should its README say?',
};
const md = (r) => {
  if (r.empty) return `# ${r.name}\n\nThe repository has no default branch, so nothing was observed.\n`;
  const line = (c) => `- ${c.detail}${c.decision && c.kind !== 'decision' ? ` (needs: ${c.decision})` : ''}`;
  const blocks = [
    '---\nname: Feature Request\nabout: Propose a new feature or enhancement\nlabels: enhancement\n---',
    '## Problem',
    `UOR-Foundation/${r.name} does not yet meet the repository standards of UOR-Foundation/.github (STANDARDS.md, GOVERNANCE.md 6.1, 6.2, 8 and 11) at commit \`${r.commit.slice(0, 12)}\` of \`${r.defaultBranch}\`.${r.archived ? ' It is archived, so each change below is applied by unarchiving it, applying the change, and archiving it again.' : ''}`,
    `Its outcome from each decision app${r.tier ? ` at ${r.tier}` : ', at every tier, because it carries no tier tag'} (unobserved: the outcome depends on state that could not be read):`,
    [`| Tier | ${register.apps.map((a) => a.app).join(' | ')} |`, `|---|${register.apps.map(() => '---').join('|')}|`,
      ...r.tiers.map((t) => `| ${t.tier} | ${t.apps.map((a) => a.observed).join(' | ')} |`)].join('\n'),
    '## Proposed Solution',
    '### Every tier',
    (r.now.length ? r.now.map(line) : ['- Nothing applies at every tier.']).join('\n'),
    ...(r.decisions.length ? ['### Decisions', r.decisions.map((d) => `- **${d}**: ${QUESTIONS[d]}`).join('\n')] : []),
    '### By tier',
    ...r.tiers.map((t) => {
      const own = t.apps.flatMap((a) => a.changes.filter((c) => !r.now.some((n) => n.detail === c.detail && n.app === c.app)).map(line));
      return [
        `<details><summary>${t.tier} (${tierTag[t.tier]})</summary>`,
        '',
        ...(own.length ? own : ['- Nothing beyond every tier.']),
        '',
        'Topics (`PUT /repos/UOR-Foundation/' + r.name + '/topics`):',
        '',
        '```json',
        JSON.stringify({ names: t.topics }),
        '```',
        '',
        'Ruleset (`POST /repos/UOR-Foundation/' + r.name + '/rulesets`):',
        '',
        '```json',
        JSON.stringify(t.ruleset, null, 2),
        '```',
        '',
        '</details>',
      ].join('\n');
    }),
    '## Alternatives Considered',
    r.findings.length ? r.findings.map((f) => `- ${f.reason}`).join('\n') : 'None: every app can find the repository conformant after these changes.',
    '## Additional Context',
    'Generated by UOR-Foundation/community `remediation/project.mjs` from `remediation/register.json`. Each change is the nearest request the decision app finds conformant, and is decided again by the app before it is written. Branch protection was not readable without admin rights, so the ruleset is the state the tier requires, not a difference from the current one.',
  ];
  return `${blocks.join('\n\n')}\n`;
};

const outputs = new Map([['register.json', `${JSON.stringify(register, null, 2)}\n`]]);
for (const r of repositories) outputs.set(`drafts/${r.name}.md`, md(r));
outputs.set('drafts/LICENSE-MIT.txt', mitText);
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
  for (const [p, t] of outputs) writeFileSync(join(here, p), t);
}
const n = (k) => repositories.reduce((a, r) => a + (r.now?.filter((c) => c.kind === k).length ?? 0), 0);
process.stdout.write(`${repositories.length} repositories: ${n('topic')} topics, ${n('file')} files, ${n('ruleset')} ruleset rules, ${n('rename')} renames at every tier; ${refusals.length} open claims\n`);
