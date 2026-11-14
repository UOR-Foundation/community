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
 * Writes, through tools/register-lex.mjs, app/src/Foundation/Community/V1/Measurement.lex.tex (the mapping
 * types and their validity) and app/src/MeasurementMapping.lex.tex (the mapping); then app/src/Measures.lex.tex (its
 * 15939 records and the theorem measuresValidHolds), and the three lexicon
 * entries that title them. The same inputs always write the same bytes.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel, str } from '../tools/register-lex.mjs';

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

// The elements the CHAOSS templates leave open but the CHAOSS oracle, GrimoireLab, computes: chaoss/oracle.mjs
// projects them from the oracle's pinned implementation, and they are stated here with its citation.
const oraclePath = join(here, 'oracle-methods.json');
const oracle = JSON.parse(readFileSync(oraclePath, 'utf8'));
if (oracle.measurement !== sha256(outputs.get(jsonPath) ?? readFileSync(jsonPath))) throw new Error('chaoss/oracle-methods.json was projected from another chaoss/measurement.json; rerun chaoss/oracle.mjs with the checkouts');
const byOracle = new Map(oracle.items.flatMap((x) => x.elements.filter((e) => e.status === 'resolved').map((e) => [`${x.index} ${e.element}`, e])));
const oracleCount = byOracle.size;

// ---- The mapping register, written by the shared register emitter. ----
const F = 'Foundation.Community.V1.Measurement';
const S = 'Foundation.Measurement.V1.Model';
const rank = (kind) => match('element', ELEMENTS.map((e) => [`Element.${camel(e)}`, String(PLAN[kind].includes(e) ? PLAN[kind].indexOf(e) : 99)]));
// The plan check: the mappings walk every item's plan once, in order, metrics first.
const planned = `(if ((project mapping item) =? item) then (if (item <? metricCount) then (((metricRank (project mapping element)) =? step) && (if ((step + 1) =? ${PLAN.metric.length}) then (planned metricCount itemCount (item + 1) 0 rest) else (planned metricCount itemCount item (step + 1) rest))) else (((modelRank (project mapping element)) =? step) && (if ((step + 1) =? ${PLAN.model.length}) then (planned metricCount itemCount (item + 1) 0 rest) else (planned metricCount itemCount item (step + 1) rest)))) else false)`;
const decl = {
  module: F,
  title: 'Measurement mapping model',
  catalog: 'MeasurementMapping',
  catalogTitle: 'Measurement mapping',
  enums: { Element: ELEMENTS },
  kinds: [
    { name: 'Item', list: 'items', fields: [['slug', 'String']] },
    { name: 'Mapping', list: 'mappings', fields: [['item', { ref: 'Item' }], ['element', { enum: 'Element' }], ['stated', 'Bool'], ['byOracle', 'Bool'], ['source', 'String'], ['evidence', 'String']] },
  ],
  release: [['metricCount', 'Nat'], ['statedCount', 'Nat'], ['oracleCount', 'Nat'], ['standard', 'String'], ['register', 'String']],
  definitions: [
    def('metricRank', ['element : Element'], 'Nat', rank('metric')),
    def('modelRank', ['element : Element'], 'Nat', rank('model')),
    def('planned', ['metricCount : Nat', 'itemCount : Nat', 'item : Nat', 'step : Nat', 'mappings : (List Mapping)'], 'Bool',
      match('mappings', [['List.nil', '((item =? itemCount) && (step =? 0))'], ['List.cons mapping rest', planned]]), 'mappings'),
    def('statedTotal', ['mappings : (List Mapping)'], 'Nat',
      match('mappings', [['List.nil', '0'], ['List.cons mapping rest', '((if (project mapping stated) then 1 else 0) + (statedTotal rest))']]), 'mappings'),
    // An element the oracle states is stated, and only a metric's base-measure element can be: GrimoireLab computes no metrics model.
    def('oracleTotal', ['mappings : (List Mapping)'], 'Nat',
      match('mappings', [['List.nil', '0'], ['List.cons mapping rest', '((if (project mapping byOracle) then 1 else 0) + (oracleTotal rest))']]), 'mappings'),
    def('oracleSound', ['metricCount : Nat', 'mappings : (List Mapping)'], 'Bool',
      match('mappings', [['List.nil', 'true'], ['List.cons mapping rest', '((if (project mapping byOracle) then ((project mapping stated) && ((project mapping item) <? metricCount)) else true) && (oracleSound metricCount rest))']]), 'mappings'),
  ],
  checks: [
    '((project release metricCount) <? ((project release itemsCount) + 1))',
    '(planned (project release metricCount) (project release itemsCount) 0 0 mappings)',
    '((statedTotal mappings) =? (project release statedCount))',
    '((oracleTotal mappings) =? (project release oracleCount))',
    '(oracleSound (project release metricCount) mappings)',
  ],
};
const records = {
  items: m.items.map((x) => ({ slug: x.slug })),
  mappings: m.items.flatMap((x) => x.entries.map((e) => {
    const o = e.status === 'open' ? byOracle.get(`${x.index} ${e.element}`) : undefined;
    if (o) return { item: x.index, element: e.element, stated: true, byOracle: true, source: o.cites[0].source, evidence: `sha256:${sha256(JSON.stringify(o.value))}` };
    return { item: x.index, element: e.element, stated: e.status === 'stated', byOracle: false, source: e.source ?? '', evidence: e.status === 'stated' ? `sha256:${e.digest}` : e.reason };
  })),
};
const releaseValues = { metricCount: m.counts.metrics, statedCount: m.counts.stated + oracleCount, oracleCount, standard: m.standard, register: `sha256:${m.register}` };

