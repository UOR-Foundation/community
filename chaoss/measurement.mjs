#!/usr/bin/env node
/**
 * Map every CHAOSS metric and metrics model in chaoss/register.json onto the
 * ISO/IEC 15939 measurement information model, Foundation.Measurement.V1.
 *
 * The mapping is a crosswalk between two published templates, declared once
 * below: a 15939 element is stated only where the CHAOSS metric or metrics
 * model template has a section that carries it, and the stated element cites
 * that section of the pinned working-group file by its sha256. A 15939 element
 * the CHAOSS template has no section for, or a section a definition lacks,
 * repeats, or leaves empty, is a typed open claim. Nothing is inferred from
 * prose.
 *
 *   node chaoss/measurement.mjs <checkouts-dir> [--check]   project chaoss/measurement.json, then write the modules
 *   node chaoss/measurement.mjs [--check]                   write the modules from chaoss/measurement.json
 *
 * Writes app/src/Foundation/Community/V1/Measurement.lex.tex (the mapping
 * types and their validity), app/src/Measures.lex.tex (the mapping, its
 * 15939 records and the theorem measuresValidHolds), and the two lexicon
 * entries that title them. The same inputs always write the same bytes.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const root = args.find((a) => a !== '--check');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ISO/IEC 15939:2017 clause 3 and Annex A, the measurement information model.
// The plan is the elements one CHAOSS item must map, in order. A metric is a
// base-measure chain (need, concept, entity, attribute, method, scale, unit); a
// metrics model is an indicator chain over its member metrics (need, concept,
// base measures, measurement function, analysis model, decision criteria).
const ELEMENTS = ['informationNeed', 'measurableConcept', 'entity', 'attribute', 'measurementMethod', 'scale', 'unit', 'baseMeasures', 'measurementFunction', 'analysisModel', 'decisionCriteria'];
const PLAN = {
  metric: ['informationNeed', 'measurableConcept', 'entity', 'attribute', 'measurementMethod', 'scale', 'unit'],
  model: ['informationNeed', 'measurableConcept', 'baseMeasures', 'measurementFunction', 'analysisModel', 'decisionCriteria'],
};
// The crosswalk: the CHAOSS template section that carries each element. The
// metric template is chaoss/wg-metrics-development's; the metrics model
// template is chaoss/wg-metrics-models'. An element absent here has no CHAOSS
// template section, so it is open for every item until an oracle states it.
const CROSSWALK = {
  metric: {
    informationNeed: ['question'],
    measurableConcept: ['overview', 'description'],
    measurementMethod: ['data collection strategies'],
  },
  model: {
    informationNeed: ['why it matters'],
    measurableConcept: ['what we want to measure'],
    baseMeasures: ['metrics in the metrics model'],
    analysisModel: ['insights drawn from the metrics model', 'insights drawn from metrics model'],
  },
};

const heading = (s) => s.replace(/[#*`]/g, '').replace(/\((?:optional)\)|:$/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The sections of a definition: each heading's text up to the next heading at its level or above. */
function sections(text) {
  const lines = text.split('\n');
  const heads = [];
  lines.forEach((l, i) => { const h = l.match(/^(#{1,6})\s+(.+?)\s*$/); if (h) heads.push({ i, level: h[1].length, name: heading(h[2]) }); });
  return heads.map((h, k) => {
    const end = heads.slice(k + 1).find((n) => n.level <= h.level);
    const body = lines.slice(h.i, end ? end.i : lines.length).join('\n');
    return { name: h.name, body, empty: lines.slice(h.i + 1, end ? end.i : lines.length).join('').trim() === '' };
  });
}

function project(r) {
  const files = new Map();
  const file = (source) => {
    if (!files.has(source)) {
      const [, name, commit, path] = source.match(/^([^@]+)@([0-9a-f]{40}):(.+)$/);
      const dir = join(root, name);
      const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim();
      const at = head.startsWith('ref:') ? readFileSync(join(dir, '.git', head.slice(5)), 'utf8').trim() : head;
      if (at !== commit) throw new Error(`${name} is at ${at}, not the pinned ${commit}`);
      const bytes = readFileSync(join(dir, path));
      files.set(source, { sha: sha256(bytes), text: bytes.toString('utf8').replace(/\r\n/g, '\n') });
    }
    return files.get(source);
  };
  const map = (kind, item) => {
    const f = file(item.source);
    if (f.sha !== item.sha256) throw new Error(`${item.source} does not hash to the register's ${item.sha256}`);
    const secs = sections(f.text);
    return PLAN[kind].map((element) => {
      const names = CROSSWALK[kind][element];
      if (!names) return { element, status: 'open', reason: 'no-template-section' };
      if (names[0] === 'question') {
        const q = f.text.match(/^\s*\**Question:?\**:?\s*(.+?)\s*$/im);
        if (!q) return { element, status: 'open', reason: 'section-absent' };
        if (/^to be added\.?$/i.test(q[1])) return { element, status: 'open', reason: 'section-empty' };
        return { element, status: 'stated', source: `${item.source}#question`, digest: sha256(q[0].trim()) };
      }
      const hit = secs.filter((s) => names.includes(s.name));
      if (hit.length === 0) return { element, status: 'open', reason: 'section-absent' };
      if (hit.length > 1) return { element, status: 'open', reason: 'section-ambiguous' };
      if (hit[0].empty) return { element, status: 'open', reason: 'section-empty' };
      return { element, status: 'stated', source: `${item.source}#${hit[0].name.replace(/[^a-z0-9]+/g, '-')}`, digest: sha256(hit[0].body) };
    });
  };
  const items = [
    ...r.metrics.map((m) => ({ slug: m.slug, kind: 'metric', title: m.title, question: m.question, entries: map('metric', m) })),
    ...r.models.map((m) => ({ slug: m.slug, kind: 'model', title: m.title, question: '', entries: map('model', m) })),
  ].map((x, index) => ({ index, ...x }));
  const all = items.flatMap((x) => x.entries);
  return {
    spec: 'uor-community/chaoss-measurement/1',
    standard: 'ISO/IEC 15939:2017',
    register: sha256(readFileSync(join(here, 'register.json'))),
    plan: PLAN,
    crosswalk: CROSSWALK,
    counts: { metrics: r.metrics.length, models: r.models.length, stated: all.filter((e) => e.status === 'stated').length, open: all.filter((e) => e.status === 'open').length },
    items,
  };
}

const outputs = new Map();
const jsonPath = join(here, 'measurement.json');
if (root) outputs.set(jsonPath, JSON.stringify(project(JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'))), null, 1) + '\n');
const m = JSON.parse(outputs.get(jsonPath) ?? readFileSync(jsonPath, 'utf8'));
if (m.register !== sha256(readFileSync(join(here, 'register.json')))) throw new Error('chaoss/measurement.json was projected from another register; rerun with the checkouts');

// ---- The facet: the mapping types and their validity. ----
const F = 'Foundation.Community.V1.Measurement';
const S = 'Foundation.Measurement.V1.Model';
const paramList = (params) => (`  parameters: [${params}],`.length > 100 ? `[\n    ${params.split(', ').join(',\n    ')}\n  ]` : `[${params}]`);
const def = (name, params, type, body, rec) => `definition{\n  name: ${name},\n  parameters: ${paramList(params)},\n  result: ${type},\n  body: ${body}${rec ? `,\n  recursive_argument: ${rec}` : ''}\n}\n`;
const rank = (kind) => `(match element\n    ${ELEMENTS.map((e) => `| Element.${e} => ${PLAN[kind].includes(e) ? PLAN[kind].indexOf(e) : 99}`).join('\n    ')})`;
const total = (name, type) => def(name, `rows : (List ${type})`, 'Nat', `(match rows | List.nil => 0 | List.cons row rest => (1 + (${name} rest)))`, 'rows');
const facet = [
  `\\begin{lexlean}{${F}}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\useglossary{prism.arch@1.0.0}\n\\importmodule{${S}}\n\\title{Measurement mapping model}\n\\begin{semanticmodule}`,
  `inductive{\n  name: Element,\n  type_parameters: [],\n  parameters: [],\n  constructors: [\n${ELEMENTS.map((e) => `    {name: ${e}, fields: []}`).join(',\n')}\n  ]\n}\n`,
  `structure{\n  name: Mapping,\n  type_parameters: [],\n  parameters: [],\n  fields: [\n    {name: element, type: Element},\n    {name: stated, type: Bool},\n    {name: source, type: String},\n    {name: evidence, type: String}\n  ]\n}\n`,
  `structure{\n  name: Item,\n  type_parameters: [],\n  parameters: [],\n  fields: [\n    {name: index, type: Nat},\n    {name: slug, type: String},\n    {name: entries, type: (List Mapping)}\n  ]\n}\n`,
  `structure{\n  name: Summary,\n  type_parameters: [],\n  parameters: [],\n  fields: [\n    {name: standard, type: String},\n    {name: register, type: String},\n    {name: statedCount, type: Nat},\n    {name: openCount, type: Nat}\n  ]\n}\n`,
  def('metricRank', 'element : Element', 'Nat', rank('metric')),
  def('modelRank', 'element : Element', 'Nat', rank('model')),
  def('metricPlanned', 'position : Nat, entries : (List Mapping)', 'Bool', `(match entries\n    | List.nil => (position =? ${PLAN.metric.length})\n    | List.cons entry rest => (((metricRank (project entry element)) =? position) && (metricPlanned (position + 1) rest)))`, 'entries'),
  def('modelPlanned', 'position : Nat, entries : (List Mapping)', 'Bool', `(match entries\n    | List.nil => (position =? ${PLAN.model.length})\n    | List.cons entry rest => (((modelRank (project entry element)) =? position) && (modelPlanned (position + 1) rest)))`, 'entries'),
  def('itemsPlanned', 'position : Nat, metricCount : Nat, items : (List Item)', 'Bool', `(match items\n    | List.nil => true\n    | List.cons item rest => (((project item index) =? position) && ((if (position <? metricCount) then (metricPlanned 0 (project item entries)) else (modelPlanned 0 (project item entries))) && (itemsPlanned (position + 1) metricCount rest))))`, 'items'),
  def('statedIn', 'entries : (List Mapping)', 'Nat', `(match entries\n    | List.nil => 0\n    | List.cons entry rest => ((if (project entry stated) then 1 else 0) + (statedIn rest)))`, 'entries'),
  def('entriesIn', 'entries : (List Mapping)', 'Nat', `(match entries | List.nil => 0 | List.cons entry rest => (1 + (entriesIn rest)))`, 'entries'),
  def('statedTotal', 'items : (List Item)', 'Nat', `(match items\n    | List.nil => 0\n    | List.cons item rest => ((statedIn (project item entries)) + (statedTotal rest)))`, 'items'),
  def('entryTotal', 'items : (List Item)', 'Nat', `(match items\n    | List.nil => 0\n    | List.cons item rest => ((entriesIn (project item entries)) + (entryTotal rest)))`, 'items'),
  total('itemTotal', 'Item'),
  total('needTotal', `${S}::InformationNeed`),
  def('needsNumbered', `position : Nat, needs : (List ${S}::InformationNeed)`, 'Bool', `(match needs\n    | List.nil => true\n    | List.cons need rest => (((project need index) =? position) && (needsNumbered (position + 1) rest)))`, 'needs'),
  def('conceptsNumbered', `position : Nat, needCount : Nat, concepts : (List ${S}::MeasurableConcept)`, 'Bool', `(match concepts\n    | List.nil => true\n    | List.cons concept rest => (((project concept index) =? position) && (((project concept informationNeedIndex) <? needCount) && (conceptsNumbered (position + 1) needCount rest))))`, 'concepts'),
  def('mappingValid', `metricCount : Nat, modelCount : Nat, summary : Summary, items : (List Item), needs : (List ${S}::InformationNeed), concepts : (List ${S}::MeasurableConcept)`, 'Bool',
    `(((itemTotal items) =? (metricCount + modelCount)) && ((itemsPlanned 0 metricCount items) && (((statedTotal items) =? (project summary statedCount)) && (((entryTotal items) =? ((project summary statedCount) + (project summary openCount))) && ((needsNumbered 0 needs) && (conceptsNumbered 0 (needTotal needs) concepts))))))`).trimEnd(),
  '\\end{semanticmodule}\n\\end{lexlean}\n',
].join('\n');

// ---- The mapping of the register, and the 15939 records it supports. ----
const str = (s) => JSON.stringify(String(s));
const list = (type, names) => names.reduceRight((rest, n) => `(cons (${n}) ${rest})`, `(nil ${type})`);
const pascal = (s) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const body = [];
body.push(`\\begin{lexlean}{Measures}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\useglossary{prism.arch@1.0.0}\n\\importmodule{Chaoss}\n\\importmodule{Foundation.Community.V1.Model}\n\\importmodule{${S}}\n\\importmodule{${F}}\n\\title{CHAOSS measures}\n\\begin{semanticmodule}`);
body.push(def('summary', '', `${F}::Summary`, `(record ${F}::Summary {standard := ${str(m.standard)}, register := ${str('sha256:' + m.register)}, statedCount := ${m.counts.stated}, openCount := ${m.counts.open}})`));
const itemNames = m.items.map((x) => {
  const name = `measure${pascal(x.kind)}${pascal(x.slug.replace(/^metrics?-model-/, '').replace(/^metric-/, ''))}`;
  const entries = x.entries.map((e) => `(record ${F}::Mapping {element := (ctor ${F}::Element.${e.element}), stated := ${e.status === 'stated'}, source := ${str(e.source ?? '')}, evidence := ${str(e.status === 'stated' ? 'sha256:' + e.digest : e.reason)}})`);
  body.push(def(name, '', `${F}::Item`, `(record ${F}::Item {index := ${x.index}, slug := ${str(x.slug)}, entries := ${entries.reduceRight((rest, e) => `(cons ${e} ${rest})`, `(nil ${F}::Mapping)`)}})`));
  return name;
});
const needOf = new Map();
const needNames = [];
for (const x of m.items) {
  const e = x.entries.find((y) => y.element === 'informationNeed');
  if (e.status !== 'stated') continue;
  const name = `need${needNames.length}`;
  needOf.set(x.index, needNames.length);
  body.push(def(name, '', `${S}::InformationNeed`, `(record ${S}::InformationNeed {index := ${needNames.length}, name := ${str(x.title)}, text := ${str(x.kind === 'metric' ? x.question : e.source)}})`));
  needNames.push(name);
}
const conceptNames = [];
for (const x of m.items) {
  const e = x.entries.find((y) => y.element === 'measurableConcept');
  if (e.status !== 'stated' || !needOf.has(x.index)) continue;
  const name = `concept${conceptNames.length}`;
  body.push(def(name, '', `${S}::MeasurableConcept`, `(record ${S}::MeasurableConcept {index := ${conceptNames.length}, informationNeedIndex := ${needOf.get(x.index)}, name := ${str(x.title)}})`));
  conceptNames.push(name);
}
body.push(def('items', '', `(List ${F}::Item)`, list(`${F}::Item`, itemNames)));
body.push(def('needs', '', `(List ${S}::InformationNeed)`, list(`${S}::InformationNeed`, needNames)));
body.push(def('concepts', '', `(List ${S}::MeasurableConcept)`, list(`${S}::MeasurableConcept`, conceptNames)));
body.push(`theorem{\n  name: measuresValidHolds,\n  parameters: [],\n  statement: ((${F}::mappingValid (project (Chaoss::release) metricCount) (project (Chaoss::release) modelCount) (summary) (items) (needs) (concepts)) = true),\n  proof: decide{}\n}`);
body.push('\\end{semanticmodule}\n\\end{lexlean}\n');

const entry = (id, module, component, surface) => `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;
outputs.set(join(repo, 'app/src/Foundation/Community/V1/Measurement.lex.tex'), facet);
outputs.set(join(repo, 'app/src/Measures.lex.tex'), body.join('\n'));
outputs.set(join(repo, 'app/language/prism.arch/entries/measurement-mapping-model.toml'), entry('measurement-mapping-model', F, 'mappingValid', 'Measurement mapping model'));
outputs.set(join(repo, 'app/language/prism.arch/entries/chaoss-measures.toml'), entry('chaoss-measures', 'Measures', 'measuresValidHolds', 'CHAOSS measures'));

let stale = 0;
for (const [path, text] of outputs) {
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) { process.stderr.write(`${path.slice(repo.length + 1)} is not the measurement projection of chaoss/register.json\n`); stale++; }
  } else writeFileSync(path, text);
}
if (stale) process.exit(1);
process.stdout.write(`${m.items.length} items, ${m.counts.stated} elements stated, ${m.counts.open} open, ${needNames.length} information needs, ${conceptNames.length} measurable concepts\n`);
