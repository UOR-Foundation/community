#!/usr/bin/env node
/**
 * Write the Foundation.BestPractices.V1 facet from bestpractices/register.json
 * through tools/register-lex.mjs:
 *
 *   app/src/Foundation/BestPractices/V1/Model.lex.tex  its types, whose levels,
 *     categories and detectives are the badge's own, and registerValid;
 *   app/src/BestPractices.lex.tex  every criterion, repository, outcome, badge
 *     query and refusal, and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid holds when every criterion has exactly one outcome per
 * repository (the outcomes walk the criteria once per repository, in order,
 * and the walk ends as the last repository's block completes), when an
 * outcome is open exactly when its criterion is MUST and it is Unmet or
 * unknown, when N/A is recorded only where the criterion allows it, when an
 * unknown outcome carries no detective and a detective's carries its
 * confidence, and when every count reconciles with the release.
 *
 * The same register always writes the same bytes.
 *
 *   node bestpractices/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.BestPractices.V1.Model';
const NO_DETECTIVE = 'noDetective';

const enums = {
  Level: ['passing', 'silver', 'gold'],
  Category: ['must', 'should', 'suggested'],
  Status: ['met', 'unmet', 'na', 'unknown'],
  Owner: ['bestpractices', 'security'],
  Detective: [...r.detectives.map(camel), NO_DETECTIVE],
  Refusal: ['licenseAtLaterHead', 'headersUnreadable', 'selfDeclaredFile'],
};
for (const [name, values] of Object.entries(enums)) {
  if (new Set(values.map(camel)).size !== values.length) throw new Error(`${name} has a repeated constructor`);
}
// One branch per constructor, so a new value is decided, never defaulted.
const predicate = (name, type, holds) =>
  def(name, [`value : ${type}`], 'Bool', match('value', enums[type].map((v) => [`${type}.${camel(v)}`, holds(v) ? 'true' : 'false'])));
// A count over a list: one for each record the test holds of.
const total = (name, kind, test) =>
  def(name, [`values : (List ${kind})`], 'Nat', match('values', [['List.nil', '0'], [`List.cons item rest`, `((if ${test} then 1 else 0) + (${name} rest))`]]), 'values');
const sum = (name, kind, field) =>
  def(name, [`values : (List ${kind})`], 'Nat', match('values', [['List.nil', '0'], [`List.cons item rest`, `((project item ${field}) + (${name} rest))`]]), 'values');
const LEVELS = ['Passing', 'Silver', 'Gold'];

const decl = {
  module: M,
  title: 'Best Practices model',
  catalog: 'BestPractices',
  catalogTitle: 'Best Practices register',
  enums,
  kinds: [
    {
      name: 'Criterion',
      list: 'criteria',
      fields: [
        ['name', 'String'], ['level', { enum: 'Level' }], ['major', 'String'], ['minor', 'String'], ['category', { enum: 'Category' }],
        ['naAllowed', 'Bool'], ['metUrlRequired', 'Bool'], ['future', 'Bool'], ['obsolete', 'Bool'],
        ['owner', { enum: 'Owner' }], ['securityDecides', 'Bool'], ['descriptionDigest', 'String'],
      ],
      // The security facet decides a criterion only when it owns it.
      checks: ['((not (project $ securityDecides)) || (securityOwned (project $ owner)))'],
    },
    {
      name: 'Repository',
      list: 'repositories',
      fields: [
        ['name', 'String'], ['commit', 'String'], ['licenseSpdx', 'String'], ['licenseCurrent', 'Bool'], ['licensingExpression', 'String'],
        ['homepage', 'String'], ['met', 'Nat'], ['unmet', 'Nat'], ['na', 'Nat'], ['unknown', 'Nat'],
        ['open', 'Nat'], ['openPassing', 'Nat'], ['openSilver', 'Nat'], ['openGold', 'Nat'],
      ],
      checks: ['((project $ open) =? (((project $ openPassing) + (project $ openSilver)) + (project $ openGold)))'],
    },
    {
      name: 'Outcome',
      list: 'outcomes',
      fields: [
        ['repository', { ref: 'Repository' }], ['criterion', { ref: 'Criterion' }], ['status', { enum: 'Status' }],
        ['detective', { enum: 'Detective' }], ['cite', 'String'], ['confidence', 'Nat'], ['forced', 'Bool'], ['open', 'Bool'], ['evidence', 'String'],
      ],
      checks: [
        '(agree (isUnknown (project $ status)) ((project $ confidence) =? 0))',
        '(agree (isUnknown (project $ status)) (noDetective (project $ detective)))',
        // Chief.CONFIDENCE_OVERRIDE is 4 on a scale to MAX_CONFIDENCE 5.
        '(agree (project $ forced) (3 <? (project $ confidence)))',
        '((project $ confidence) <? 6)',
      ],
    },
    { name: 'BadgeQuery', list: 'badgeQueries', fields: [['query', 'String'], ['status', 'Nat'], ['found', 'Nat']] },
    { name: 'OpenRefusal', list: 'refusals', fields: [['repository', { ref: 'Repository' }], ['name', { enum: 'Refusal' }], ['reason', 'String']] },
  ],
  release: [
    ['badgeRepository', 'String'], ['badgeCommit', 'String'], ['criteriaDigest', 'String'], ['localeDigest', 'String'],
    ['readingDigest', 'String'], ['snapshotDigest', 'String'], ['securityCommit', 'String'], ['securityDigest', 'String'],
    ['metCount', 'Nat'], ['unmetCount', 'Nat'], ['naCount', 'Nat'], ['unknownCount', 'Nat'], ['openCount', 'Nat'],
    ['mustClearPassing', 'Nat'], ['mustClearSilver', 'Nat'], ['mustClearGold', 'Nat'], ['badgeEntries', 'Nat'],
  ],
  definitions: [
    def('agree', ['left : Bool', 'right : Bool'], 'Bool', '(if left then right else (not right))'),
    predicate('isMet', 'Status', (v) => v === 'met'),
    predicate('isUnmet', 'Status', (v) => v === 'unmet'),
    predicate('isNa', 'Status', (v) => v === 'na'),
    predicate('isUnknown', 'Status', (v) => v === 'unknown'),
    predicate('isMust', 'Category', (v) => v === 'must'),
    predicate('noDetective', 'Detective', (v) => v === NO_DETECTIVE),
    predicate('securityOwned', 'Owner', (v) => v === 'security'),
    // An outcome against its criterion: the same criterion, open exactly when a MUST is Unmet or unknown, N/A only where allowed.
    def('outcomeAgrees', ['criterion : Criterion', 'outcome : Outcome'], 'Bool',
      '((((project outcome criterion) =? (project criterion index)) && (agree (project outcome open) ((isMust (project criterion category)) && ((isUnmet (project outcome status)) || (isUnknown (project outcome status)))))) && ((not (isNa (project outcome status))) || (project criterion naAllowed)))'),
    def('agreesHead', ['cursor : (List Criterion)', 'position : Nat', 'outcome : Outcome'], 'Bool',
      match('cursor', [['List.nil', 'false'], ['List.cons criterion rest', '(((project outcome repository) =? position) && (outcomeAgrees criterion outcome))']])),
    def('restart', ['whole : (List Criterion)', 'rest : (List Criterion)'], '(List Criterion)',
      match('rest', [['List.nil', 'whole'], ['List.cons criterion more', 'rest']])),
    def('advance', ['whole : (List Criterion)', 'cursor : (List Criterion)'], '(List Criterion)',
      match('cursor', [['List.nil', 'whole'], ['List.cons criterion rest', '(restart whole rest)']])),
    def('restartPosition', ['rest : (List Criterion)', 'position : Nat'], 'Nat',
      match('rest', [['List.nil', '(position + 1)'], ['List.cons criterion more', 'position']])),
    def('nextPosition', ['cursor : (List Criterion)', 'position : Nat'], 'Nat',
      match('cursor', [['List.nil', 'position'], ['List.cons criterion rest', '(restartPosition rest position)']])),
    // The outcomes walk the criteria once per repository, in order: outcome k of block p is criterion k of
    // repository p, and the walk ends exactly as the last block completes, so every pair has one outcome.
    def('blockAligned', ['whole : (List Criterion)', 'cursor : (List Criterion)', 'position : Nat', 'width : Nat', 'values : (List Outcome)'], 'Bool',
      match('values', [['List.nil', '(position =? width)'], ['List.cons outcome rest', '((agreesHead cursor position outcome) && (blockAligned whole (advance whole cursor) (nextPosition cursor position) width rest))']]), 'values'),
    total('metTotal', 'Outcome', '(isMet (project item status))'),
    total('unmetTotal', 'Outcome', '(isUnmet (project item status))'),
    total('naTotal', 'Outcome', '(isNa (project item status))'),
    total('unknownTotal', 'Outcome', '(isUnknown (project item status))'),
    total('openTotal', 'Outcome', '(project item open)'),
    sum('repositoryMetTotal', 'Repository', 'met'),
    sum('repositoryUnmetTotal', 'Repository', 'unmet'),
    sum('repositoryNaTotal', 'Repository', 'na'),
    sum('repositoryUnknownTotal', 'Repository', 'unknown'),
    sum('repositoryOpenTotal', 'Repository', 'open'),
    ...LEVELS.map((l) => total(`clear${l}Total`, 'Repository', `((project item open${l}) =? 0)`)),
    sum('badgeFoundTotal', 'BadgeQuery', 'found'),
    // Every repository accounts for every criterion once.
    def('repositoriesComplete', ['width : Nat', 'values : (List Repository)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons item rest', '((((((project item met) + (project item unmet)) + (project item na)) + (project item unknown)) =? width) && (repositoriesComplete width rest))']]), 'values'),
  ],
  checks: [
    '(blockAligned criteria criteria 0 (project release repositoriesCount) outcomes)',
    '(repositoriesComplete (project release criteriaCount) repositories)',
    '((metTotal outcomes) =? (project release metCount))',
    '((unmetTotal outcomes) =? (project release unmetCount))',
    '((naTotal outcomes) =? (project release naCount))',
    '((unknownTotal outcomes) =? (project release unknownCount))',
    '((openTotal outcomes) =? (project release openCount))',
    '((repositoryMetTotal repositories) =? (project release metCount))',
    '((repositoryUnmetTotal repositories) =? (project release unmetCount))',
    '((repositoryNaTotal repositories) =? (project release naCount))',
    '((repositoryUnknownTotal repositories) =? (project release unknownCount))',
    '((repositoryOpenTotal repositories) =? (project release openCount))',
    ...LEVELS.map((l) => `((clear${l}Total repositories) =? (project release mustClear${l}))`),
    '((badgeFoundTotal badgeQueries) =? (project release badgeEntries))',
  ],
};

const LEVEL = { MUST: 'must', SHOULD: 'should', SUGGESTED: 'suggested' };
const records = {
  criteria: r.criteria.map((c) => ({
    name: c.id, level: c.level, major: c.major, minor: c.minor, category: LEVEL[c.category], naAllowed: c.naAllowed,
    metUrlRequired: c.metUrlRequired, future: c.future, obsolete: c.obsolete, owner: c.owner, securityDecides: c.securityDecides,
    descriptionDigest: `sha256:${c.descriptionSha256}`,
  })),
  repositories: r.repositories.map((x) => ({
    name: x.name, commit: x.commit, licenseSpdx: x.licenseSpdx, licenseCurrent: x.licenseCurrent, licensingExpression: x.licensingExpression,
    homepage: x.homepage, met: x.met, unmet: x.unmet, na: x.na, unknown: x.unknown, open: x.open,
    openPassing: x.openPassing, openSilver: x.openSilver, openGold: x.openGold,
  })),
  outcomes: r.outcomes.map((o) => ({
    repository: o.repository, criterion: o.criterion, status: o.status, detective: o.detective === 'none' ? NO_DETECTIVE : camel(o.detective),
    cite: o.cite, confidence: o.confidence, forced: o.forced, open: o.open, evidence: o.evidence,
  })),
  badgeQueries: r.badgeQueries.map((q) => ({ query: decodeURIComponent(q.query), status: q.status, found: q.found })),
  refusals: r.refusals.map((x) => ({ repository: x.repository, name: x.refusal, reason: x.detail })),
};
const file = (path) => r.badge.files.find((f) => f.path === path).sha256;
const release = {
  badgeRepository: r.badge.repository,
  badgeCommit: r.badge.commit,
  criteriaDigest: `sha256:${file('criteria/criteria.yml')}`,
  localeDigest: `sha256:${file('config/locales/en.yml')}`,
  readingDigest: `sha256:${r.inputs.find((i) => i.path === 'bestpractices/criteria.json').sha256}`,
  snapshotDigest: `sha256:${r.inputs.find((i) => i.path === 'bestpractices/snapshot.json').sha256}`,
  securityCommit: r.security.commit,
  securityDigest: `sha256:${r.security.sha256}`,
  metCount: r.counts.byStatus.met,
  unmetCount: r.counts.byStatus.unmet,
  naCount: r.counts.byStatus.na,
  unknownCount: r.counts.byStatus.unknown,
  openCount: r.counts.open,
  mustClearPassing: r.counts.mustClear.passing,
  mustClearSilver: r.counts.mustClear.silver,
  mustClearGold: r.counts.mustClear.gold,
  badgeEntries: r.counts.badgeEntries,
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/BestPractices/V1/Model.lex.tex', typesModule(decl)],
  ['src/BestPractices.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/best-practices-model.toml', entry('best-practices-model', 'Best Practices model', M, 'registerValid')],
  ['language/prism.arch/entries/best-practices-register.toml', entry('best-practices-register', 'Best Practices register', 'BestPractices', 'registerValidHolds')],
];
for (const [path, text] of outputs) {
  // LaTeX reads a raw percent sign as a comment, and an unbalanced parenthesis breaks a term.
  if (path.endsWith('.tex')) {
    if (text.includes('%')) throw new Error(`app/${path} would carry a raw percent sign`);
    let depth = 0;
    for (const ch of text.replace(/"(?:[^"\\]|\\.)*"/g, '""')) {
      depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
      if (depth < 0) throw new Error(`app/${path} closes a parenthesis it never opened`);
    }
    if (depth !== 0) throw new Error(`app/${path} leaves ${depth} parentheses open`);
  }
}
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of bestpractices/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
process.stdout.write(`${records.criteria.length} criteria, ${records.repositories.length} repositories, ${records.outcomes.length} outcomes, ${release.openCount} open MUST outcomes, ${records.refusals.length} refusals\n`);
