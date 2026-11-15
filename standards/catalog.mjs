#!/usr/bin/env node
/**
 * Write the Foundation.Standards.V1 facet from standards/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Standards/V1/Model.lex.tex  its types, whose outcomes and
 *     field values are the uor-standard-applicability app's own, the app's
 *     first-hit table as a function generated from the prompt's rules, and
 *     registerValid;
 *   app/src/Standards.lex.tex  every facet, check, part, standard, decided pair,
 *     open claim and unread scope, and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid holds when every pair's outcome is the one the app's table
 * gives its inputs; pairs are ordered by part and standard, so no pair is
 * decided twice; every part has at least one applicable standard; every
 * applicable pair has exactly one status and every other pair none; every
 * implemented pair names a facet that exists and a check of that facet; every
 * pair that is undecided or applicable but not implemented is exactly one open
 * claim, in order, carrying the pair's owner; a pair the security facet owns
 * carries owner security; and the status counts reconcile with the release.
 * Every walk is linear in the register's size.
 *
 *   node standards/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel, pascal } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const prompt = JSON.parse(readFileSync(join(here, '..', r.app.path), 'utf8'));
const M = 'Foundation.Standards.V1.Model';
const app = prompt.app;
const field = (name) => app.fields.find((f) => f.name === name).values;

// Each enumeration is the app's own vocabulary; Status adds the word for a pair that does not apply.
const enums = {
  Owner: field('owner'),
  Scope: field('scope'),
  YesNo: field('inscope'),
  Force: field('force'),
  Jurisdiction: field('jurisdiction'),
  Activity: field('activity'),
  Outcome: app.outcomes,
  Status: ['implemented', 'partial', 'unimplemented', 'unrated'],
};
if (field('adopted').join() !== enums.YesNo.join()) throw new Error('adopted and inscope must share one yes/no vocabulary');
for (const [name, values] of Object.entries(enums)) {
  if (new Set(values.map(camel)).size !== values.length) throw new Error(`${name} has a repeated constructor`);
}
const ENUM_OF = { owner: 'Owner', scope: 'Scope', inscope: 'YesNo', force: 'Force', jurisdiction: 'Jurisdiction', activity: 'Activity', adopted: 'YesNo' };
const APPLICABLE = new Set(['secured', 'conditional', 'mandatory', 'adopted', 'applicable']);

// One branch per constructor, so a new word is decided, never defaulted.
const is = (type, v) => `${camel(type)}Is${pascal(v)}`;
const predicates = Object.entries(enums).flatMap(([type, values]) => values.map((v) =>
  def(is(type, v), [`value : ${type}`], 'Bool', match('value', values.map((w) => [`${type}.${camel(w)}`, w === v ? 'true' : 'false'])))));
const code = (type) => def(`${camel(type)}Code`, [`value : ${type}`], 'Nat', match('value', enums[type].map((w, i) => [`${type}.${camel(w)}`, String(i)])));
// The app's table: each rule a conjunction of field predicates, tried in order, the first that holds answering.
const PARAMS = app.fields.map((f) => `${camel(f.name)} : ${ENUM_OF[f.name]}`);
const ruleBody = (rule) => rule.when.map((c) => `(${is(ENUM_OF[c.field], c.value)} ${camel(c.field)})`).reduceRight((rest, x) => (rest === null ? x : `(${x} && ${rest})`), null);
const table = app.rules.reduceRight((rest, rule) => `(if ${ruleBody(rule)} then ${app.outcomes.indexOf(rule.then)} else ${rest})`, String(app.outcomes.indexOf(app.otherwise)));
const applicableOutcome = def('outcomeApplicable', ['value : Outcome'], 'Bool', match('value', enums.Outcome.map((w) => [`Outcome.${camel(w)}`, APPLICABLE.has(w) ? 'true' : 'false'])));

const decl = {
  module: M,
  title: 'Standards model',
  catalog: 'Standards',
  catalogTitle: 'Standards register',
  enums,
  kinds: [
    { name: 'Facet', list: 'facets', fields: [['identifier', 'String'], ['directory', 'String'], ['present', 'Bool'], ['commit', 'String'], ['checkName', 'String']] },
    { name: 'Check', list: 'checks', fields: [['facet', { ref: 'Facet' }], ['name', 'String']] },
    { name: 'Part', list: 'parts', fields: [['identifier', 'String'], ['name', 'String'], ['kind', 'String'], ['facet', { ref: 'Facet' }]] },
    { name: 'Standard', list: 'standards', fields: [['identifier', 'String'], ['name', 'String'], ['issuer', 'String'], ['edition', 'String'], ['force', { enum: 'Force' }], ['owner', { enum: 'Owner' }], ['scope', { enum: 'Scope' }], ['url', 'String'], ['digest', 'String'], ['fetchedAt', 'String'], ['quote', 'String'], ['clauses', 'Nat']] },
    {
      name: 'Decision',
      list: 'decisions',
      fields: [
        ['part', { ref: 'Part' }], ['standard', { ref: 'Standard' }],
        ...app.fields.map((f) => [camel(f.name), { enum: ENUM_OF[f.name] }]),
        ['outcome', { enum: 'Outcome' }], ['rule', 'Nat'], ['status', { enum: 'Status' }], ['facet', { ref: 'Facet' }], ['check', { ref: 'Check' }],
      ],
      checks: [
        `((outcomeCode (project $ outcome)) =? (decideApplicability ${app.fields.map((f) => `(project $ ${camel(f.name)})`).join(' ')}))`,
        '(agree (outcomeApplicable (project $ outcome)) (not (statusIsUnrated (project $ status))))',
        '(if (outcomeIsSecured (project $ outcome)) then (ownerIsSecurity (project $ owner)) else true)',
        '(if (statusIsImplemented (project $ status)) then (0 <? (project $ check)) else true)',
      ],
    },
    { name: 'OpenClaim', list: 'openClaims', fields: [['decision', { ref: 'Decision' }], ['owner', { enum: 'Owner' }], ['refusal', 'String'], ['detail', 'String']] },
    { name: 'ScopeClaim', list: 'scopeClaims', fields: [['standard', { ref: 'Standard' }], ['refusal', 'String'], ['detail', 'String']] },
  ],
  release: [
    ['inputs', 'String'], ['app', 'String'], ['security', 'String'],
    ['implementedCount', 'Nat'], ['partialCount', 'Nat'], ['unimplementedCount', 'Nat'], ['applicableCount', 'Nat'],
  ],
  definitions: [
    ...predicates,
    code('Outcome'), code('Owner'), code('Status'),
    applicableOutcome,
    def('agree', ['left : Bool', 'right : Bool'], 'Bool', '(if left then right else (not right))'),
    def('decideApplicability', PARAMS, 'Nat', table),
    def('needsClaim', ['decision : Decision'], 'Bool', '((outcomeIsUndecided (project decision outcome)) || ((outcomeApplicable (project decision outcome)) && (not (statusIsImplemented (project decision status)))))'),
    // Pairs strictly ordered by part, then by standard: no pair is decided twice.
    def('decisionsOrdered', ['values : (List Decision)', 'current : Nat', 'low : Nat'], 'Bool', match('values', [['List.nil', 'true'],
      ['List.cons decision rest', '((((current <? (project decision part)) || (((project decision part) =? current) && (low <? ((project decision standard) + 1)))) && (decisionsOrdered rest (project decision part) ((project decision standard) + 1)))']]), 'values'),
    // Walking the ordered pairs, every part from 0 to the last appears and has an applicable standard.
    def('partsCovered', ['values : (List Decision)', 'current : Nat', 'seen : Bool', 'total : Nat'], 'Bool', match('values', [['List.nil', '(seen && ((current + 1) =? total))'],
      ['List.cons decision rest', '(if ((project decision part) =? current) then (partsCovered rest current (seen || (outcomeApplicable (project decision outcome))) total) else (seen && (((project decision part) =? (current + 1)) && (partsCovered rest (project decision part) (outcomeApplicable (project decision outcome)) total))))']]), 'values'),
    def('claimHeadIs', ['claimList : (List OpenClaim)', 'at : Nat', 'owner : Nat'], 'Bool', match('claimList', [['List.nil', 'false'], ['List.cons claim rest', '(((project claim decision) =? at) && ((ownerCode (project claim owner)) =? owner))']])),
    def('claimTail', ['claimList : (List OpenClaim)'], '(List OpenClaim)', match('claimList', [['List.nil', 'claimList'], ['List.cons claim rest', 'rest']])),
    def('claimsEmpty', ['claimList : (List OpenClaim)'], 'Bool', match('claimList', [['List.nil', 'true'], ['List.cons claim rest', 'false']])),
    // The open claims are exactly the pairs that need one, in the pairs' order, each carrying its pair's owner.
    def('claimsMatch', ['claimList : (List OpenClaim)', 'values : (List Decision)'], 'Bool', match('values', [['List.nil', '(claimsEmpty claimList)'],
      ['List.cons decision rest', '(if (needsClaim decision) then ((claimHeadIs claimList (project decision index) (ownerCode (project decision owner))) && (claimsMatch (claimTail claimList) rest)) else (claimsMatch claimList rest))']]), 'values'),
    def('facetPresentAt', ['values : (List Facet)', 'at : Nat'], 'Bool', match('values', [['List.nil', 'false'], ['List.cons facet rest', '(if ((project facet index) =? at) then (project facet present) else (facetPresentAt rest at))']]), 'values'),
    def('checkFacetAt', ['values : (List Check)', 'at : Nat'], 'Nat', match('values', [['List.nil', '0'], ['List.cons check rest', '(if ((project check index) =? at) then (project check facet) else (checkFacetAt rest at))']]), 'values'),
    // An implemented pair names a facet that exists and a check that belongs to that facet.
    def('implementedFaceted', ['allFacets : (List Facet)', 'allChecks : (List Check)', 'values : (List Decision)'], 'Bool', match('values', [['List.nil', 'true'],
      ['List.cons decision rest', '((if (statusIsImplemented (project decision status)) then ((facetPresentAt allFacets (project decision facet)) && ((checkFacetAt allChecks (project decision check)) =? (project decision facet))) else true) && (implementedFaceted allFacets allChecks rest))']]), 'values'),
    def('statusTotal', ['values : (List Decision)', 'wanted : Nat'], 'Nat', match('values', [['List.nil', '0'], ['List.cons decision rest', '((if ((statusCode (project decision status)) =? wanted) then 1 else 0) + (statusTotal rest wanted))']]), 'values'),
    def('applicableTotal', ['values : (List Decision)'], 'Nat', match('values', [['List.nil', '0'], ['List.cons decision rest', '((if (outcomeApplicable (project decision outcome)) then 1 else 0) + (applicableTotal rest))']]), 'values'),
  ],
  checks: [
    '(decisionsOrdered decisions 0 0)',
    '(partsCovered decisions 0 false (partsTotal parts))',
    '(claimsMatch openClaims decisions)',
    '(implementedFaceted facets checks decisions)',
    `((statusTotal decisions ${enums.Status.indexOf('implemented')}) =? (project release implementedCount))`,
    `((statusTotal decisions ${enums.Status.indexOf('partial')}) =? (project release partialCount))`,
    `((statusTotal decisions ${enums.Status.indexOf('unimplemented')}) =? (project release unimplementedCount))`,
    '((applicableTotal decisions) =? (project release applicableCount))',
  ],
};

const records = {
  facets: r.facets.map((f) => ({ identifier: f.id, directory: f.directory, present: f.present, commit: f.commit, checkName: f.check })),
  checks: r.checks,
  parts: r.parts.map((p) => ({ identifier: p.id, name: p.name, kind: p.kind, facet: r.facets.findIndex((f) => f.id === p.facets[0]) })),
  standards: r.standards.map((s) => ({ identifier: s.id, name: s.name, issuer: s.issuer, edition: s.edition, force: s.force, owner: s.owner, scope: s.scope, url: s.url, digest: s.sha256 ? `sha256:${s.sha256}` : '', fetchedAt: s.fetchedAt, quote: s.quote, clauses: s.clauses.length })),
  decisions: r.decisions,
  openClaims: r.openClaims.map((c) => ({ decision: c.decision, owner: c.owner, refusal: c.refusal, detail: c.detail })),
  scopeClaims: r.refusals.map((c) => ({ standard: c.standard, refusal: c.refusal, detail: c.detail })),
};
const release = {
  inputs: r.inputs.map((i) => `${i.path}#sha256:${i.sha256}`).join(' '),
  app: r.app.path,
  security: `${r.security.url}#sha256:${r.security.sha256}`,
  implementedCount: r.counts.byStatus.implemented,
  partialCount: r.counts.byStatus.partial,
  unimplementedCount: r.counts.byStatus.unimplemented,
  applicableCount: r.counts.applicable,
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const appDir = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Standards/V1/Model.lex.tex', typesModule(decl)],
  ['src/Standards.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/standards-model.toml', entry('standards-model', 'Standards model', M, 'registerValid')],
  ['language/prism.arch/entries/standards-register.toml', entry('standards-register', 'Standards register', 'Standards', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(appDir, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`app/${path} is not the catalog of standards/register.json\n`); stale = true; }
  } else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); }
}
if (stale) process.exit(1);
process.stdout.write(decl.kinds.map((k) => `${records[k.list].length} ${k.list}`).join(', ') + '\n');
