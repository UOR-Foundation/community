#!/usr/bin/env node
/**
 * Write Foundation.Conventions.V1 from conventions/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Conventions/V1/Model.lex.tex  the types and registerValid;
 *   app/src/Conventions.lex.tex  every convention, norm, clause, repository,
 *     outcome, tag, manifest version, violated rule, changelog check and claim,
 *     and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid checks, beyond every reference resolving: every repository has
 * exactly one outcome per convention, in order; every outcome's measured and
 * failing counts are its repository's for that convention's measure, and its
 * status is the one they decide (met when something is measured and nothing
 * fails, unmet when something fails, vacuous when nothing is measured,
 * unobserved only for a convention this register cannot observe); its
 * requirement is the strongest the Foundation norms set for that convention,
 * conditional when the norm binds a tier the repository does not record; every
 * mandatory or conditional outcome that is unmet or unobserved is named by an
 * open claim; each repository's commit, tag, manifest and changelog counts
 * reconcile with its records; and the release totals are the sums.
 *
 *   node conventions/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Conventions.V1.Model';

const enums = {
  Requirement: ['mandatory', 'conditional', 'recommended'],
  Status: ['met', 'unmet', 'vacuous', 'unobserved'],
  Measure: ['versions', 'commits', 'changelog-structure', 'changelog-file', 'release-notes'],
  ClauseCheck: ['checked', 'formless', 'undecidable'],
  TagKind: ['semver', 'v-semver', 'prefixed-semver', 'invalid', 'not-a-version'],
  ViolationSource: ['spec', 'commitlint', 'commitlint-warning', 'profile'],
  Refusal: ['mandatory-unmet', 'conditional-unmet', 'mandatory-unobserved', 'conditional-unobserved', 'oracle-disagreement', 'clause-undecidable', 'tier-undetermined', 'edition-superseded', 'norm-unobserved', 'norm-unmeasured'],
};
const P = (v) => camel(v).replace(/^./, (c) => c.toUpperCase());
const is = (type, value) => def(`is${P(value)}`, [`value : ${type}`], 'Bool', match('value', enums[type].map((v) => [`${type}.${camel(v)}`, v === value ? 'true' : 'false'])));
const of = (name, measureBody) => def(name, ['measure : Measure', 'repository : Repository'], 'Nat', match('measure', enums.Measure.map((v) => [`Measure.${camel(v)}`, measureBody[v]])));
const countIn = (name, kind, cond) => def(name, [`values : (List ${kind})`, 'at : Nat'], 'Nat',
  match('values', [['List.nil', '0'], [`List.cons item rest`, `(if (((project item repository) =? at) && ${cond}) then (1 + (${name} rest at)) else (${name} rest at))`]]), 'values');
const sumOf = (name, field) => def(name, ['values : (List Repository)'], 'Nat', match('values', [['List.nil', '0'], ['List.cons repository rest', `((project repository ${field}) + (${name} rest))`]]), 'values');
const lookup = (name, kind, type, field, fallback) => def(name, [`values : (List ${kind})`, 'at : Nat'], type,
  match('values', [['List.nil', fallback], ['List.cons item rest', `(if ((project item index) =? at) then (project item ${field}) else (${name} rest at))`]]), 'values');
const inRepo = (name, body) => def(name, ['values : (List Repository)', 'at : Nat', 'measure : Measure'], 'Nat',
  match('values', [['List.nil', '0'], ['List.cons repository rest', `(if ((project repository index) =? at) then (${body} measure repository) else (${name} rest at measure))`]]), 'values');

const decl = {
  module: M,
  title: 'Conventions model',
  catalog: 'Conventions',
  catalogTitle: 'Conventions register',
  enums,
  kinds: [
    { name: 'Convention', list: 'conventions', fields: [['key', 'String'], ['standard', 'String'], ['measure', { enum: 'Measure' }], ['observable', 'Bool'], ['source', 'String']] },
    { name: 'Norm', list: 'norms', fields: [['convention', { ref: 'Convention' }], ['document', 'String'], ['section', 'String'], ['statement', 'String'], ['requirement', { enum: 'Requirement' }], ['condition', 'String']] },
    { name: 'Clause', list: 'clauses', fields: [['convention', { ref: 'Convention' }], ['number', 'String'], ['statement', 'String'], ['check', { enum: 'ClauseCheck' }], ['how', 'String']] },
    {
      name: 'Repository', list: 'repositories',
      fields: [
        ['name', 'String'], ['commit', 'String'], ['tier', 'String'], ['tierKnown', 'Bool'], ['tierBound', 'Bool'], ['archived', 'Bool'],
        ['commitsEvaluated', 'Nat'], ['conforming', 'Nat'], ['nonconforming', 'Nat'], ['parserAccepted', 'Nat'], ['lintValid', 'Nat'], ['lintIgnored', 'Nat'], ['profileValid', 'Nat'],
        ['agentCommits', 'Nat'], ['agentConforming', 'Nat'],
        ['tagsTotal', 'Nat'], ['tagsVersion', 'Nat'], ['tagsInvalid', 'Nat'], ['tagsOther', 'Nat'], ['precedenceTies', 'Nat'], ['chronologyInversions', 'Nat'],
        ['manifestsVersioned', 'Nat'], ['manifestsInvalid', 'Nat'],
        ['changelog', 'Bool'], ['changelogChecks', 'Nat'], ['changelogFailed', 'Nat'], ['oracleAgrees', 'Bool'],
      ],
      checks: ['(countsReconcile $)'],
    },
    {
      name: 'Outcome', list: 'outcomes',
      fields: [['repository', { ref: 'Repository' }], ['convention', { ref: 'Convention' }], ['requirement', { enum: 'Requirement' }], ['status', { enum: 'Status' }], ['measured', 'Nat'], ['failing', 'Nat'], ['detail', 'String']],
      checks: ['((project $ failing) <? ((project $ measured) + 1))'],
    },
    { name: 'Tag', list: 'tags', fields: [['repository', { ref: 'Repository' }], ['name', 'String'], ['commit', 'String'], ['date', 'String'], ['verdict', { enum: 'TagKind' }], ['series', 'String'], ['version', 'String'], ['rank', 'Nat']] },
    { name: 'Manifest', list: 'manifests', fields: [['repository', { ref: 'Repository' }], ['package', 'String'], ['ecosystem', 'String'], ['path', 'String'], ['version', 'String'], ['versioned', 'Bool'], ['valid', 'Bool']], checks: ['((project $ versioned) || (not (project $ valid)))'] },
    { name: 'Violation', list: 'violations', fields: [['repository', { ref: 'Repository' }], ['source', { enum: 'ViolationSource' }], ['rule', 'String'], ['count', 'Nat'], ['agentCount', 'Nat']], checks: ['((0 <? (project $ count)) && ((project $ agentCount) <? ((project $ count) + 1)))'] },
    { name: 'ChangelogCheck', list: 'changelogChecks', fields: [['repository', { ref: 'Repository' }], ['check', 'String'], ['holds', 'Bool'], ['detail', 'String']] },
    { name: 'OpenClaim', list: 'openClaims', fields: [['repository', { ref: 'Repository' }], ['convention', { ref: 'Convention' }], ['refusal', { enum: 'Refusal' }], ['detail', 'String']] },
    { name: 'PolicyClaim', list: 'policyClaims', fields: [['refusal', { enum: 'Refusal' }], ['detail', 'String']] },
  ],
  release: [
    ['standards', 'String'], ['oracles', 'String'], ['lock', 'String'], ['semverRegex', 'String'], ['sources', 'String'], ['inputs', 'String'], ['commits', 'String'],
    ['depth', 'Nat'], ['commitsEvaluated', 'Nat'], ['commitsConforming', 'Nat'], ['agentCommits', 'Nat'], ['agentConforming', 'Nat'], ['metCount', 'Nat'], ['unmetCount', 'Nat'],
  ],
  definitions: [
    ...enums.Status.map((v) => is('Status', v)),
    ...['semver', 'v-semver', 'prefixed-semver', 'invalid'].map((v) => is('TagKind', v)),
    is('Refusal', 'oracle-disagreement'),
    def('reqCode', ['value : Requirement'], 'Nat', match('value', [['Requirement.mandatory', '2'], ['Requirement.conditional', '1'], ['Requirement.recommended', '0']])),
    def('maxNat', ['left : Nat', 'right : Nat'], 'Nat', '(if (left <? right) then right else left)'),
    // Every count a repository records is bounded by the commits, tags, manifests or checks it was read from.
    def('countsReconcile', ['repository : Repository'], 'Bool',
      '(((((project repository conforming) + (project repository nonconforming)) =? (project repository commitsEvaluated)) && (((project repository conforming) <? ((project repository parserAccepted) + 1)) && ((project repository parserAccepted) <? ((project repository commitsEvaluated) + 1)))) && (((((project repository lintValid) + (project repository lintIgnored)) <? ((project repository commitsEvaluated) + 1)) && (((project repository profileValid) + (project repository lintIgnored)) <? ((project repository commitsEvaluated) + 1))) && ((((project repository agentConforming) <? ((project repository agentCommits) + 1)) && (((project repository agentCommits) <? ((project repository commitsEvaluated) + 1)) && ((project repository agentConforming) <? ((project repository conforming) + 1)))) && (((((project repository tagsVersion) + (project repository tagsInvalid)) + (project repository tagsOther)) =? (project repository tagsTotal)) && (((project repository manifestsInvalid) <? ((project repository manifestsVersioned) + 1)) && (((project repository changelogFailed) <? ((project repository changelogChecks) + 1)) && (((project repository changelog) || ((project repository changelogChecks) =? 0)) && ((not (project repository tierBound)) || (project repository tierKnown)))))))))'),
    // What each convention measures in a repository, and how much of it fails.
    of('measuredOf', {
      versions: '(((project repository tagsVersion) + (project repository tagsInvalid)) + (project repository manifestsVersioned))',
      commits: '(project repository commitsEvaluated)',
      'changelog-structure': '(1 + (project repository changelogChecks))',
      'changelog-file': '1',
      'release-notes': '(project repository tagsVersion)',
    }),
    of('failingOf', {
      versions: '((project repository tagsInvalid) + (project repository manifestsInvalid))',
      commits: '(project repository nonconforming)',
      'changelog-structure': '(if (project repository changelog) then (project repository changelogFailed) else 1)',
      'changelog-file': '(if (project repository changelog) then 0 else 1)',
      'release-notes': '0',
    }),
    def('statusFits', ['status : Status', 'observable : Bool', 'measured : Nat', 'failing : Nat'], 'Bool',
      '(if observable then ((((isMet status) && ((0 <? measured) && (failing =? 0))) || ((isUnmet status) && (0 <? failing))) || ((isVacuous status) && (measured =? 0))) else (((isVacuous status) && (measured =? 0)) || ((isUnobserved status) && (0 <? measured))))'),
    def('normCode', ['values : (List Norm)', 'at : Nat'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons norm rest', '(if ((project norm convention) =? at) then (maxNat (reqCode (project norm requirement)) (normCode rest at)) else (normCode rest at))']]), 'values'),
    def('requiredOf', ['code : Nat', 'repository : Repository'], 'Nat',
      '(if (code =? 2) then 2 else (if (code =? 1) then (if (project repository tierKnown) then (if (project repository tierBound) then 2 else 0) else 1) else 0))'),
    lookup('measureAt', 'Convention', 'Measure', 'measure', '(ctor Measure.versions)'),
    lookup('observableAt', 'Convention', 'Bool', 'observable', 'false'),
    inRepo('measuredIn', 'measuredOf'),
    inRepo('failingIn', 'failingOf'),
    def('requiredIn', ['values : (List Repository)', 'at : Nat', 'code : Nat'], 'Nat',
      match('values', [['List.nil', '3'], ['List.cons repository rest', '(if ((project repository index) =? at) then (requiredOf code repository) else (requiredIn rest at code))']]), 'values'),
    def('claimed', ['row : Nat', 'column : Nat', 'values : (List OpenClaim)'], 'Bool',
      match('values', [['List.nil', 'false'], ['List.cons claim rest', '((((project claim repository) =? row) && ((project claim convention) =? column)) || (claimed row column rest))']]), 'values'),
    def('outcomeHolds', ['allConventions : (List Convention)', 'allNorms : (List Norm)', 'allRepositories : (List Repository)', 'claims : (List OpenClaim)', 'outcome : Outcome'], 'Bool',
      '((((project outcome measured) =? (measuredIn allRepositories (project outcome repository) (measureAt allConventions (project outcome convention)))) && ((project outcome failing) =? (failingIn allRepositories (project outcome repository) (measureAt allConventions (project outcome convention))))) && ((statusFits (project outcome status) (observableAt allConventions (project outcome convention)) (project outcome measured) (project outcome failing)) && (((reqCode (project outcome requirement)) =? (requiredIn allRepositories (project outcome repository) (normCode allNorms (project outcome convention)))) && ((((reqCode (project outcome requirement)) =? 0) || (not ((isUnmet (project outcome status)) || (isUnobserved (project outcome status))))) || (claimed (project outcome repository) (project outcome convention) claims)))))'),
    def('outcomesHold', ['allConventions : (List Convention)', 'allNorms : (List Norm)', 'allRepositories : (List Repository)', 'claims : (List OpenClaim)', 'values : (List Outcome)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons outcome rest', '((outcomeHolds allConventions allNorms allRepositories claims outcome) && (outcomesHold allConventions allNorms allRepositories claims rest))']]), 'values'),
    // One outcome per repository and convention, repositories in order and conventions in order within each.
    def('outcomesOrdered', ['row : Nat', 'column : Nat', 'columns : Nat', 'rows : Nat', 'values : (List Outcome)'], 'Bool',
      match('values', [['List.nil', '((row =? rows) && (column =? 0))'], ['List.cons outcome rest', '((((project outcome repository) =? row) && ((project outcome convention) =? column)) && (if ((column + 1) =? columns) then (outcomesOrdered (row + 1) 0 columns rows rest) else (outcomesOrdered row (column + 1) columns rows rest)))']]), 'values'),
    countIn('tagsOf', 'Tag', 'true'),
    countIn('versionTagsOf', 'Tag', '(((isSemver (project item verdict)) || (isVSemver (project item verdict))) || (isPrefixedSemver (project item verdict)))'),
    countIn('invalidTagsOf', 'Tag', '(isInvalid (project item verdict))'),
    countIn('versionedOf', 'Manifest', '(project item versioned)'),
    countIn('invalidManifestsOf', 'Manifest', '((project item versioned) && (not (project item valid)))'),
    countIn('checksOf', 'ChangelogCheck', 'true'),
    countIn('failedOf', 'ChangelogCheck', '(not (project item holds))'),
    countIn('disagreementsOf', 'OpenClaim', '(isOracleDisagreement (project item refusal))'),
    def('recordsReconcile', ['allTags : (List Tag)', 'allManifests : (List Manifest)', 'allChecks : (List ChangelogCheck)', 'claims : (List OpenClaim)', 'values : (List Repository)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons repository rest', '((((((tagsOf allTags (project repository index)) =? (project repository tagsTotal)) && ((versionTagsOf allTags (project repository index)) =? (project repository tagsVersion))) && (((invalidTagsOf allTags (project repository index)) =? (project repository tagsInvalid)) && ((versionedOf allManifests (project repository index)) =? (project repository manifestsVersioned)))) && ((((invalidManifestsOf allManifests (project repository index)) =? (project repository manifestsInvalid)) && ((checksOf allChecks (project repository index)) =? (project repository changelogChecks))) && (((failedOf allChecks (project repository index)) =? (project repository changelogFailed)) && ((project repository oracleAgrees) || (0 <? (disagreementsOf claims (project repository index))))))) && (recordsReconcile allTags allManifests allChecks claims rest))']]), 'values'),
    sumOf('evaluatedSum', 'commitsEvaluated'),
    sumOf('conformingSum', 'conforming'),
    sumOf('agentSum', 'agentCommits'),
    sumOf('agentConformingSum', 'agentConforming'),
    def('statusCount', ['values : (List Outcome)', 'wantMet : Bool'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons outcome rest', '(if (if wantMet then (isMet (project outcome status)) else (isUnmet (project outcome status))) then (1 + (statusCount rest wantMet)) else (statusCount rest wantMet))']]), 'values'),
  ],
  checks: [
    '(outcomesOrdered 0 0 (project release conventionsCount) (project release repositoriesCount) outcomes)',
    '(outcomesHold conventions norms repositories openClaims outcomes)',
    '(recordsReconcile tags manifests changelogChecks openClaims repositories)',
    '((evaluatedSum repositories) =? (project release commitsEvaluated))',
    '((conformingSum repositories) =? (project release commitsConforming))',
    '((agentSum repositories) =? (project release agentCommits))',
    '((agentConformingSum repositories) =? (project release agentConforming))',
    '((statusCount outcomes true) =? (project release metCount))',
    '((statusCount outcomes false) =? (project release unmetCount))',
  ],
};

// LexLean strings carry no raw percent sign or backslash.
const clean = (s) => String(s).replace(/%/g, ' percent').replace(/\\/g, '');
const cleanAll = (rows) => rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'string' ? clean(v) : v])));
const records = {
  conventions: cleanAll(r.conventions),
  norms: cleanAll(r.norms),
  clauses: cleanAll(r.clauses),
  repositories: cleanAll(r.repositories),
  outcomes: cleanAll(r.outcomes),
  tags: cleanAll(r.tags),
  manifests: cleanAll(r.manifests.map((m) => ({ ...m, versioned: m.version !== '' }))),
  violations: cleanAll(r.violations),
  changelogChecks: cleanAll(r.changelogChecks),
  openClaims: cleanAll(r.refusals),
  policyClaims: cleanAll(r.policyClaims),
};
const release = {
  standards: clean(r.standards.join('; ')),
  oracles: r.tools.oracles.map((t) => `${t.name}@${t.version} ${t.integrity}`).join(' '),
  lock: `${r.tools.lock.path}#sha256:${r.tools.lock.sha256}`,
  semverRegex: `semver.org FAQ expression, ECMAScript flavour, sha256:${r.semverRegex.sha256}`,
  sources: r.sources.map((s) => `${s.ref}#sha256:${s.sha256}`).join(' '),
  inputs: [...r.inputs, ...r.scanInputs].map((i) => `${i.path}#sha256:${i.sha256}`).join(' '),
  commits: r.repositories.map((x) => `${x.name}@${x.commit}`).join(' '),
  depth: r.depth,
  commitsEvaluated: r.counts.commitsEvaluated,
  commitsConforming: r.counts.commitsConforming,
  agentCommits: r.counts.agentCommits,
  agentConforming: r.counts.agentConforming,
  metCount: r.counts.byStatus.met,
  unmetCount: r.counts.byStatus.unmet,
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Conventions/V1/Model.lex.tex', typesModule(decl)],
  ['src/Conventions.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/conventions-model.toml', entry('conventions-model', 'Conventions model', M, 'registerValid')],
  ['language/prism.arch/entries/conventions-register.toml', entry('conventions-register', 'Conventions register', 'Conventions', 'registerValidHolds')],
];
// Balanced parentheses in every generated module: a string that opens one it does not close would unbalance it.
for (const [path, text] of outputs.slice(0, 2)) {
  let depth = 0;
  for (const ch of text.replace(/"(?:[^"\\]|\\.)*"/g, '""')) { if (ch === '(') depth += 1; if (ch === ')') depth -= 1; if (depth < 0) throw new Error(`${path} closes a parenthesis it did not open`); }
  if (depth) throw new Error(`${path} leaves ${depth} parentheses open`);
  if (/(?<!\\)%/.test(text)) throw new Error(`${path} carries a raw percent sign`);
}
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`app/${path} is not the catalog of conventions/register.json\n`); stale = true; }
  } else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); }
}
if (stale) process.exit(1);
process.stdout.write(decl.kinds.map((k) => `${records[k.list].length} ${k.list}`).join(', ') + '\n');
