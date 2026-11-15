#!/usr/bin/env node
/**
 * Project the reorganization register from its pinned sources.
 *
 * The evidence is reorg/snapshot.json: every public Foundation repository read
 * at a recorded commit. The dispositions are the lifecycle the Foundation's own
 * norms define, read from UOR-Foundation/.github at the pinned commit: the TOC
 * Archived stage (toc/README.md), the repository lifecycle of GOVERNANCE.md 11
 * and the status tags of STANDARDS.md. Each repository's evidence is reduced to
 * the request of the uor-repo-disposition decision app, the app is checked by
 * the Prism-DevRel builder at the commit apps/set.json pins, and the app's own
 * first-hit rules decide it. A fold is decided only by a supersession statement
 * naming a host the app keeps; every other candidate (a name family, a sole
 * consumer, a purpose naming another repository, a quiet window, a relocation
 * statement) is put to the TOC as an open claim. A norm the reorganization needs
 * that the sources do not define is a typed norm gap, also an open claim.
 *
 * Nothing is executed. Every act a decision or candidate would need is staged as
 * an exact command with its preconditions and `executed: false`, and
 * reorg/plan.md is written from the register.
 *
 *   node reorg/project.mjs <checkouts-dir> [--check]
 *
 * <checkouts-dir> holds `.github` and `prism-devrel` checked out at the pinned commits.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const top = join(here, '..');
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <checkouts-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const ORG = 'UOR-Foundation';

function headOf(dir) {
  const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim();
  return head.startsWith('ref:') ? readFileSync(join(dir, '.git', head.slice(5)), 'utf8').trim() : head;
}
// ---- Norms, at the pinned commit.
const normsDir = join(root, sources.norms.name);
if (headOf(normsDir) !== sources.norms.commit) throw new Error(`${sources.norms.name} is not at the pinned ${sources.norms.commit}`);
const norm = (key) => {
  const path = sources.norms[key];
  const bytes = readFileSync(join(normsDir, path));
  return { key, path: `${ORG}/${sources.norms.name}@${sources.norms.commit}:${path}`, sha256: sha256(bytes), text: bytes.toString('utf8').replace(/\r\n/g, '\n') };
};
const toc = norm('toc');
const gov = norm('governance');
const standards = norm('standards');
const section = (text, heading) => {
  const at = text.search(new RegExp(`\\n#+ ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  if (at < 0) throw new Error(`no "${heading}" section`);
  const rest = text.slice(at + 1);
  const level = rest.match(/^#+/)[0].length;
  const end = rest.slice(1).search(new RegExp(`\\n#{1,${level}} `));
  return end < 0 ? rest : rest.slice(0, end + 1);
};
// The TOC stages and the Archived row of the stage table.
const tocStages = [...section(toc.text, 'Project Stages').matchAll(/^- \*\*([^*]+)\*\*/gm)].map((m) => m[1]);
const archivedRow = section(toc.text, 'Project Stages').split('\n').find((l) => /^\| \*\*Archived\*\* \|/.test(l));
if (!archivedRow) throw new Error('toc/README.md has no Archived row in its stage table');
const [, , archivedSignal, archivedEvidence, archivedDecision] = archivedRow.split('|').map((c) => c.trim());
if (!/supersession/i.test(archivedEvidence) || !/inactivity/i.test(archivedEvidence)) throw new Error(`the Archived stage no longer names inactivity and supersession: ${archivedEvidence}`);
const archivalNotice = section(toc.text, 'Timelines').split('\n').find((l) => /^\| Archival/.test(l));
if (!archivalNotice) throw new Error('toc/README.md Timelines has no archival row');
const noticeWindow = archivalNotice.split('|').map((c) => c.trim())[2];
// GOVERNANCE.md 11: the repository lifecycle and its archive rule.
const lifecycle = section(gov.text, '11. Repository Lifecycle Management');
const govStages = [...lifecycle.matchAll(/^\| (\w+) \| [^|]+ \|$/gm)].map((m) => m[1]).filter((s) => s !== 'Stage');
const archiveRule = lifecycle.split('\n').find((l) => /^Archive only when/.test(l));
if (!archiveRule) throw new Error('GOVERNANCE.md 11 has no archive rule');
const branchRule = section(gov.text, '7.2 Branch Naming');
if (!branchRule.includes('`chore/{issue#}-{description}`') || !branchRule.includes('`docs/{issue#}-{description}`')) throw new Error('GOVERNANCE.md 7.2 no longer names chore/ and docs/ branches');
// STANDARDS.md status tags.
const statusRow = section(standards.text, 'Topic Tags').split('\n').find((l) => /^\| Status \|/.test(l));
const statusTags = [...statusRow.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
if (!statusTags.includes('archived')) throw new Error('STANDARDS.md has no archived status tag');
const tierRow = section(standards.text, 'Topic Tags').split('\n').find((l) => /^\| Identity \|/.test(l));
const identityWords = [...tierRow.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// ---- Norm gaps: what the reorganization needs that the pinned norms do not define.
const normGaps = [];
const gap = (doc, refusal, detail) => normGaps.push({ norm: doc.path, sha256: doc.sha256, refusal, detail });
const allNorms = [toc, gov, standards].map((d) => d.text).join('\n');
if (!/\b(fold(ed|ing)?|merg(e|ed|ing) (a |one )?(repo|repositor|project)|consolidat)/i.test(allNorms)) {
  gap(toc, 'fold-undefined', 'No norm defines folding one repository into another. A fold is modeled as the act the norms do define: the TOC Archived stage on supersession (toc/README.md, TOC vote, simple majority), taken after the host imports the content, with context kept in the README (GOVERNANCE.md 11).');
}
if (!/inactiv[^\n]{0,80}\b\d+\s*(day|week|month|year)/i.test(allNorms)) {
  gap(toc, 'inactivity-unquantified', `toc/README.md names "${archivedEvidence}" and GOVERNANCE.md 11 says "${archiveRule}", but no norm says how long inactivity must last; a quiet window only raises a candidate.`);
}
if (!/\[Archived\]/.test(toc.text)) {
  gap(toc, 'archival-application-unspecified', 'toc/README.md specifies how to apply for Sandbox, Incubation and Graduation, but not how an archival is proposed, by whom, or the title it is filed under; the staged application uses "[Archived] <repository>" by analogy with "[Incubation]" and "[Graduation]".');
}
const lifecycleWords = new Set([...tocStages, ...govStages].map((s) => s.toLowerCase()));
const unstaged = statusTags.filter((t) => !lifecycleWords.has(t));
if (unstaged.length) {
  gap(standards, 'status-without-stage', `STANDARDS.md status tags [${statusTags.join(', ')}] include [${unstaged.join(', ')}], which neither the TOC stages [${tocStages.join(', ')}] nor the GOVERNANCE.md 11 lifecycle [${govStages.join(', ')}] defines, so a deprecation has no lifecycle decision.`);
}
if (!/transfer/i.test(allNorms)) {
  gap(gov, 'issue-transfer-undefined', 'No norm says what happens to the open issues and pull requests of a repository that is archived or folded; the staged acts transfer open issues to the host, which GitHub allows only within one organization.');
}

// ---- The decision app, checked by the pinned builder, and its first-hit rules.
const set = JSON.parse(readFileSync(join(top, sources.app.set), 'utf8'));
const builderDir = join(root, sources.builder.name);
if (headOf(builderDir) !== set.builder.commit) throw new Error(`${sources.builder.name} is not at the ${set.builder.commit} apps/set.json pins`);
const promptPath = join(top, sources.app.prompt);
const promptBytes = readFileSync(promptPath);
const prompt = JSON.parse(promptBytes.toString('utf8'));
const builderCheck = execFileSync('node', [join(builderDir, 'builder', 'cli.mjs'), 'check', promptPath], { encoding: 'utf8', cwd: builderDir });
const app = prompt.app;
if (prompt.pattern !== 'decisionTable') throw new Error(`${app.name} is a ${prompt.pattern}, not a decisionTable`);
const BINDING = ['archived', 'reserved', 'statement', 'family', 'consumer', 'overlap', 'activity'];
if (app.fields.map((f) => f.name).join() !== BINDING.join()) throw new Error(`${app.name} asks [${app.fields.map((f) => f.name)}]; the projector binds [${BINDING}]`);
const DISPOSITIONS = ['keep', 'archive', 'fold', 'review'];
if (app.outcomes.join() !== DISPOSITIONS.join()) throw new Error(`${app.name} answers [${app.outcomes}]; the register holds [${DISPOSITIONS}]`);
for (const rule of app.rules) if (!/@[0-9a-f]{40}|GitHub Docs/.test(rule.why)) throw new Error(`a rule of ${app.name} cites no pinned norm: ${rule.why}`);
const OPS = { is: (a, b) => a === b, 'is not': (a, b) => a !== b };
function decide(request) {
  for (const [i, rule] of app.rules.entries()) {
    if (rule.when.every((c) => {
      if (!OPS[c.op]) throw new Error(`${app.name} uses the operator ${c.op}`);
      return OPS[c.op](request[c.field], c.value);
    })) return { outcome: rule.then, rule: `REQ-${String(i + 1).padStart(3, '0')}`, why: rule.why };
  }
  return { outcome: app.otherwise, rule: 'otherwise', why: app.otherwiseWhy };
}
for (const ex of app.examples) {
  const words = ex.request.split(/\s+/);
  const got = decide(Object.fromEntries(app.fields.map((f, i) => [f.name, words[i]]))).outcome;
  if (got !== ex.response) throw new Error(`${app.name} example "${ex.request}" gives ${got}, not ${ex.response}`);
}

// ---- Evidence.
const snapshotBytes = readFileSync(join(here, 'snapshot.json'));
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
const setBytes = readFileSync(join(top, snapshot.set.path));
if (sha256(setBytes) !== snapshot.set.sha256) throw new Error(`${snapshot.set.path} is not the repository set reorg/snapshot.json was taken over`);
const ecoSet = JSON.parse(setBytes.toString('utf8')).repositories;
if (ecoSet.map((r) => r.name).join() !== snapshot.repositories.map((r) => r.name).join()) throw new Error('the snapshot does not hold the repository set in order');
const ecoLines = setBytes.toString('utf8').split('\n');
const repos = snapshot.repositories;
const index = new Map(repos.map((r, i) => [r.name, i]));
// Consumption is a dependency a build reads: a package, a reusable workflow or a submodule.
const CONSUMES = ['crate', 'npm', 'pypi', 'workflow', 'submodule'];
const dependencies = [];
for (const r of repos) {
  const seen = new Set();
  for (const k of CONSUMES) for (const ref of r.references.filter((x) => x.kind === k)) {
    if (seen.has(ref.to)) continue;
    seen.add(ref.to);
    dependencies.push({ from: index.get(r.name), to: index.get(ref.to), kind: k, file: ref.evidence.file, line: ref.evidence.line, text: ref.evidence.text });
  }
}
const dependents = repos.map((_, i) => dependencies.filter((d) => d.to === i).map((d) => d.from));
// A repository's dependency closure, over consumption and vendored copies.
const direct = repos.map((r) => new Set(r.references.filter((x) => [...CONSUMES, 'vendored'].includes(x.kind)).map((x) => index.get(x.to))));
const closure = repos.map((_, i) => {
  const seen = new Set();
  const walk = (j) => { for (const k of direct[j]) if (!seen.has(k)) { seen.add(k); walk(k); } };
  walk(i);
  return seen;
});
// Name families: names that share a word other than the identity word. A word is a hyphen-separated part or a
// capitalised part of one (PrismPM is Prism and PM), of at least three characters.
const words = (name) => {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const out = new Set(parts.map((p) => p.toLowerCase()));
  for (const p of parts) for (const m of p.matchAll(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g)) out.add(m[0].toLowerCase());
  return [...out].filter((w) => w.length >= 3 && !identityWords.includes(w));
};
const parent = repos.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const byWord = new Map();
repos.forEach((r, i) => { for (const w of words(r.name)) { if (byWord.has(w)) parent[find(i)] = find(byWord.get(w)); else byWord.set(w, i); } });
const families = new Map();
repos.forEach((_, i) => { const f = find(i); if (!families.has(f)) families.set(f, []); families.get(f).push(i); });
const familyOf = repos.map((_, i) => families.get(find(i)));
const hubOf = (members) => {
  const counts = members.map((m) => dependents[m].length);
  const most = Math.max(...counts);
  return most > 0 && counts.filter((c) => c === most).length === 1 ? members[counts.indexOf(most)] : -1;
};
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A repository is named as GitHub spells it, so a capitalised product word (Prism) is not the repository prism.
// A name that is an ordinary lower-case word (research, template) names the repository only as a code span or a
// link to it; a name with a capital, digit, dot or hyphen (LexLean, uor-foundry) names it wherever it is written.
const names = (source, self) => repos.map((r) => r.name).filter((n) => {
  if (n === self) return false;
  if (/[A-Z0-9.-]/.test(n)) return new RegExp(`(^|[^A-Za-z0-9_.-])${escape(n)}($|[^A-Za-z0-9_-])`).test(source);
  return new RegExp(`\`${escape(n)}\`|github\\.com/${ORG}/${escape(n)}([/)#?\\s]|$)`, 'i').test(source);
});

const citations = [];
const cite = (repository, signal, source, line, text) => citations.push({ repository, signal, source, line, text });
const candidates = [];
const acts = [];
const at = (r) => `${ORG}/${r.name}@${r.commit}`;

const decided = repos.map((r, i) => {
  const ecoLine = ecoLines.findIndex((l) => l === `      "name": "${r.name}",`) + 1;
  if (r.archived) cite(i, 'archivedFlag', snapshot.set.path, ecoLine, `GitHub holds ${r.name} archived`);
  const reserved = sources.platform.reserved.includes(r.name);
  if (reserved) cite(i, 'reservedName', sources.platform.documents[0].url, 0, sources.platform.documents[0].quote);
  // The strongest statement the README makes about the repository itself.
  const st = (kind) => r.statements.filter((s) => s.kind === kind);
  let statement = 'none';
  let statementHost = -1;
  const sup = st('supersession');
  const dep = st('deprecation');
  const rel = st('relocation');
  if (sup.length) {
    const hosts = [...new Set(sup.flatMap((s) => s.names))];
    if (hosts.length === 1) { statement = 'superseded'; statementHost = index.get(hosts[0]); } else statement = hosts.length ? 'relocated' : 'deprecated';
    for (const s of sup) cite(i, 'supersession', `${at(r)}:${s.file}`, s.line, s.text);
  } else if (dep.length) {
    statement = 'deprecated';
    for (const s of dep) cite(i, 'deprecation', `${at(r)}:${s.file}`, s.line, s.text);
  } else if (rel.length) {
    statement = 'relocated';
    const hosts = [...new Set(rel.flatMap((s) => s.names))];
    if (hosts.length === 1) statementHost = index.get(hosts[0]);
    for (const s of rel) cite(i, 'relocation', `${at(r)}:${s.file}`, s.line, s.text);
  }
  const members = familyOf[i];
  const hub = members.length > 1 ? hubOf(members) : -1;
  const family = members.length === 1 ? 'none' : hub === i ? 'hub' : 'member';
  if (family !== 'none') {
    const peers = members.filter((m) => m !== i).map((m) => repos[m].name);
    cite(i, family === 'hub' ? 'familyHub' : 'familyMember', 'reorg/snapshot.json', 0,
      `name family {${members.map((m) => repos[m].name).join(', ')}}; ${family === 'hub' ? `${r.name} has the most Foundation dependents (${dependents[i].length})` : hub >= 0 ? `${repos[hub].name} has the most Foundation dependents` : 'no member has the most Foundation dependents'}; shares a name word with ${peers.join(', ')}`);
  }
  const consumers = dependents[i];
  const consumer = consumers.length === 0 ? 'none' : consumers.length === 1 ? 'sole' : 'shared';
  for (const d of dependencies.filter((x) => x.to === i)) {
    cite(i, consumer === 'sole' ? 'soleConsumer' : 'sharedConsumer', `${at(repos[d.from])}:${d.file}`, d.line, `${repos[d.from].name} depends on ${r.name} (${d.kind}): ${d.text}`);
  }
  const named = names(r.purpose.source, r.name).filter((n) => !closure[i].has(index.get(n)));
  const overlap = named.length ? 'names' : 'none';
  if (overlap === 'names') cite(i, 'purposeNames', `${at(r)}:${r.purpose.file}`, r.purpose.line, `the purpose names ${named.join(', ')}, outside its dependency closure: ${r.purpose.text}`);
  const activity = r.recentCommits > 0 ? 'recent' : 'quiet';
  cite(i, activity === 'recent' ? 'recentActivity' : 'quietActivity', at(r), 0,
    `${r.recentCommits} commits on ${r.defaultBranch} from ${snapshot.window.since} to ${snapshot.asOf}; last commit ${r.lastCommit}`);
  if (r.purpose.text) cite(i, 'purpose', `${at(r)}:${r.purpose.file}`, r.purpose.line, r.purpose.text);
  const request = { archived: r.archived ? 'yes' : 'no', reserved: reserved ? 'yes' : 'no', statement, family, consumer, overlap, activity };
  const decision = decide(request);
  // The host a fold or a candidate points to, by the rule that decided it.
  const host = {
    fold: statementHost,
    review: { 'REQ-005': statementHost, 'REQ-006': hub, 'REQ-007': consumers[0] ?? -1, 'REQ-008': named.length === 1 ? index.get(named[0]) : -1 }[decision.rule] ?? -1,
  }[decision.outcome] ?? -1;
  return { r, i, request, decision, host, named, members, hub, consumers };
});

// A fold's host must itself be kept; otherwise the fold is refused and put to the TOC.
const kept = (j) => j >= 0 && decided[j].decision.outcome === 'keep';
const register = decided.map((d) => {
  const { r, i, decision } = d;
  let disposition = decision.outcome;
  let host = i;
  let refusal = '';
  if (disposition === 'fold') {
    if (kept(d.host) && d.host !== i) host = d.host;
    else { disposition = 'review'; refusal = 'host-not-kept'; }
  }
  return { ...d, candidate: d.host, disposition, host, refusal };
});

// ---- Candidates, and the acts each decision or candidate would need, staged and unexecuted.
const issueRef = `${ORG}/.github#$ISSUE`;
const vote = `The ${archivedDecision} on the Archived stage (toc/README.md) has passed, held after the ${noticeWindow.toLowerCase()} its Timelines table sets`;
function stage(d, kind, host, conditional) {
  const r = d.r;
  const steps = [];
  const h = host >= 0 && host !== d.i ? repos[host] : null;
  const prefix = h ? (h.layout.includes(`${r.name.toLowerCase()}/`) ? `folded-${r.name.toLowerCase()}` : r.name.toLowerCase()) : '';
  const pending = conditional ? `The TOC decides this candidate as ${kind === 'fold' ? `a fold into ${h.name}` : 'an archival'}. ` : '';
  const branch = `chore/$ISSUE-fold-${r.name.toLowerCase()}`;
  const docs = `docs/$ISSUE-${kind === 'fold' ? 'folded' : 'archived'}`;
  const body = kind === 'fold'
    ? `${r.name} (${at(r)}) folds into ${h.name}. Evidence and rule: reorg/register.json in ${ORG}/community.`
    : `${r.name} (${at(r)}) is archived. Evidence and rule: reorg/register.json in ${ORG}/community.`;
  const add = (action, command, precondition) => steps.push({ action, command, precondition: `${pending}${precondition}` });
  add('tocApplication', `ISSUE=$(gh issue create --repo ${ORG}/.github --title "[Archived] ${r.name}" --body "${body}" | sed 's#.*/##')`,
    'The Organization Owner approves filing it. ISSUE is the issue number this prints, used by every later step.');
  add('maintainerNotice', `gh issue create --repo ${ORG}/${r.name} --title "Archival notice: ${kind === 'fold' ? `fold into ${h.name}` : 'archive'}" --body "Proposed in ${issueRef}. ${archivalNotice.split('|')[1].trim()}: ${noticeWindow}."`,
    `Step 1 is filed. The ${noticeWindow.toLowerCase()} toc/README.md Timelines sets starts here.`);
  if (kind === 'fold') {
    add('subtreeAdd', `git clone https://github.com/${ORG}/${h.name}.git && git -C ${h.name} switch -c ${branch} && git -C ${h.name} subtree add --prefix=${prefix} https://github.com/${ORG}/${r.name}.git ${r.commit}`,
      `${vote}. ${r.name}'s default branch is still at ${r.commit}; otherwise re-snapshot and re-project first. The branch is named as GOVERNANCE.md 7.2 requires.`);
    add('hostPullRequest', `git -C ${h.name} push origin ${branch} && gh pr create --repo ${ORG}/${h.name} --head ${branch} --title "chore(${prefix}): fold ${r.name} into ${h.name}" --body "Imports ${at(r)} under ${prefix}/ with its history. Decided in ${issueRef}."`,
      `Step 3 is done. The host's required CI is green on the branch and the review its tier requires (GOVERNANCE.md 6.2, 9) approves it.`);
  }
  const note = kind === 'fold'
    ? `> This repository was folded into [${ORG}/${h.name}](https://github.com/${ORG}/${h.name}/tree/${h.defaultBranch}/${prefix}) by TOC decision ${issueRef}.`
    : `> This repository is archived by TOC decision ${issueRef}. It is kept read-only for its history.`;
  add('readmeRedirect', `git clone https://github.com/${ORG}/${r.name}.git && git -C ${r.name} switch -c ${docs} && printf '%s\\n\\n' '${note}' | cat - ${r.name}/${r.purpose.file || 'README.md'} > ${r.name}/README.tmp && mv ${r.name}/README.tmp ${r.name}/${r.purpose.file || 'README.md'} && git -C ${r.name} commit -am "docs: ${kind === 'fold' ? `point to ${h.name}` : 'mark archived'}" && git -C ${r.name} push origin ${docs} && gh pr create --repo ${ORG}/${r.name} --head ${docs} --title "docs: ${kind === 'fold' ? `${r.name} is folded into ${h.name}` : `${r.name} is archived`}" --body "Keeps context in the README, as GOVERNANCE.md 11 requires. ${issueRef}."`,
    kind === 'fold' ? 'The host pull request of step 4 is merged.' : `${vote}.`);
  if (kind === 'fold') {
    add('transferIssues', `gh issue list --repo ${ORG}/${r.name} --state open --limit 1000 --json number --jq '.[].number' | xargs -I{} gh issue transfer {} ${ORG}/${h.name} --repo ${ORG}/${r.name}`,
      'The redirect of step 5 is merged. GitHub transfers an issue only between repositories of one owner.');
  }
  add('statusTopic', `gh repo edit ${ORG}/${r.name} ${statusTags.filter((t) => t !== 'archived').map((t) => `--remove-topic ${t}`).join(' ')} --add-topic archived`,
    'The README pull request is merged. STANDARDS.md Topic Tags: exactly one status tag.');
  add('archiveRepository', `gh api -X PATCH repos/${ORG}/${r.name} -f archived=true`,
    `Every earlier step is done${kind === 'fold' ? ' and the open issues are transferred' : ''}. GOVERNANCE.md 11: Archived is read-only.`);
  steps.forEach((s, k) => acts.push({ repository: d.i, host: h ? host : d.i, step: k + 1, ...s, conditional, executed: false }));
}
for (const d of register) {
  if (d.disposition === 'fold') stage(d, 'fold', d.host, false);
  else if (d.disposition === 'archive' && !d.r.archived) stage(d, 'archive', -1, false);
  else if (d.disposition === 'review') {
    const host = kept(d.candidate) && d.candidate !== d.i ? d.candidate : -1;
    const why = {
      'REQ-005': 'its README says part of its content belongs in another Foundation repository',
      'REQ-006': 'its name shares a word with other Foundation repositories',
      'REQ-007': 'exactly one other Foundation repository depends on it',
      'REQ-008': 'its purpose statement names a Foundation repository it does not depend on',
      'REQ-009': `it has no commit in the ${snapshot.window.days}-day window and no norm quantifies sustained inactivity`,
    }[d.decision.rule] ?? (d.refusal === 'host-not-kept' ? 'its supersession statement names a host the register does not keep' : 'the evidence does not decide it');
    const signals = citations.filter((c) => c.repository === d.i && !['purpose', 'recentActivity', 'sharedConsumer'].includes(c.signal)).map((c) => c.signal);
    candidates.push({
      repository: d.i,
      host: host >= 0 ? host : d.i,
      refusal: d.refusal || `undecided-${d.decision.rule.toLowerCase()}`,
      signals: [...new Set(signals)].join(' '),
      detail: `${d.r.name}: ${why}; ${host >= 0 ? `the candidate host is ${repos[host].name}, which is kept` : d.candidate >= 0 && d.candidate !== d.i ? `the candidate host ${repos[d.candidate].name} is not itself kept, so no fold is staged` : d.decision.rule === 'REQ-009' ? 'no host is named, so only an archival is staged' : 'no single kept host is named, so no fold is staged'}. The TOC decides it (toc/README.md Archived: ${archivedDecision}).`,
    });
    if (host >= 0) stage(d, 'fold', host, true);
    else if (d.decision.rule === 'REQ-009') stage(d, 'archive', -1, true);
    else {
      acts.push({
        repository: d.i, host: d.i, step: 1, action: 'tocApplication',
        command: `ISSUE=$(gh issue create --repo ${ORG}/.github --title "[Review] ${d.r.name}" --body "${d.r.name} (${at(d.r)}) is a reorganization candidate with no single kept host: ${why}. Evidence: reorg/register.json in ${ORG}/community." | sed 's#.*/##')`,
        precondition: 'The Organization Owner approves filing it. The TOC decides whether a host or an archival follows; the register is then re-projected with that decision.',
        conditional: true, executed: false,
      });
    }
  }
}

const out = {
  spec: 'uor-community/reorg-register/1',
  snapshot: { asOf: snapshot.asOf, window: snapshot.window, sha256: sha256(snapshotBytes), set: snapshot.set },
  norms: [toc, gov, standards].map(({ path, sha256: digest }) => ({ path, sha256: digest })),
  platform: sources.platform.documents.map(({ url, fetched, sha256: digest }) => ({ url, fetched, sha256: digest })),
  lifecycle: { tocStages, governanceStages: govStages, statusTags, archived: { signal: archivedSignal, evidence: archivedEvidence, decision: archivedDecision, notice: noticeWindow }, archiveRule },
  app: {
    name: app.name, path: sources.app.prompt, sha256: sha256(promptBytes), outcomes: app.outcomes,
    builder: { repository: set.builder.repository, commit: set.builder.commit, check: sha256(builderCheck), properties: builderCheck.split('\n').filter((l) => /^UR-\d+/.test(l)).length },
  },
  repositories: register.map((d) => ({
    index: d.i, name: d.r.name, commit: d.r.commit, archived: d.r.archived, lastCommit: d.r.lastCommit, recentCommits: d.r.recentCommits,
    purpose: d.r.purpose.text, request: d.request, dependents: d.consumers.length, family: d.members.map((m) => repos[m].name),
    disposition: d.disposition, rule: d.decision.rule, why: d.decision.why, host: d.host, refusal: d.refusal,
  })),
  dependencies,
  citations,
  candidates,
  normGaps,
  acts,
};
const text = `${JSON.stringify(out, null, 2)}\n`;

// ---- reorg/plan.md, written from the register.
const count = (x) => out.repositories.filter((r) => r.disposition === x).length;
const md = [];
md.push('# Reorganization plan V1', '');
md.push(`Generated by \`node reorg/project.mjs\` from \`reorg/register.json\`; do not edit. Evidence: ${repos.length} public repositories read at their default-branch commits on ${snapshot.asOf} (\`reorg/snapshot.json\`, sha256 \`${out.snapshot.sha256}\`). Norms: ${out.norms.map((n) => `\`${n.path}\``).join(', ')}. Decision app: \`${out.app.path}\` (sha256 \`${out.app.sha256}\`), checked by ${out.app.builder.repository}@${out.app.builder.commit}.`, '');
md.push('**Nothing here is executed.** Every act below is staged with `executed: false` for the Organization Owner to approve one by one; a conditional act also waits for the TOC decision it names.', '');
md.push('## Dispositions', '');
md.push(`| Disposition | Repositories |`, '|---|---|');
for (const x of DISPOSITIONS) md.push(`| ${x} | ${count(x)} |`);
md.push('', '| Repository | Commit | Disposition | Rule | Request | Host |', '|---|---|---|---|---|---|');
for (const r of out.repositories) {
  md.push(`| ${r.name} | \`${r.commit.slice(0, 12)}\` | ${r.disposition}${r.refusal ? ` (${r.refusal})` : ''} | ${r.rule} | ${BINDING.map((k) => r.request[k]).join(' ')} | ${r.host !== r.index ? repos[r.host].name : ''} |`);
}
md.push('', `Request fields, in order: ${BINDING.join(', ')}.`, '');
md.push('## Candidates for the TOC (open claims)', '');
for (const c of candidates) md.push(`- **${repos[c.repository].name}** \`${c.refusal}\` (signals: ${c.signals}). ${c.detail}`);
md.push('', '## Norm gaps (open claims)', '');
for (const g of normGaps) md.push(`- \`${g.refusal}\` (${g.norm}): ${g.detail}`);
md.push('', '## Staged acts', '');
let last = -1;
for (const a of acts) {
  if (a.repository !== last) {
    last = a.repository;
    md.push('', `### ${repos[a.repository].name}${a.host !== a.repository ? ` into ${repos[a.host].name}` : ''}${a.conditional ? ' (conditional on a TOC decision)' : ''}`, '');
  }
  md.push(`${a.step}. **${a.action}** (executed: ${a.executed}). Precondition: ${a.precondition}`, '', '   ```sh', `   ${a.command}`, '   ```', '');
}
md.push('## Evidence graph', '');
md.push(`${repos.reduce((n, r) => n + r.references.length, 0)} references between Foundation repositories in \`reorg/snapshot.json\`, each \`{from, to, kind, evidence}\` with the file and line it was read from; ${dependencies.length} of them are consumption (a package, reusable workflow or submodule) and decide the consumer field.`, '');
const plan = `${md.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;

let stale = false;
for (const [file, body] of [['register.json', text], ['plan.md', plan]]) {
  const target = join(here, file);
  if (flag === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== body) { process.stderr.write(`reorg/${file} is not the projection of its pinned sources\n`); stale = true; }
  } else writeFileSync(target, body);
}
if (stale) process.exit(1);
process.stdout.write(`${repos.length} repositories: ${DISPOSITIONS.map((x) => `${count(x)} ${x}`).join(', ')}; ${candidates.length} candidates, ${normGaps.length} norm gaps, ${acts.length} staged acts (0 executed)\n`);