// ---- The ISO/IEC 15939 records the mapping supports, tied to the CHAOSS release. ----
const body = [];
body.push(`\\begin{lexlean}{Measures}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\useglossary{prism.arch@1.0.0}\n\\importmodule{Chaoss}\n\\importmodule{Foundation.Community.V1.Model}\n\\importmodule{MeasurementMapping}\n\\importmodule{${F}}\n\\importmodule{${S}}\n\\title{CHAOSS measures}\n\\begin{semanticmodule}`);
const needOf = new Map();
const needNames = [];
for (const x of m.items) {
  const e = x.entries.find((y) => y.element === 'informationNeed');
  if (e.status !== 'stated') continue;
  const name = `need${needNames.length}`;
  needOf.set(x.index, needNames.length);
  body.push(def(name, [], `${S}::InformationNeed`, `(record ${S}::InformationNeed {index := ${needNames.length}, name := ${str(x.title)}, text := ${str(x.kind === 'metric' ? x.question : e.source)}})`));
  needNames.push(name);
}
const conceptNames = [];
for (const x of m.items) {
  const e = x.entries.find((y) => y.element === 'measurableConcept');
  if (e.status !== 'stated' || !needOf.has(x.index)) continue;
  const name = `concept${conceptNames.length}`;
  body.push(def(name, [], `${S}::MeasurableConcept`, `(record ${S}::MeasurableConcept {index := ${conceptNames.length}, informationNeedIndex := ${needOf.get(x.index)}, name := ${str(x.title)}})`));
  conceptNames.push(name);
}
const chunked = (list, type, names) => {
  for (let start = Math.floor(Math.max(names.length - 1, 0) / 48) * 48; start >= 0; start -= 48) {
    const tail = start + 48 < names.length ? `(${list}From${start + 48})` : `(nil ${type})`;
    body.push(def(`${list}From${start}`, [], `(List ${type})`, names.slice(start, start + 48).reduceRight((rest, n) => `(cons (${n}) ${rest})`, tail)));
  }
  body.push(def(list, [], `(List ${type})`, `(${list}From0)`));
};
chunked('needs', `${S}::InformationNeed`, needNames);
chunked('concepts', `${S}::MeasurableConcept`, conceptNames);
const total = (name, type) => def(name, [`values : (List ${type})`], 'Nat', match('values', [['List.nil', '0'], ['List.cons value rest', `(1 + (${name} rest))`]]), 'values');
body.push(total('needTotal', `${S}::InformationNeed`));
body.push(def('needsNumbered', ['position : Nat', `values : (List ${S}::InformationNeed)`], 'Bool', match('values', [['List.nil', 'true'], ['List.cons need rest', '(((project need index) =? position) && (needsNumbered (position + 1) rest))']]), 'values'));
body.push(def('conceptsNumbered', ['position : Nat', 'needCount : Nat', `values : (List ${S}::MeasurableConcept)`], 'Bool', match('values', [['List.nil', 'true'], ['List.cons concept rest', '(((project concept index) =? position) && (((project concept informationNeedIndex) <? needCount) && (conceptsNumbered (position + 1) needCount rest)))']]), 'values'));
// The mapping covers exactly the CHAOSS release: its metrics first, then its models.
body.push(def('measuresValid', [], 'Bool', `(((project (MeasurementMapping::release) metricCount) =? (project (Chaoss::release) metricCount)) && (((project (MeasurementMapping::release) itemsCount) =? ((project (Chaoss::release) metricCount) + (project (Chaoss::release) modelCount))) && ((needsNumbered 0 (needs)) && (conceptsNumbered 0 (needTotal (needs)) (concepts)))))`));
body.push(`theorem{\n  name: measuresValidHolds,\n  parameters: [],\n  statement: ((measuresValid) = true),\n  proof: decide{}\n}`);
body.push('\\end{semanticmodule}\n\\end{lexlean}\n');

const entry = (id, module, component, surface) => `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;
outputs.set(join(repo, 'app/src/Foundation/Community/V1/Measurement.lex.tex'), typesModule(decl));
outputs.set(join(repo, 'app/src/MeasurementMapping.lex.tex'), catalogModule(decl, records, releaseValues));
outputs.set(join(repo, 'app/src/Measures.lex.tex'), body.join('\n'));
outputs.set(join(repo, 'app/language/prism.arch/entries/measurement-mapping-model.toml'), entry('measurement-mapping-model', F, 'registerValid', 'Measurement mapping model'));
outputs.set(join(repo, 'app/language/prism.arch/entries/measurement-mapping.toml'), entry('measurement-mapping', 'MeasurementMapping', 'registerValidHolds', 'Measurement mapping'));
outputs.set(join(repo, 'app/language/prism.arch/entries/chaoss-measures.toml'), entry('chaoss-measures', 'Measures', 'measuresValidHolds', 'CHAOSS measures'));

let stale = 0;
for (const [path, text] of outputs) {
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) { process.stderr.write(`${path.slice(repo.length + 1)} is not the measurement projection of chaoss/register.json\n`); stale++; }
  } else writeFileSync(path, text);
}
if (stale) process.exit(1);
process.stdout.write(`${m.items.length} items, ${m.counts.stated + oracleCount} elements stated (${oracleCount} by the oracle), ${m.counts.open - oracleCount} open, ${needNames.length} information needs, ${conceptNames.length} measurable concepts\n`);
