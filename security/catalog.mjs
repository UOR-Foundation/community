#!/usr/bin/env node
/**
 * Write Foundation.Security.V1 from security/register.json: the type module
 * app/src/Foundation/Security/V1/Model.lex.tex and the catalog
 * app/src/SecurityRegister.lex.tex, closed by the theorem that the register is
 * valid. The declaration below is the whole of the model's shape; the LexLean
 * is written by tools/register-lex.mjs.
 *
 *   node security/catalog.mjs [--check]
 *
 * registerValid checks, besides every reference and count:
 * - every threat's overall likelihood is SP 800-30 Table G-5 of its initiation
 *   and adverse-impact likelihoods, and its risk is Table I-2 of that and its
 *   impact, with both tables as the register read them from the publication;
 * - a mitigated threat has a control and an accepted one has none, and each
 *   threat's controls and techniques are exactly its links;
 * - no technique a threat names is revoked or deprecated;
 * - an adversarial threat source, and only one, carries Table D-3 to D-5 levels;
 * - an implemented or partial control has evidence, exactly its links;
 * - every CSF 2.0 subcategory is achieved by a control or is a gap, never both;
 * - every element is open to exactly the STRIDE categories its kind is (STRIDE
 *   per element) and, when it carries personal data, to every LINDDUN
 *   category, and each one it is open to is answered by a threat or stated open.
 * Every walk is linear: links are sorted by their parent, so a parent's run is
 * read and dropped as the walk passes it.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));

// A run of `child` records whose `field` is `at` at the head of a list, counted and dropped.
const runs = (child, field, prefix) => [
  def(`${prefix}Run`, ['at : Nat', `values : (List ${child})`], 'Nat', match('values', [['List.nil', '0'], [`List.cons item rest`, `(if ((project item ${field}) =? at) then (1 + (${prefix}Run at rest)) else 0)`]]), 'values'),
  def(`${prefix}Rest`, ['at : Nat', `values : (List ${child})`], `(List ${child})`, match('values', [['List.nil', `(nil ${child})`], [`List.cons item rest`, `(if ((project item ${field}) =? at) then (${prefix}Rest at rest) else (cons item rest))`]]), 'values'),
  def(`${prefix}Empty`, [`values : (List ${child})`], 'Bool', match('values', [['List.nil', 'true'], ['List.cons item rest', 'false']])),
];
// Every parent's count field equals its run of children, in order, and no child is left over.
const counted = (name, parent, countField, child, prefix) => def(name, [`values : (List ${parent})`, `links : (List ${child})`], 'Bool', match('values', [
  ['List.nil', `(${prefix}Empty links)`],
  ['List.cons parent rest', `(((${prefix}Run (project parent index) links) =? (project parent ${countField})) && (${name} rest (${prefix}Rest (project parent index) links)))`],
]), 'values');
// A walk over the slots of every element, `last` + 1 categories each, in element order.
const slotWalk = (name, slot, last, fits) => def(name, ['pending : (List Element)', 'expected : Nat', `values : (List ${slot})`], 'Bool', match('values', [
  ['List.nil', '((elementsLeftEmpty pending) && (expected =? 0))'],
  ['List.cons slot rest', `((elementsLeftAny pending) && (((project slot element) =? (headIndex pending)) && (((project slot category) =? expected) && ((stateFits ${fits} (project slot state)) && (if (expected =? ${last}) then (${name} (elementsAfter pending) 0 rest) else (${name} pending (expected + 1) rest))))))`],
]), 'values');

const decl = {
  module: 'Foundation.Security.V1.Model',
  title: 'Security model',
  catalog: 'SecurityRegister',
  catalogTitle: 'Foundation security register',
  enums: {
    Catalog: ['attack', 'atlas'],
    SourceKind: ['adversarial', 'accidental', 'structural', 'environmental'],
    ElementKind: ['externalEntity', 'process', 'dataStore', 'dataFlow'],
    Response: ['mitigate', 'accept', 'avoid', 'share', 'transfer'],
    // OSCAL implementation-status, with `partial` spelled partlyImplemented because `partial` is a Lean keyword.
    Status: ['implemented', 'partlyImplemented', 'planned', 'alternative', 'notApplicable'],
    EvidenceKind: ['path', 'pinned', 'scorecard'],
    GapStatus: ['planned', 'notApplicable'],
    SlotState: ['notApplicable', 'answered', 'stated'],
  },
  release: [['assessed', 'String'], ['sources', 'String'], ['pdftotext', 'String']],
  kinds: [
    { name: 'CsfFunction', list: 'csfFunctions', fields: [['code', 'String'], ['name', 'String']] },
    { name: 'CsfCategory', list: 'csfCategories', fields: [['code', 'String'], ['name', 'String'], ['function', { ref: 'CsfFunction' }]] },
    { name: 'Subcategory', list: 'subcategories', fields: [['code', 'String'], ['text', 'String'], ['category', { ref: 'CsfCategory' }]] },
    { name: 'Cell', list: 'cells', fields: [['table', 'Nat'], ['row', 'Nat'], ['column', 'Nat'], ['level', 'Nat']], checks: ['((project $ row) <? 5)', '((project $ column) <? 5)', '((project $ level) <? 5)', '((project $ table) <? 2)', '(position =? (cellPosition (project $ table) (project $ row) (project $ column)))'] },
    { name: 'Technique', list: 'techniques', fields: [['code', 'String'], ['name', 'String'], ['catalog', { enum: 'Catalog' }], ['revoked', 'Bool'], ['deprecated', 'Bool']], checks: ['(not (project $ revoked))', '(not (project $ deprecated))'] },
    { name: 'ScorecardCheck', list: 'scorecardChecks', fields: [['name', 'String'], ['risk', 'String']] },
    { name: 'ThreatSource', list: 'threatSources', fields: [['code', 'String'], ['name', 'String'], ['sourceType', 'String'], ['kind', { enum: 'SourceKind' }], ['rated', 'Bool'], ['capability', 'Nat'], ['intent', 'Nat'], ['targeting', 'Nat']], checks: ['(sameBool (project $ rated) (sourceIsAdversarial (project $ kind)))', '((project $ capability) <? 5)', '((project $ intent) <? 5)', '((project $ targeting) <? 5)'] },
    { name: 'Element', list: 'elements', fields: [['code', 'String'], ['name', 'String'], ['kind', { enum: 'ElementKind' }], ['personal', 'Bool']] },
    { name: 'Control', list: 'controls', fields: [['code', 'String'], ['name', 'String'], ['status', { enum: 'Status' }], ['evidenceCount', 'Nat']], checks: ['((not (statusNeedsEvidence (project $ status))) || (0 <? (project $ evidenceCount)))'] },
    { name: 'Threat', list: 'threats', fields: [['code', 'String'], ['name', 'String'], ['source', { ref: 'ThreatSource' }], ['initiation', 'Nat'], ['adverse', 'Nat'], ['impact', 'Nat'], ['overall', 'Nat'], ['risk', 'Nat'], ['response', { enum: 'Response' }], ['controlCount', 'Nat'], ['techniqueCount', 'Nat']], checks: ['((project $ initiation) <? 5)', '((project $ adverse) <? 5)', '((project $ impact) <? 5)', '(responseFits (project $ response) (project $ controlCount))'] },
    { name: 'ThreatControl', list: 'threatControls', fields: [['threat', { ref: 'Threat' }], ['control', { ref: 'Control' }]] },
    { name: 'ThreatTechnique', list: 'threatTechniques', fields: [['threat', { ref: 'Threat' }], ['technique', { ref: 'Technique' }]] },
    { name: 'Evidence', list: 'evidence', fields: [['control', { ref: 'Control' }], ['kind', { enum: 'EvidenceKind' }], ['reference', 'String']] },
    { name: 'Outcome', list: 'outcomes', fields: [['control', { ref: 'Control' }], ['subcategory', { ref: 'Subcategory' }]] },
    { name: 'Gap', list: 'gaps', fields: [['subcategory', { ref: 'Subcategory' }], ['status', { enum: 'GapStatus' }], ['rationale', 'String']] },
    { name: 'StrideSlot', list: 'strideSlots', fields: [['element', { ref: 'Element' }], ['category', 'Nat'], ['state', { enum: 'SlotState' }], ['threat', { ref: 'Threat' }], ['rationale', 'String']] },
    { name: 'LinddunSlot', list: 'linddunSlots', fields: [['element', { ref: 'Element' }], ['category', 'Nat'], ['state', { enum: 'SlotState' }], ['threat', { ref: 'Threat' }], ['rationale', 'String']] },
    { name: 'Indicator', list: 'indicators', fields: [['code', 'String'], ['threat', { ref: 'Threat' }], ['source', 'String'], ['measure', 'String'], ['amount', 'Nat'], ['text', 'String']] },
    { name: 'OpenClaim', list: 'openClaims', fields: [['code', 'String'], ['subject', 'String'], ['detail', 'String']] },
  ],
  definitions: [
    def('sameBool', ['left : Bool', 'right : Bool'], 'Bool', '(if left then right else (not right))'),
    def('exactlyOne', ['left : Bool', 'right : Bool'], 'Bool', '(if left then (not right) else right)'),
    // Cell (table, row, column) sits at table * 25 + row * 5 + column, written as sums.
    def('cellPosition', ['table : Nat', 'row : Nat', 'column : Nat'], 'Nat', '((if (table =? 0) then 0 else 25) + ((row + (row + (row + (row + row)))) + column))'),
    def('sourceIsAdversarial', ['kind : SourceKind'], 'Bool', match('kind', [['SourceKind.adversarial', 'true'], ['SourceKind.accidental', 'false'], ['SourceKind.structural', 'false'], ['SourceKind.environmental', 'false']])),
    def('statusNeedsEvidence', ['status : Status'], 'Bool', match('status', [['Status.implemented', 'true'], ['Status.partlyImplemented', 'true'], ['Status.planned', 'false'], ['Status.alternative', 'false'], ['Status.notApplicable', 'false']])),
    def('responseFits', ['response : Response', 'count : Nat'], 'Bool', match('response', [['Response.mitigate', '(0 <? count)'], ['Response.accept', '(count =? 0)'], ['Response.avoid', 'true'], ['Response.share', '(0 <? count)'], ['Response.transfer', '(0 <? count)']])),
    def('cellLevel', ['table : (List Cell)', 'at : Nat'], 'Nat', match('table', [['List.nil', '5'], ['List.cons cell rest', '(if ((project cell index) =? at) then (project cell level) else (cellLevel rest at))']]), 'table'),
    // SP 800-30 Table G-5 is cells 0 to 24 (initiation by adverse-impact likelihood), Table I-2 cells 25 to 49 (overall likelihood by impact).
    def('threatsRated', ['table : (List Cell)', 'values : (List Threat)'], 'Bool', match('values', [['List.nil', 'true'], ['List.cons threat rest', '(((project threat overall) =? (cellLevel table (cellPosition 0 (project threat initiation) (project threat adverse)))) && (((project threat risk) =? (cellLevel table (cellPosition 1 (project threat overall) (project threat impact)))) && (threatsRated table rest)))']]), 'values'),
    ...runs('ThreatControl', 'threat', 'controlLink'),
    ...runs('ThreatTechnique', 'threat', 'techniqueLink'),
    ...runs('Evidence', 'control', 'evidenceLink'),
    ...runs('Outcome', 'subcategory', 'outcomeLink'),
    counted('threatsControlled', 'Threat', 'controlCount', 'ThreatControl', 'controlLink'),
    counted('threatsTechniqued', 'Threat', 'techniqueCount', 'ThreatTechnique', 'techniqueLink'),
    counted('controlsEvidenced', 'Control', 'evidenceCount', 'Evidence', 'evidenceLink'),
    def('gapAt', ['at : Nat', 'values : (List Gap)'], 'Bool', match('values', [['List.nil', 'false'], ['List.cons gap rest', '((project gap subcategory) =? at)']])),
    def('gapsAfter', ['at : Nat', 'values : (List Gap)'], '(List Gap)', match('values', [['List.nil', '(nil Gap)'], ['List.cons gap rest', '(if ((project gap subcategory) =? at) then rest else (cons gap rest))']])),
    def('gapsLeftEmpty', ['values : (List Gap)'], 'Bool', match('values', [['List.nil', 'true'], ['List.cons gap rest', 'false']])),
    def('subcategoriesAnswered', ['values : (List Subcategory)', 'links : (List Outcome)', 'stated : (List Gap)'], 'Bool', match('values', [
      ['List.nil', '((outcomeLinkEmpty links) && (gapsLeftEmpty stated))'],
      ['List.cons sub rest', '((exactlyOne (0 <? (outcomeLinkRun (project sub index) links)) (gapAt (project sub index) stated)) && (subcategoriesAnswered rest (outcomeLinkRest (project sub index) links) (gapsAfter (project sub index) stated)))'],
    ]), 'values'),
    def('elementsLeftEmpty', ['pending : (List Element)'], 'Bool', match('pending', [['List.nil', 'true'], ['List.cons item rest', 'false']])),
    def('elementsLeftAny', ['pending : (List Element)'], 'Bool', match('pending', [['List.nil', 'false'], ['List.cons item rest', 'true']])),
    def('headIndex', ['pending : (List Element)'], 'Nat', match('pending', [['List.nil', '0'], ['List.cons item rest', '(project item index)']])),
    def('headKind', ['pending : (List Element)'], 'ElementKind', match('pending', [['List.nil', '(ctor ElementKind.externalEntity)'], ['List.cons item rest', '(project item kind)']])),
    def('headPersonal', ['pending : (List Element)'], 'Bool', match('pending', [['List.nil', 'false'], ['List.cons item rest', '(project item personal)']])),
    def('elementsAfter', ['pending : (List Element)'], '(List Element)', match('pending', [['List.nil', '(nil Element)'], ['List.cons item rest', 'rest']])),
    // STRIDE per element: an external entity is open to spoofing and repudiation, a process to all six, a data
    // store to tampering, repudiation, information disclosure and denial of service, a data flow to tampering,
    // information disclosure and denial of service.
    def('strideApplies', ['kind : ElementKind', 'category : Nat'], 'Bool', match('kind', [['ElementKind.externalEntity', '((category =? 0) || (category =? 2))'], ['ElementKind.process', '(category <? 6)'], ['ElementKind.dataStore', '((0 <? category) && (category <? 5))'], ['ElementKind.dataFlow', '((category =? 1) || ((category =? 3) || (category =? 4)))']])),
    def('stateFits', ['applies : Bool', 'state : SlotState'], 'Bool', match('state', [['SlotState.notApplicable', '(not applies)'], ['SlotState.answered', 'applies'], ['SlotState.stated', 'applies']])),
    slotWalk('strideWalk', 'StrideSlot', 5, '(strideApplies (headKind pending) expected)'),
    slotWalk('linddunWalk', 'LinddunSlot', 6, '(headPersonal pending)'),
  ],
  checks: [
    '(threatsRated cells threats)',
    '(threatsControlled threats threatControls)',
    '(threatsTechniqued threats threatTechniques)',
    '(controlsEvidenced controls evidence)',
    '(subcategoriesAnswered subcategories outcomes gaps)',
    '(strideWalk elements 0 strideSlots)',
    '(linddunWalk elements 0 linddunSlots)',
    '((cellsTotal cells) =? 50)',
    '((subcategoriesTotal subcategories) =? 106)',
    '((csfCategoriesTotal csfCategories) =? 22)',
    '((csfFunctionsTotal csfFunctions) =? 6)',
  ],
};

const status = (s) => ({ 'not-applicable': 'notApplicable', partial: 'partlyImplemented' })[s] ?? s;
const sorted = (xs, key) => xs.slice().sort((a, b) => a[key] - b[key]);
const records = {
  csfFunctions: r.csf.functions.map((f) => ({ code: f.id, name: f.name })),
  csfCategories: r.csf.categories.map((c) => ({ code: c.id, name: c.name, function: c.function })),
  subcategories: r.csf.subcategories.map((s) => ({ code: s.id, text: s.text, category: s.category })),
  cells: [...r.tables.G5.map((c) => ({ ...c, table: 0 })), ...r.tables.I2.map((c) => ({ ...c, table: 1 }))],
  techniques: r.techniques.map((t) => ({ code: t.id, name: t.name, catalog: t.catalog, revoked: t.revoked, deprecated: t.deprecated })),
  scorecardChecks: r.scorecard,
  threatSources: r.sources.map((s) => ({ code: s.id, name: s.name, sourceType: s.type, kind: s.kind, rated: s.rated, capability: s.capability, intent: s.intent, targeting: s.targeting })),
  elements: r.elements.map((e) => ({ code: e.id, name: e.name, kind: e.kind, personal: e.personal })),
  controls: r.controls.map((c) => ({ code: c.id, name: c.name, status: status(c.status), evidenceCount: c.evidence.length })),
  threats: r.threats.map((t) => ({ code: t.id, name: t.name, source: t.source, initiation: t.initiation, adverse: t.adverse, impact: t.impact, overall: t.overall, risk: t.risk, response: t.response, controlCount: t.controls.length, techniqueCount: t.techniques.length })),
  threatControls: r.threats.flatMap((t, threat) => t.controls.map((control) => ({ threat, control }))),
  threatTechniques: r.threats.flatMap((t, threat) => t.techniques.map((technique) => ({ threat, technique }))),
  evidence: r.controls.flatMap((c, control) => c.evidence.map((e) => ({ control, kind: e.kind, reference: e.reference }))),
  outcomes: sorted(r.outcomes, 'subcategory'),
  gaps: r.gaps.map((g) => ({ ...g, status: status(g.status) })),
  strideSlots: r.strideSlots.map((s) => ({ ...s, state: s.state })),
  linddunSlots: r.linddunSlots,
  indicators: r.indicators.map((i) => ({ code: i.id, threat: i.threat, source: i.source, measure: i.measure, amount: i.value, text: i.text })),
  openClaims: r.openClaims.map((c) => ({ code: c.id, subject: c.subject, detail: c.detail })),
};
const releaseValues = {
  assessed: r.assessed,
  sources: [...r.standards.map((s) => `${s.name}#sha256:${s.sha256}`), ...r.repositories.map((x) => `${x.url}@${x.commit}`)].join(' '),
  pdftotext: r.tools.pdftotext,
};

const outputs = [
  [join(here, '..', 'app', 'src', 'Foundation', 'Security', 'V1', 'Model.lex.tex'), typesModule(decl)],
  [join(here, '..', 'app', 'src', 'SecurityRegister.lex.tex'), catalogModule(decl, records, releaseValues)],
];
let stale = false;
for (const [target, text] of outputs) {
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`${target} is not the catalog of security/register.json\n`); stale = true; }
  } else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); }
}
if (stale) process.exit(1);
process.stdout.write(decl.kinds.map((k) => `${records[k.list].length} ${k.list}`).join(', ') + '\n');
