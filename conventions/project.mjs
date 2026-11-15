#!/usr/bin/env node
/**
 * Project the release and change conventions register, Foundation.Conventions.V1,
 * from conventions/scan.json and the pinned specifications and Foundation norms,
 * and write the remediation draft of every repository (data only: nothing is
 * applied anywhere).
 *
 * Each repository has one outcome per convention:
 *
 *   semver                Semantic Versioning 2.0.0 on every git tag and manifest version;
 *   conventional-commits  Conventional Commits 1.0.0 on the last 200 commits of the default branch;
 *   keep-a-changelog      Keep a Changelog 1.1.0 on CHANGELOG.md;
 *   changelog-file        GOVERNANCE.md 8, "Keep CHANGELOG.md updated": the file exists;
 *   release-notes         GOVERNANCE.md 8, "Publish release notes for every tagged release".
 *
 * A convention is mandatory for a repository exactly when a Foundation norm requires it there, conditional when
 * the norm's condition (a tier) is not recorded for the repository, and recommended otherwise. Every mandatory or
 * conditional convention that is unmet or unobserved is an open claim. The projector's own implementation of each
 * specification is held first to the specification's own examples and then to the oracle's verdict on every
 * observation: a SemVer or Conventional Commits disagreement stops the projection; a Keep a Changelog one (its
 * parser is not the specification) is carried as a claim.
 *
 *   node conventions/project.mjs <sources-dir> [--check]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNorms } from './norms.mjs';
import { compareSemver, classifyTag, ccMessage, kacParse } from './grammar.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const [sourcesDir, flag] = process.argv.slice(2);
if (!sourcesDir) {
  process.stderr.write('usage: project.mjs <sources-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const local = (p) => { const bytes = readFileSync(join(root, p)); return { path: p, sha256: sha256(bytes), json: JSON.parse(bytes.toString('utf8')) }; };
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const scan = local('conventions/scan.json');
const tiers = local('ecosystem/register.json');
const n = readNorms(sourcesDir, sources);
const re = n.semver.regex;
for (const input of scan.json.inputs) {
  const now = local(input.path).sha256;
  if (now !== input.sha256) throw new Error(`conventions/scan.json observed ${input.path} at sha256:${input.sha256}; it is now sha256:${now}`);
}
if (scan.json.depth !== sources.depth) throw new Error(`conventions/scan.json read ${scan.json.depth} commits, not ${sources.depth}`);

// ---- The implementations, held to the specifications' own examples.
for (const v of n.semver.validExamples) if (!re.test(v)) throw new Error(`the SemVer expression refuses the specification's example ${v}`);
for (const chain of n.semver.chains) {
  for (let i = 1; i < chain.length; i++) if (compareSemver(re, chain[i - 1], chain[i]) >= 0) throw new Error(`the comparator does not put ${chain[i - 1]} before ${chain[i]}, as SemVer item 11 does`);
}
for (const ex of n.cc.examples) if (ccMessage(ex).violations.length) throw new Error(`the Conventional Commits example "${ex.split('\n')[0]}" fails ${ccMessage(ex).violations}`);
const exampleFails = kacParse(re, n.kac.types, n.kac.example).checks.filter((c) => !c.holds);
if (exampleFails.length) throw new Error(`the Keep a Changelog example fails ${exampleFails.map((c) => c.check)}`);
if (ccMessage(n.profile.example).violations.length) throw new Error('CONTRIBUTING.md\'s own example is not a Conventional Commit');

// ---- Conventions, norms and clauses.
const CONVENTIONS = [
  { key: 'semver', standard: sources.standards.semver.standard, measure: 'versions', observable: true, source: sources.standards.semver },
  { key: 'conventional-commits', standard: sources.standards.conventionalCommits.standard, measure: 'commits', observable: true, source: sources.standards.conventionalCommits },
  { key: 'keep-a-changelog', standard: sources.standards.keepAChangelog.standard, measure: 'changelog-structure', observable: true, source: sources.standards.keepAChangelog },
  { key: 'changelog-file', standard: 'GOVERNANCE.md 8, CHANGELOG.md', measure: 'changelog-file', observable: true, source: { ...sources.policy, path: sources.policy.governance.path, sha256: sources.policy.governance.sha256 } },
  // GitHub Releases are read through the REST API, which this environment does not reach; the norm is carried.
  { key: 'release-notes', standard: 'GOVERNANCE.md 8, release notes', measure: 'release-notes', observable: false, source: { ...sources.policy, path: sources.policy.governance.path, sha256: sources.policy.governance.sha256 } },
];
const conventions = CONVENTIONS.map((c, index) => ({ index, key: c.key, standard: c.standard, measure: c.measure, observable: c.observable, source: `${c.source.url}@${c.source.commit}:${c.source.path}#sha256:${c.source.sha256}` }));
const conv = new Map(conventions.map((c) => [c.key, c.index]));
const norms = n.norms.map((x, index) => ({ index, ...x, convention: conv.get(x.convention) }));
for (const x of norms) if (x.convention === undefined) throw new Error(`a norm names an unknown convention`);
const REQ = { mandatory: 2, conditional: 1, recommended: 0 };
const normCode = (c) => Math.max(0, ...norms.filter((x) => x.convention === c).map((x) => REQ[x.requirement]));

const clauses = [];
const clause = (c, number, statement, check, how) => clauses.push({ index: clauses.length, convention: conv.get(c), number, statement: statement.length > 240 ? `${statement.slice(0, 237)}...` : statement, check, how });
const SV = {
  2: ['checked', 'the FAQ regular expression on every candidate version'],
  9: ['checked', 'the FAQ regular expression on every candidate version'],
  10: ['checked', 'the FAQ regular expression on every candidate version'],
  11: ['checked', 'the item 11 comparator on every tag series and changelog, against semver.compare'],
  4: ['formless', 'any 0.y.z is allowed; nothing a version string says can break it'],
};
n.semver.items.forEach((s, i) => clause('semver', String(i + 1), s, ...(SV[i + 1] ?? ['undecidable', 'states what a release means or contains; not decidable from a tag or a manifest'])));
const CC = {
  1: ['checked', 'the header grammar'], 4: ['checked', 'the header grammar'], 5: ['checked', 'the header grammar'], 13: ['checked', 'the header grammar'],
  6: ['checked', 'the second line of a message with a body is blank'],
  12: ['checked', 'a BREAKING CHANGE footer is uppercase and followed by a colon, a space and a description'],
  15: ['checked', 'the BREAKING CHANGE footer check, which reads the token case-insensitively and requires it uppercase'],
  16: ['checked', 'BREAKING-CHANGE is read as BREAKING CHANGE by the footer check'],
  7: ['formless', 'the body is free-form'], 8: ['formless', 'footers are optional and a trailing paragraph is body when it is not footers'],
  9: ['formless', 'a line that is not token-and-separator is body, so the footer grammar cannot be broken'],
  10: ['formless', 'as item 9'], 11: ['formless', 'a breaking change may be in either place; the footer form is checked by item 12'],
};
n.cc.items.forEach((s, i) => clause('conventional-commits', String(i + 1), s, ...(CC[i + 1] ?? ['undecidable', 'states what a commit means or how an implementor reads it'])));
const KAC = {
  'Changelogs are for humans, not machines.': ['undecidable', 'a judgement on the prose'],
  'There should be an entry for every single version.': ['checked', 'every-version: each SemVer tag of the main series has a version heading'],
  'The same types of changes should be grouped.': ['checked', 'change-types: every ### heading is one of the six types'],
  'Versions and sections should be linkable.': ['checked', 'linkable: every bracketed heading has a link reference definition'],
  'The latest version comes first.': ['checked', 'latest-first: dates do not increase and SemVer precedence decreases down the file'],
  'The release date of each version is displayed.': ['checked', 'version-headings and iso-8601-dates'],
  'Mention whether you follow Semantic Versioning.': ['checked', 'semver-mentioned'],
};
n.kac.principles.forEach((s, i) => clause('keep-a-changelog', `principle ${i + 1}`, s, ...(KAC[s] ?? (() => { throw new Error(`the Keep a Changelog principle "${s}" is not mapped to a check`); })())));
clause('keep-a-changelog', 'types', `Types of changes: ${n.kac.types.join(', ')}.`, 'checked', 'change-types');
clause('keep-a-changelog', 'effort', 'Keep an Unreleased section at the top to track upcoming changes.', 'checked', 'unreleased-first');
clause('keep-a-changelog', 'filename', 'Call it CHANGELOG.md.', 'checked', 'the file at the repository root, case-sensitive');
clause('keep-a-changelog', 'yanked', '## [0.0.5] - 2014-12-13 [YANKED]', 'checked', 'version-headings accepts the [YANKED] suffix and no other');
clause('keep-a-changelog', 'dates', 'Dates formatted like 2017-07-17 (ISO 8601) are the recommended format.', 'checked', 'iso-8601-dates: YYYY-MM-DD and a calendar date');
for (const x of norms) clause(conventions[x.convention].key, `${x.section}`, x.statement, x.convention === conv.get('release-notes') ? 'undecidable' : 'checked', x.convention === conv.get('release-notes') ? 'GitHub Releases are not observed here' : x.convention === conv.get('semver') ? 'the SemVer outcome' : x.convention === conv.get('changelog-file') ? 'CHANGELOG.md at the root' : 'the Conventional Commits outcome, and the Foundation profile through commitlint');
clause('conventional-commits', 'profile', `CONTRIBUTING.md description: ${n.profile.description}`, 'checked', `commitlint with @commitlint/config-conventional and type-enum [${n.profile.types.join(', ')}], subject-max-length ${n.profile.maxDescription}; "Imperative mood" is undecidable`);

// ---- Repositories.
const tierOf = new Map(tiers.json.repositories.map((r) => [r.name, r.tier]));
const archivedOf = new Map(tiers.json.repositories.map((r) => [r.name, r.archived]));
const repositories = [];
const outcomes = [];
const tagRecords = [];
const manifestRecords = [];
const violations = [];
const changelogChecks = [];
const refusals = [];
const findings = new Map();
const lowerBound = (versions) => [...versions].sort((a, b) => compareSemver(re, a, b));

for (const [ri, r] of scan.json.repositories.entries()) {
  const tier = tierOf.get(r.repository) ?? '';
  const tierKnown = tier !== '';
  const tierBound = tier === 'tier-1-core' || tier === 'tier-2-impl';

  // Commits: the specification (own grammar), the parser, commitlint unmodified and the Foundation profile.
  let conforming = 0, parserAccepted = 0, lintValid = 0, lintIgnored = 0, profileValid = 0, agentCommits = 0, agentConforming = 0;
  const tally = new Map();
  const bump = (source, rule, agent) => { const k = `${source}\u0000${rule}`; const t = tally.get(k) ?? { source, rule, count: 0, agentCount: 0 }; t.count += 1; if (agent) t.agentCount += 1; tally.set(k, t); };
  for (const c of r.commits) {
    const accepted = Boolean(c.parser.type && c.parser.subject);
    if (accepted) parserAccepted += 1;
    const headerOk = !c.violations.includes('header');
    if (headerOk && !accepted) throw new Error(`${r.repository} ${c.sha}: the specification's grammar accepts "${c.header}" and conventional-commits-parser does not`);
    if (headerOk && (c.parser.type !== c.type || c.parser.subject !== c.description)) throw new Error(`${r.repository} ${c.sha}: the grammar and the parser read "${c.header}" differently`);
    const ok = c.violations.length === 0;
    if (ok) conforming += 1;
    if (c.ignored) lintIgnored += 1;
    else {
      if (c.conventional.valid) lintValid += 1;
      if (c.profile.valid) profileValid += 1;
      for (const e of c.conventional.errors) bump('commitlint', e, c.agent);
      for (const w of c.conventional.warnings) bump('commitlint-warning', w, c.agent);
      for (const e of c.profile.errors) bump('profile', e, c.agent);
    }
    for (const v of c.violations) bump('spec', v, c.agent);
    if (c.agent) { agentCommits += 1; if (ok) agentConforming += 1; }
  }
  for (const t of [...tally.values()].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0))) violations.push({ index: violations.length, repository: ri, ...t });

  // Tags: classified, held to semver.valid, and ordered by precedence within each series.
  const classified = r.tags.map((t) => ({ ...t, ...classifyTag(re, t.name) }));
  for (const t of classified) {
    // semver.valid reads a leading "v" itself, so a v-prefixed tag is valid to it as the tag; a component tag is
    // valid to it from some "-" on; a tag the expression refuses is valid to it nowhere.
    const whole = t.oracle.tag !== null;
    const suffix = t.oracle.suffixes.some((v) => v !== null);
    const agrees = t.verdict === 'semver' || t.verdict === 'v-semver' ? whole : t.verdict === 'prefixed-semver' ? !whole && suffix : !whole && !suffix;
    if (!agrees) throw new Error(`${r.repository} tag ${t.name}: the FAQ expression says ${t.verdict}; semver.valid says ${JSON.stringify(t.oracle)}`);
  }
  const series = new Map();
  for (const t of classified.filter((x) => x.version)) { if (!series.has(t.series)) series.set(t.series, []); series.get(t.series).push(t); }
  let ties = 0, inversions = 0;
  const rank = new Map();
  for (const [, ts] of series) {
    ts.sort((a, b) => compareSemver(re, a.version, b.version) || (a.name < b.name ? -1 : 1));
    ts.forEach((t, i) => {
      rank.set(t.name, i);
      if (i && compareSemver(re, ts[i - 1].version, t.version) === 0) ties += 1;
      if (i && t.date && ts[i - 1].date && t.date < ts[i - 1].date) inversions += 1;
    });
  }
  // semver.compare must order the same versions the same way.
  const oracleOrder = r.oracleOrder.tags;
  for (let i = 1; i < oracleOrder.length; i++) if (compareSemver(re, oracleOrder[i - 1], oracleOrder[i]) > 0) throw new Error(`${r.repository}: semver.compare puts ${oracleOrder[i - 1]} before ${oracleOrder[i]}; item 11 does not`);
  for (const t of classified) tagRecords.push({ index: tagRecords.length, repository: ri, name: t.name, commit: t.commit, date: t.date, verdict: t.verdict, series: t.series, version: t.version, rank: rank.get(t.name) ?? 0 });
  const tagsVersion = classified.filter((t) => t.version).length;
  const tagsInvalid = classified.filter((t) => t.verdict === 'invalid').length;

  // Manifest versions.
  let manifestsVersioned = 0, manifestsInvalid = 0;
  for (const m of r.manifests) {
    const valid = m.version !== '' && re.test(m.version);
    if (m.version !== '') {
      manifestsVersioned += 1;
      if (!valid) manifestsInvalid += 1;
      if (valid !== (m.oracle === m.version)) throw new Error(`${r.repository} ${m.path}: the FAQ expression and semver.valid disagree on ${m.version}`);
    }
    manifestRecords.push({ index: manifestRecords.length, repository: ri, package: m.package, ecosystem: m.ecosystem, path: m.path, version: m.version, from: m.from, valid });
  }

  // CHANGELOG.md.
  let checks = [];
  let oracleAgrees = true;
  if (r.changelog) {
    const parsed = kacParse(re, n.kac.types, r.changelog.text);
    const main = (series.get('') ?? []).map((t) => t.version);
    const headed = new Set(parsed.releases.map((x) => x.version));
    const missing = main.filter((v) => !headed.has(v));
    checks = [...parsed.checks, { check: 'every-version', holds: missing.length === 0, detail: missing.length ? `no heading for ${missing.length} tagged versions: ${lowerBound(missing).slice(-8).join(', ')}` : '' }];
    // keep-a-changelog 3.2.0 stops at the first line it cannot read. It must read a changelog every check passes,
    // and must stop on one some structural check refuses; where it reads one, it must find the same releases.
    const structural = checks.filter((c) => ['version-headings', 'change-types', 'iso-8601-dates'].includes(c.check));
    const own = structural.every((c) => c.holds);
    const o = r.changelog.oracle;
    if (o.parsed !== own) oracleAgrees = false;
    if (o.parsed && own) {
      const mine = parsed.releases.map((x) => `${x.version} ${x.date}`).join();
      const theirs = o.releases.filter((x) => x.version).map((x) => `${x.version} ${x.date}`).join();
      if (mine !== theirs) oracleAgrees = false;
    }
    if (!oracleAgrees) refusals.push({ repository: ri, convention: conv.get('keep-a-changelog'), refusal: 'oracle-disagreement', detail: `${r.repository} CHANGELOG.md: the projector's checks ${own ? 'pass' : 'fail'} its structure; keep-a-changelog 3.2.0 ${o.parsed ? 'reads it' : `stops: ${o.error}`}` });
    for (const c of checks) changelogChecks.push({ index: changelogChecks.length, repository: ri, ...c, detail: c.detail.length > 300 ? `${c.detail.slice(0, 297)}...` : c.detail });
  }
  const changelogFailed = checks.filter((c) => !c.holds).length;
  const archived = Boolean(archivedOf.get(r.repository));
  const rec = {
    index: ri, name: r.repository, commit: r.commit, tier, tierKnown, tierBound, archived,
    commitsEvaluated: r.commits.length, conforming, nonconforming: r.commits.length - conforming, parserAccepted, lintValid, lintIgnored, profileValid, agentCommits, agentConforming,
    tagsTotal: classified.length, tagsVersion, tagsInvalid, tagsOther: classified.length - tagsVersion - tagsInvalid, precedenceTies: ties, chronologyInversions: inversions,
    manifestsVersioned, manifestsInvalid,
    changelog: Boolean(r.changelog), changelogChecks: checks.length, changelogFailed, oracleAgrees,
    nestedChangelogs: r.changelogs.filter((p) => p !== 'CHANGELOG.md'), nearMisses: r.nearMisses,
    // A manifest version that no tag of any series names, when the repository tags versions at all.
    untaggedVersions: tagsVersion ? [...new Set(r.manifests.filter((m) => m.version && re.test(m.version)).map((m) => m.version))].filter((v) => !classified.some((t) => t.version && compareSemver(re, t.version, v) === 0)).sort() : [],
    highestTag: (series.get('') ?? []).length ? series.get('').at(-1).version : '',
  };
  repositories.push(rec);

  // One outcome per convention.
  for (const c of conventions) {
    const { measured, failing } = measure(c.measure, rec);
    const status = !c.observable ? (measured === 0 ? 'vacuous' : 'unobserved') : measured === 0 ? 'vacuous' : failing > 0 ? 'unmet' : 'met';
    const code = normCode(c.index);
    const requirement = code === 2 ? 'mandatory' : code === 1 ? (tierKnown ? (tierBound ? 'mandatory' : 'recommended') : 'conditional') : 'recommended';
    const detail = describe(c.key, rec, status);
    outcomes.push({ index: outcomes.length, repository: ri, convention: c.index, requirement, status, measured, failing, detail });
    if ((requirement === 'mandatory' || requirement === 'conditional') && (status === 'unmet' || status === 'unobserved')) {
      refusals.push({ repository: ri, convention: c.index, refusal: `${requirement}-${status}`, detail: `${r.repository}: ${detail}${requirement === 'conditional' ? '; the norm binds Tier 1 and 2, and no tier topic is recorded (ecosystem/register.json)' : ''}` });
    }
  }
  findings.set(ri, { classified, checks, r });
}

function measure(kind, x) {
  if (kind === 'versions') return { measured: x.tagsVersion + x.tagsInvalid + x.manifestsVersioned, failing: x.tagsInvalid + x.manifestsInvalid };
  if (kind === 'commits') return { measured: x.commitsEvaluated, failing: x.nonconforming };
  if (kind === 'changelog-structure') return { measured: 1 + x.changelogChecks, failing: x.changelog ? x.changelogFailed : 1 };
  if (kind === 'changelog-file') return { measured: 1, failing: x.changelog ? 0 : 1 };
  if (kind === 'release-notes') return { measured: x.tagsVersion, failing: 0 };
  throw new Error(kind);
}
function describe(key, x, status) {
  if (key === 'semver') return status === 'vacuous' ? 'no tag or manifest names a version' : `${x.tagsVersion} of ${x.tagsTotal} tags and ${x.manifestsVersioned - x.manifestsInvalid} of ${x.manifestsVersioned} manifest versions are SemVer; ${x.tagsInvalid} tags begin as a version and are not one`;
  if (key === 'conventional-commits') return `${x.conforming} of the last ${x.commitsEvaluated} commits conform to Conventional Commits 1.0.0 (${x.agentConforming} of ${x.agentCommits} agent-attributed)`;
  if (key === 'keep-a-changelog') return x.changelog ? `CHANGELOG.md fails ${x.changelogFailed} of ${x.changelogChecks} Keep a Changelog checks` : 'no CHANGELOG.md at the root';
  if (key === 'changelog-file') return x.changelog ? 'CHANGELOG.md is at the root' : `no CHANGELOG.md at the root${x.nestedChangelogs.length ? ` (${x.nestedChangelogs.length} nested)` : ''}`;
  return status === 'vacuous' ? 'no version tag' : `${x.tagsVersion} version tags; their GitHub Releases are not observed`;
}

// ---- Policy claims: what the sources cannot settle, carried, never guessed.
const policyClaims = [];
for (const c of clauses.filter((x) => x.check === 'undecidable')) policyClaims.push({ refusal: 'clause-undecidable', detail: `${conventions[c.convention].standard} ${c.number}: ${c.how}` });
policyClaims.push({ refusal: 'clause-undecidable', detail: 'CONTRIBUTING.md Commit Message Standard: "Imperative mood" is not decidable on text' });
policyClaims.push({ refusal: 'tier-undetermined', detail: `STANDARDS.md and GOVERNANCE.md 8 bind Semantic Versioning to Tier 1 and 2; ${repositories.filter((x) => !x.tierKnown).length} of ${repositories.length} repositories carry no tier topic, so SemVer is conditional for them` });
const superseded = kacParse(re, n.kac.types, n.kac.example).releases[0];
if (superseded && compareSemver(re, superseded.version, '1.1.0') > 0) policyClaims.push({ refusal: 'edition-superseded', detail: `Keep a Changelog ${superseded.version} (${superseded.date}) is published at the pinned commit; this register implements 1.1.0, which the brief names; its 2.0.0 entry says the format is unchanged` });
policyClaims.push({ refusal: 'norm-unobserved', detail: `GOVERNANCE.md 8: "${n.releaseNotes}" GitHub Releases are not read by this register` });
policyClaims.push({ refusal: 'norm-unmeasured', detail: 'GOVERNANCE.md 8: "Keep CHANGELOG.md updated" names no measure of updatedness; only the file is checked, and every-version under Keep a Changelog' });

// ---- Drafts: per-repository remediation, as data only.
const drafts = new Map();
for (const x of repositories) {
  const { classified, checks, r } = findings.get(x.index);
  const os = outcomes.filter((o) => o.repository === x.index);
  if (os.every((o) => o.status !== 'unmet') && !x.untaggedVersions.length) continue;
  const md = [];
  md.push(`# ${x.name}: release and change conventions`, '');
  md.push(`Generated by \`node conventions/project.mjs\` from \`conventions/register.json\`; data only, nothing here has been applied. Observed at \`${x.commit}\`${x.archived ? ' (the repository is archived: it must be unarchived by its owner before any of this can land)' : ''}.`, '');
  md.push('| Convention | Requirement | Outcome | Detail |', '| --- | --- | --- | --- |');
  for (const o of os) md.push(`| ${conventions[o.convention].standard} | ${o.requirement} | ${o.status} | ${o.detail.replace(/\|/g, '\\|')} |`);
  md.push('');
  const cc = os.find((o) => o.convention === conv.get('conventional-commits'));
  if (cc.status === 'unmet') {
    md.push('## Commits', '');
    md.push(`${x.nonconforming} of the last ${x.commitsEvaluated} commits do not conform. Published history is not rewritten; the remedy is a check on every new commit. Rules violated:`, '');
    for (const v of violations.filter((y) => y.repository === x.index)) md.push(`- ${v.source} \`${v.rule}\`: ${v.count}${v.agentCount ? ` (${v.agentCount} agent-attributed)` : ''}`);
    md.push('', 'The Foundation profile (CONTRIBUTING.md "Commit Message Standard") as a commitlint configuration, `commitlint.config.mjs`:', '');
    md.push('```js', "export default {", "  extends: ['@commitlint/config-conventional'],", '  rules: {', `    'type-enum': [2, 'always', [${n.profile.types.map((t) => `'${t}'`).join(', ')}]],`, `    'subject-max-length': [2, 'always', ${n.profile.maxDescription}],`, '  },', '};', '```', '');
    if (x.lintIgnored) md.push(`${x.lintIgnored} of them are merge commits or other messages commitlint ignores by default; CONTRIBUTING.md (workflow step 6) has a Maintainer merge by squash-and-merge, which leaves none.`, '');
    md.push('Pull requests are squash-merged (CONTRIBUTING.md workflow step 6), so the squash commit title is the commit message to check: GitHub\'s "Default commit message" for squash merges set to "Pull request title", and the title checked by the same configuration.', '');
  }
  const sv = os.find((o) => o.convention === conv.get('semver'));
  if (sv.status === 'unmet') {
    md.push('## Versions', '');
    for (const t of classified.filter((y) => y.verdict === 'invalid')) md.push(`- tag \`${t.name}\` (${t.commit.slice(0, 12)}) begins as a version and is not SemVer 2.0.0. A published tag is not moved or deleted; the next release is tagged with a SemVer version, \`v\` prefix allowed (SemVer FAQ).`);
    for (const m of manifestRecords.filter((y) => y.repository === x.index && y.version && !y.valid)) md.push(`- \`${m.path}\` declares version \`${m.version}\`, which is not SemVer 2.0.0.`);
    md.push('');
  }
  if (x.untaggedVersions.length) {
    md.push('## Manifest versions without a tag', '');
    md.push(`The repository tags releases, and these manifest versions have no tag of that version: ${x.untaggedVersions.map((v) => `\`${v}\``).join(', ')}${x.highestTag ? ` (the highest tagged version is \`${x.highestTag}\`)` : ''}. SemVer item 3 (released contents are not modified) is checkable only when each release is tagged.`, '');
  }
  const kc = os.find((o) => o.convention === conv.get('keep-a-changelog'));
  if (kc.status === 'unmet') {
    md.push('## CHANGELOG.md', '');
    if (!x.changelog) {
      const main = classified.filter((y) => y.series === '' && y.version).sort((a, b) => compareSemver(re, b.version, a.version));
      md.push(`No CHANGELOG.md at the root${x.nestedChangelogs.length ? `; nested: ${x.nestedChangelogs.map((p) => `\`${p}\``).join(', ')}` : ''}${x.nearMisses.length ? `; other release files: ${x.nearMisses.map((p) => `\`${p}\``).join(', ')}` : ''}. A skeleton in the Keep a Changelog 1.1.0 form, one section per tagged version, dated by the tagged commit's committer date (the release date where no other record exists; correct it where one does):`, '');
      md.push('```markdown', '# Changelog', '', 'All notable changes to this project will be documented in this file.', '', 'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),', 'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).', '', '## [Unreleased]', '');
      for (const t of main) md.push(`## [${t.version}] - ${t.date.slice(0, 10) || 'YYYY-MM-DD'}`, '');
      const repoUrl = r.url.replace(/\.git$/, '');
      if (main.length) {
        md.push(`[unreleased]: ${repoUrl}/compare/${main[0].name}...HEAD`);
        main.forEach((t, i) => md.push(i + 1 < main.length ? `[${t.version}]: ${repoUrl}/compare/${main[i + 1].name}...${t.name}` : `[${t.version}]: ${repoUrl}/releases/tag/${t.name}`));
      }
      md.push('```', '');
      if (main.length) md.push('Each section is filled with the notable changes under Added, Changed, Deprecated, Removed, Fixed or Security; the commit history is a source, not the entry.', '');
    } else {
      for (const c of checks.filter((y) => !y.holds)) md.push(`- \`${c.check}\`: ${c.detail || 'fails'}`);
      md.push('');
    }
  }
  drafts.set(`conventions/drafts/${x.name}.md`, `${md.join('\n').trimEnd()}\n`);
}

// ---- The register.
const sum = (k) => repositories.reduce((a, x) => a + x[k], 0);
const count = (p) => outcomes.filter(p).length;
const counts = {
  repositories: repositories.length,
  conventions: conventions.length,
  outcomes: outcomes.length,
  byStatus: Object.fromEntries(['met', 'unmet', 'vacuous', 'unobserved'].map((s) => [s, count((o) => o.status === s)])),
  byConvention: Object.fromEntries(conventions.map((c) => [c.key, Object.fromEntries(['met', 'unmet', 'vacuous', 'unobserved'].map((s) => [s, count((o) => o.convention === c.index && o.status === s)]))])),
  commitsEvaluated: sum('commitsEvaluated'),
  commitsConforming: sum('conforming'),
  parserAccepted: sum('parserAccepted'),
  lintValid: sum('lintValid'),
  lintIgnored: sum('lintIgnored'),
  profileValid: sum('profileValid'),
  agentCommits: sum('agentCommits'),
  agentConforming: sum('agentConforming'),
  tags: tagRecords.length,
  tagsVersion: sum('tagsVersion'),
  tagsInvalid: sum('tagsInvalid'),
  manifestsVersioned: sum('manifestsVersioned'),
  manifestsInvalid: sum('manifestsInvalid'),
  changelogs: repositories.filter((x) => x.changelog).length,
  openClaims: refusals.length,
  policyClaims: policyClaims.length,
  drafts: drafts.size,
};
const register = {
  spec: 'uor-community/conventions-register/1',
  about: 'The release and change conventions register of The UOR Foundation, projected by conventions/project.mjs from conventions/scan.json and the pinned specifications and Foundation norms. Every repository has one outcome per convention; every mandatory or conditional convention that is unmet or unobserved is an open claim.',
  standards: CONVENTIONS.slice(0, 3).map((c) => `${c.standard} (${c.source.published}, ${c.source.url}@${c.source.commit}:${c.source.path}, sha256:${c.source.sha256})`),
  tools: { oracles: scan.json.tools, lock: scan.json.inputs.find((i) => i.path === sources.inputs.oracleLock) },
  semverRegex: { source: n.semver.source, sha256: sha256(Buffer.from(n.semver.source)) },
  profile: { document: n.profile.document, types: n.profile.types, maxDescription: n.profile.maxDescription, rules: n.profile.rules },
  inputs: [scan, tiers].map(({ path, sha256: s }) => ({ path, sha256: s })),
  scanInputs: scan.json.inputs,
  sources: n.documents,
  depth: sources.depth,
  counts,
  conventions,
  norms,
  clauses,
  repositories,
  outcomes,
  tags: tagRecords,
  manifests: manifestRecords,
  violations,
  changelogChecks,
  refusals,
  policyClaims,
};
const files = [['conventions/register.json', `${JSON.stringify(register, null, 2)}\n`], ...drafts];
let stale = false;
const draftDir = join(here, 'drafts');
if (flag === '--check') {
  for (const [path, text] of files) {
    const target = join(root, path);
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`${path} is not the projection of its pinned sources\n`); stale = true; }
  }
  for (const f of existsSync(draftDir) ? readdirSync(draftDir) : []) if (!drafts.has(`conventions/drafts/${f}`)) { process.stderr.write(`conventions/drafts/${f} is not projected\n`); stale = true; }
} else {
  rmSync(draftDir, { recursive: true, force: true });
  mkdirSync(draftDir, { recursive: true });
  for (const [path, text] of files) writeFileSync(join(root, path), text);
}
if (stale) process.exit(1);
process.stdout.write(`${counts.repositories} repositories x ${counts.conventions} conventions: ${counts.byStatus.met} met, ${counts.byStatus.unmet} unmet, ${counts.byStatus.vacuous} vacuous, ${counts.byStatus.unobserved} unobserved; ${counts.commitsConforming}/${counts.commitsEvaluated} commits conform (${counts.agentConforming}/${counts.agentCommits} agent); ${counts.openClaims} open claims, ${counts.policyClaims} policy claims, ${counts.drafts} drafts\n`);
