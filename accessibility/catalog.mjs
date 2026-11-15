#!/usr/bin/env node
/**
 * Write the Foundation.Accessibility.V1 facet from accessibility/register.json
 * through tools/register-lex.mjs:
 *
 *   app/src/Foundation/Accessibility/V1/Model.lex.tex  its types, whose levels are
 *     WCAG 2.2's and whose outcomes are the register's, and registerValid;
 *   app/src/Accessibility.lex.tex  every success criterion, conformance requirement,
 *     axe rule, page, reading, outcome, open claim, refusal, EN 301 549 clause and
 *     excluded service, and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid holds only if every page has exactly one reading per
 * configuration and exactly one outcome per targeted (Level A and AA)
 * criterion, every outcome agrees with what axe's mapped rules did on the
 * page (a pass needs a mapped rule that ran and passed, with none failed or
 * incomplete), every outcome but a pass is named by an open claim in order,
 * and EN 301 549 clause 9 requires every WCAG 2.1 Level A and AA criterion
 * exactly once. The same register always writes the same bytes.
 *
 *   node accessibility/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Accessibility.V1.Model';
const KINDS = ['failed', 'needsReview', 'passed', 'untested', 'uncovered'];

const enums = {
  // WCAG 2.2's conformance levels, and the word its source uses for a removed criterion.
  Level: ['levelA', 'levelAA', 'levelAAA', 'obsolete'],
  OutcomeKind: KINDS,
  Viewport: r.configurations.map((c) => c.viewport).filter((v, i, a) => a.indexOf(v) === i),
  Scheme: r.configurations.map((c) => c.scheme).filter((v, i, a) => a.indexOf(v) === i),
  Discovery: ['sitemap', 'crawl'],
  Route: ['rendered', 'redirected', 'unrouted'],
};
for (const [name, values] of Object.entries(enums)) {
  if (new Set(values.map(camel)).size !== values.length) throw new Error(`${name} has a repeated constructor`);
}
const predicate = (name, type, holds) =>
  def(name, [`value : ${type}`], 'Bool', match('value', enums[type].map((v) => [`${type}.${camel(v)}`, holds(v) ? 'true' : 'false'])));
const count = (name, kind, list, test) =>
  def(name, [`values : (List ${kind})`], 'Nat', match('values', [['List.nil', '0'], [`List.cons ${list} rest`, `((if ${test} then 1 else 0) + (${name} rest))`]]), 'values');
const p = (v, f) => `(project ${v} ${f})`;

const decl = {
  module: M,
  title: 'Accessibility model',
  catalog: 'Accessibility',
  catalogTitle: 'Accessibility register',
  enums,
  kinds: [
    {
      name: 'Criterion', list: 'criteria',
      fields: [['num', 'String'], ['handle', 'String'], ['level', { enum: 'Level' }], ['in21', 'Bool'], ['in22', 'Bool'], ['targeted', 'Bool'], ['slot', 'Nat'], ['axeRules', 'Nat']],
      checks: ['(criterionSound $)'],
    },
    { name: 'Requirement', list: 'requirements', fields: [['key', 'String'], ['title', 'String']] },
    { name: 'Rule', list: 'rules', fields: [['name', 'String'], ['mappedTo', 'String'], ['mapped', 'Nat']] },
    {
      name: 'Page', list: 'pages',
      fields: [['url', 'String'], ['service', 'String'], ['discovery', { enum: 'Discovery' }], ['route', { enum: 'Route' }], ['readingsRan', 'Nat']],
    },
    {
      name: 'Reading', list: 'readings',
      fields: [
        ['page', { ref: 'Page' }], ['slot', 'Nat'], ['viewport', { enum: 'Viewport' }], ['scheme', { enum: 'Scheme' }], ['status', 'Nat'], ['ran', 'Bool'],
        ['fetchedAt', 'String'], ['digest', 'String'], ['violations', 'Nat'], ['incomplete', 'Nat'], ['passes', 'Nat'], ['inapplicable', 'Nat'],
      ],
    },
    {
      name: 'Outcome', list: 'outcomes',
      fields: [
        ['page', { ref: 'Page' }], ['criterion', { ref: 'Criterion' }], ['slot', 'Nat'], ['result', { enum: 'OutcomeKind' }],
        ['rulesMapped', 'Nat'], ['violated', 'Nat'], ['incomplete', 'Nat'], ['passed', 'Nat'], ['inapplicable', 'Nat'], ['notRun', 'Nat'], ['ruleNames', 'String'],
      ],
      checks: ['(outcomeAgrees $)'],
    },
    { name: 'OpenClaim', list: 'openClaims', fields: [['outcome', { ref: 'Outcome' }], ['kind', { enum: 'OutcomeKind' }], ['detail', 'String']] },
    { name: 'Refusal', list: 'refusals', fields: [['name', 'String'], ['page', 'String'], ['detail', 'String']] },
    { name: 'Clause', list: 'clauses', fields: [['clause', 'String'], ['title', 'String'], ['void', 'Bool'], ['criterion', { ref: 'Criterion' }]] },
    { name: 'Exclusion', list: 'exclusions', fields: [['service', 'String'], ['url', 'String'], ['reason', 'String']] },
  ],
  release: [
    ['wcagRecommendation', 'String'], ['wcagCommit', 'String'], ['criteriaDigest', 'String'], ['conformanceDigest', 'String'], ['aaaNote', 'String'],
    ['websiteRoutes', 'String'], ['routesDigest', 'String'], ['inventoryDigest', 'String'], ['snapshotDigest', 'String'], ['takenAt', 'String'], ['sitemapDigest', 'String'],
    ['axeVersion', 'String'], ['axeIntegrity', 'String'], ['axeScript', 'String'], ['playwright', 'String'], ['browser', 'String'],
    ['enUrl', 'String'], ['enDigest', 'String'], ['enFetchedAt', 'String'], ['pdftotext', 'String'],
    ['targetedCount', 'Nat'], ['configurationCount', 'Nat'], ['enRequiredCount', 'Nat'],
    ...KINDS.map((k) => [`${k}Count`, 'Nat']),
  ],
  definitions: [
    predicate('levelTargeted', 'Level', (v) => v === 'levelA' || v === 'levelAA'),
    // EN 301 549 clause 9 requires the WCAG 2.1 Level A and AA criteria, one of which WCAG 2.2 records as obsolete.
    predicate('levelRequiredByEn', 'Level', (v) => v === 'levelA' || v === 'levelAA' || v === 'obsolete'),
    ...KINDS.map((k) => predicate(`is${k[0].toUpperCase()}${k.slice(1)}`, 'OutcomeKind', (v) => v === k)),
    def('agree', ['left : Bool', 'right : Bool'], 'Bool', '(if left then right else (not right))'),
    // A criterion is targeted exactly when WCAG 2.2 has it at Level A or AA; an untargeted one holds no slot.
    def('criterionSound', ['criterion : Criterion'], 'Bool',
      `((agree ${p('criterion', 'targeted')} (${p('criterion', 'in22')} && (levelTargeted ${p('criterion', 'level')}))) && (${p('criterion', 'targeted')} || (${p('criterion', 'slot')} =? 0)))`),
    // An outcome is the one its mapped rules' results give: failed on a violation, needsReview on an incomplete
    // result, passed only when a mapped rule ran and passed, untested when the rules found nothing, uncovered with none.
    def('outcomeAgrees', ['outcome : Outcome'], 'Bool', [
      `((${p('outcome', 'violated')} + (${p('outcome', 'incomplete')} + (${p('outcome', 'passed')} + (${p('outcome', 'inapplicable')} + ${p('outcome', 'notRun')})))) =? ${p('outcome', 'rulesMapped')})`,
      `(agree (isFailed ${p('outcome', 'result')}) (0 <? ${p('outcome', 'violated')}))`,
      `(agree (isNeedsReview ${p('outcome', 'result')}) ((${p('outcome', 'violated')} =? 0) && (0 <? ${p('outcome', 'incomplete')})))`,
      `(agree (isPassed ${p('outcome', 'result')}) ((${p('outcome', 'violated')} =? 0) && ((${p('outcome', 'incomplete')} =? 0) && (0 <? ${p('outcome', 'passed')}))))`,
      `(agree (isUntested ${p('outcome', 'result')}) ((${p('outcome', 'violated')} =? 0) && ((${p('outcome', 'incomplete')} =? 0) && ((${p('outcome', 'passed')} =? 0) && (0 <? ${p('outcome', 'rulesMapped')})))))`,
      `(agree (isUncovered ${p('outcome', 'result')}) (${p('outcome', 'rulesMapped')} =? 0))`,
    ].reduceRight((rest, x) => (rest === null ? x : `(${x} && ${rest})`), null)),
    // The targeted criteria hold the slots 0, 1, ... in order, and there are `total` of them.
    def('slotsValid', ['next : Nat', 'total : Nat', 'values : (List Criterion)'], 'Bool',
      match('values', [['List.nil', '(next =? total)'], ['List.cons criterion rest',
        `(if ${p('criterion', 'targeted')} then ((${p('criterion', 'slot')} =? next) && (slotsValid (next + 1) total rest)) else (slotsValid next total rest))`]]), 'values'),
    // The criterion an outcome names is targeted, holds the outcome's slot and maps the outcome's number of rules.
    def('criterionMatches', ['position : Nat', 'wanted : Nat', 'mapped : Nat', 'values : (List Criterion)'], 'Bool',
      match('values', [['List.nil', 'false'], ['List.cons criterion rest',
        `(if (${p('criterion', 'index')} =? position) then (${p('criterion', 'targeted')} && ((${p('criterion', 'slot')} =? wanted) && (${p('criterion', 'axeRules')} =? mapped))) else (criterionMatches position wanted mapped rest))`]]), 'values'),
    // Outcomes run page by page, each page through every slot once, and end after the last page.
    def('outcomesCover', ['atPage : Nat', 'atSlot : Nat', 'slots : Nat', 'last : Nat', 'table : (List Criterion)', 'values : (List Outcome)'], 'Bool',
      match('values', [['List.nil', '((atSlot =? 0) && (atPage =? last))'], ['List.cons outcome rest',
        `((${p('outcome', 'page')} =? atPage) && ((${p('outcome', 'slot')} =? atSlot) && ((criterionMatches ${p('outcome', 'criterion')} atSlot ${p('outcome', 'rulesMapped')} table) && (if ((atSlot + 1) =? slots) then (outcomesCover (atPage + 1) 0 slots last table rest) else (outcomesCover atPage (atSlot + 1) slots last table rest)))))`]]), 'values'),
    def('readingsCover', ['atPage : Nat', 'atSlot : Nat', 'slots : Nat', 'last : Nat', 'values : (List Reading)'], 'Bool',
      match('values', [['List.nil', '((atSlot =? 0) && (atPage =? last))'], ['List.cons reading rest',
        `((${p('reading', 'page')} =? atPage) && ((${p('reading', 'slot')} =? atSlot) && (if ((atSlot + 1) =? slots) then (readingsCover (atPage + 1) 0 slots last rest) else (readingsCover atPage (atSlot + 1) slots last rest))))`]]), 'values'),
    // Open claims follow the outcomes that are not passes, one each, in order, naming the same kind.
    def('claimNames', ['position : Nat', 'wanted : OutcomeKind', 'values : (List OpenClaim)'], 'Bool',
      match('values', [['List.nil', 'false'], ['List.cons claim rest', `((${p('claim', 'outcome')} =? position) && (sameKind wanted ${p('claim', 'kind')}))`]])),
    def('claimRest', ['values : (List OpenClaim)'], '(List OpenClaim)', match('values', [['List.nil', '(nil OpenClaim)'], ['List.cons claim rest', 'rest']])),
    def('claimsDone', ['values : (List OpenClaim)'], 'Bool', match('values', [['List.nil', 'true'], ['List.cons claim rest', 'false']])),
    def('claimsAccounted', ['claims : (List OpenClaim)', 'values : (List Outcome)'], 'Bool',
      match('values', [['List.nil', '(claimsDone claims)'], ['List.cons outcome rest',
        `(if (isPassed ${p('outcome', 'result')}) then (claimsAccounted claims rest) else ((claimNames ${p('outcome', 'index')} ${p('outcome', 'result')} claims) && (claimsAccounted (claimRest claims) rest)))`]]), 'values'),
    ...KINDS.map((k) => count(`${k}Outcomes`, 'Outcome', 'outcome', `(is${k[0].toUpperCase()}${k.slice(1)} ${p('outcome', 'result')})`)),
    // EN 301 549 clause 9: each clause that is not Void requires a later criterion than the one before it, of WCAG 2.1
    // at a level the clause requires; with the counts equal, every such criterion is required exactly once.
    def('requiredByEn', ['position : Nat', 'values : (List Criterion)'], 'Bool',
      match('values', [['List.nil', 'false'], ['List.cons criterion rest',
        `(if (${p('criterion', 'index')} =? position) then (${p('criterion', 'in21')} && (levelRequiredByEn ${p('criterion', 'level')})) else (requiredByEn position rest))`]]), 'values'),
    def('clausesOrdered', ['next : Nat', 'table : (List Criterion)', 'values : (List Clause)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons clause rest',
        `(if ${p('clause', 'void')} then (clausesOrdered next table rest) else ((next <=? ${p('clause', 'criterion')}) && ((requiredByEn ${p('clause', 'criterion')} table) && (clausesOrdered (${p('clause', 'criterion')} + 1) table rest))))`]]), 'values'),
    count('enRequiredCriteria', 'Criterion', 'criterion', `(${p('criterion', 'in21')} && (levelRequiredByEn ${p('criterion', 'level')}))`),
    count('enRequiringClauses', 'Clause', 'clause', `(not ${p('clause', 'void')})`),
  ],
  checks: [
    '(slotsValid 0 (project release targetedCount) criteria)',
    '(readingsCover 0 0 (project release configurationCount) (pagesTotal pages) readings)',
    '(outcomesCover 0 0 (project release targetedCount) (pagesTotal pages) criteria outcomes)',
    '(claimsAccounted openClaims outcomes)',
    ...KINDS.map((k) => `((${k}Outcomes outcomes) =? (project release ${k}Count))`),
    '(clausesOrdered 0 criteria clauses)',
    '((enRequiringClauses clauses) =? (project release enRequiredCount))',
    '((enRequiredCriteria criteria) =? (project release enRequiredCount))',
  ],
};
// sameKind is the equality of outcome kinds, one branch per pair, so no kind is ever defaulted.
const sameKindDefs = [
  ...KINDS.map((k) => def(`sameAs${k[0].toUpperCase()}${k.slice(1)}`, ['value : OutcomeKind'], 'Bool', match('value', KINDS.map((x) => [`OutcomeKind.${camel(x)}`, x === k ? 'true' : 'false'])))),
  def('sameKind', ['left : OutcomeKind', 'right : OutcomeKind'], 'Bool', match('left', KINDS.map((k) => [`OutcomeKind.${camel(k)}`, `(sameAs${k[0].toUpperCase()}${k.slice(1)} right)`]))),
];
decl.definitions.splice(decl.definitions.findIndex((d) => d.includes('name: claimNames')), 0, ...sameKindDefs);

// A string is written as LexLean reads it: no percent sign, and brackets only where they balance.
const balanced = (s) => {
  const open = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const ch of s) {
    if ('([{'.includes(ch)) stack.push(ch);
    else if (open[ch]) { if (stack.pop() !== open[ch]) return false; }
  }
  return stack.length === 0;
};
const safe = (s) => {
  const t = String(s).replace(/%/g, ' per cent');
  return balanced(t) ? t : t.replace(/[()[\]{}]/g, ' ');
};
const short = (o) => [...o.rules.violated, ...o.rules.incomplete].join(' ');
const pageOf = new Map(r.pages.map((x) => [x.index, x.url]));
const records = {
  criteria: r.criteria.map((c) => ({ num: c.num, handle: safe(c.handle), level: c.level === 'obsolete' ? 'obsolete' : `level${c.level}`, in21: c.in21, in22: c.in22, targeted: c.targeted, slot: c.slot, axeRules: c.axeRules.length })),
  requirements: r.requirements.map((x) => ({ key: x.id, title: safe(x.title) })),
  rules: r.rules.map((x) => ({ name: x.id, mappedTo: x.criteria.join(' '), mapped: x.criteria.length })),
  pages: r.pages.map((x) => ({ url: x.url, service: x.service, discovery: x.discovery, route: x.route, readingsRan: x.ran })),
  readings: r.pages.flatMap((x) => x.readings.map((g, slot) => ({
    page: x.index, slot, viewport: g.viewport, scheme: g.scheme, status: g.status, ran: g.ran, fetchedAt: g.fetchedAt, digest: g.sha256 ? `sha256:${g.sha256}` : '',
    violations: g.violations, incomplete: g.incomplete, passes: g.passes, inapplicable: g.inapplicable,
  }))),
  outcomes: r.outcomes.map((o) => ({
    page: o.page, criterion: o.criterion, slot: o.slot, result: o.outcome, rulesMapped: r.criteria[o.criterion].axeRules.length,
    violated: o.rules.violated.length, incomplete: o.rules.incomplete.length, passed: o.rules.passed.length, inapplicable: o.rules.inapplicable.length, notRun: o.rules.notRun.length, ruleNames: short(o),
  })),
  // The catalog names each claim by its criterion, page and rules; register.json keeps the selectors.
  openClaims: r.openClaims.map((c) => {
    const o = r.outcomes[c.outcome];
    const crit = r.criteria[o.criterion];
    return { outcome: c.outcome, kind: c.kind, detail: safe(`${crit.num} ${crit.handle} on ${pageOf.get(o.page)}: ${c.kind}${short(o) ? ` by ${short(o)}` : ''}`) };
  }),
  refusals: r.refusals.map((x) => ({ name: x.kind, page: x.page >= 0 ? pageOf.get(x.page) : '', detail: safe(x.detail) })),
  clauses: r.en301549Clauses.map((c) => ({ clause: c.clause, title: safe(c.title), void: c.void, criterion: c.criterion })),
  exclusions: r.exclusions.map((x) => ({ service: x.service, url: x.url, reason: x.reason })),
};
const release = {
  wcagRecommendation: r.wcag.recommendation,
  wcagCommit: r.wcag.criteria.path.split(':')[0],
  criteriaDigest: `${r.wcag.criteria.path}#sha256:${r.wcag.criteria.sha256}`,
  conformanceDigest: `${r.wcag.conformance.path}#sha256:${r.wcag.conformance.sha256}`,
  aaaNote: safe(r.wcag.aaaNote),
  websiteRoutes: r.website.path,
  routesDigest: `sha256:${r.website.sha256}`,
  inventoryDigest: `${r.inventory.path}#sha256:${r.inventory.sha256}`,
  snapshotDigest: `sha256:${r.snapshot.sha256}`,
  takenAt: r.snapshot.takenAt,
  sitemapDigest: `${r.sitemap.url}#sha256:${r.sitemap.sha256}`,
  axeVersion: r.tools['axe-core'].version,
  axeIntegrity: r.tools['axe-core'].integrity,
  axeScript: r.tools['axe-core'].script,
  playwright: r.tools.playwright,
  browser: r.tools.browser,
  enUrl: r.en301549.url,
  enDigest: `sha256:${r.en301549.sha256}`,
  enFetchedAt: r.en301549.fetchedAt,
  pdftotext: r.en301549.pdftotext,
  targetedCount: r.counts.targeted,
  configurationCount: r.configurations.length,
  enRequiredCount: r.en301549Clauses.filter((c) => !c.void).length,
  ...Object.fromEntries(KINDS.map((k) => [`${k}Count`, r.counts.outcomes[k]])),
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Accessibility/V1/Model.lex.tex', typesModule(decl)],
  ['src/Accessibility.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/accessibility-model.toml', entry('accessibility-model', 'Accessibility model', M, 'registerValid')],
  ['language/prism.arch/entries/accessibility-register.toml', entry('accessibility-register', 'Accessibility register', 'Accessibility', 'registerValidHolds')],
];
for (const [path, text] of outputs) {
  if (/%/.test(text)) throw new Error(`app/${path} would carry a raw percent sign`);
  let depth = 0;
  for (const ch of text.replace(/"(?:[^"\\]|\\.)*"/g, '""')) { if (ch === '(') depth++; else if (ch === ')') depth--; if (depth < 0) break; }
  if (depth !== 0) throw new Error(`app/${path} has unbalanced parentheses`);
}
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of accessibility/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
process.stdout.write(`${records.criteria.length} criteria, ${records.pages.length} pages, ${records.readings.length} readings, ${records.outcomes.length} outcomes, ${records.openClaims.length} open claims, ${records.refusals.length} refusals, ${records.clauses.length} EN 301 549 clauses\n`);
