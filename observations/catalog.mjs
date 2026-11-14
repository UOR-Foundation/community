#!/usr/bin/env node
/**
 * Write the Foundation.Observation.V1 facet from observations/register.json
 * through tools/register-lex.mjs:
 *
 *   app/src/Foundation/Observation/V1/Model.lex.tex  its types, whose enumerations
 *     are the admission app's own fields and outcomes, the app's rules as one
 *     Lean function, and registerValid;
 *   app/src/Observations.lex.tex  every subject, period, metric, computation,
 *     observation and value, and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid holds only when every observation's admission is what the app's
 * first-applicable rules decide on its recorded fields, and every value refers to
 * a permitted observation of its own metric. So the theorem states that every
 * value is a function of admitted observations. The same register always writes
 * the same bytes.
 *
 *   node observations/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel, pascal } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const prompt = JSON.parse(readFileSync(join(root, r.apps[0].path), 'utf8')).app;
const M = 'Foundation.Observation.V1.Model';

// One enumeration per admission field, named by the field, plus the outcomes: the app's vocabulary, unchanged.
const enumOf = (field) => `${pascal(field)}Status`;
const enums = { Admission: prompt.outcomes };
for (const f of prompt.fields) enums[enumOf(f.name)] = f.values;
for (const [name, values] of Object.entries(enums)) {
  if (new Set(values.map(camel)).size !== values.length) throw new Error(`${name} has a repeated constructor`);
}
// One branch per constructor, so a new word in the app is decided, never defaulted.
const is = (type, value) => `${camel(type)}Is${pascal(value)}`;
const predicates = [];
const need = new Set();
const want = (type, value) => { const k = `${type}|${value}`; if (!need.has(k)) { need.add(k); predicates.push(def(is(type, value), [`value : ${type}`], 'Bool', match('value', enums[type].map((v) => [`${type}.${camel(v)}`, v === value ? 'true' : 'false'])))); } return is(type, value); };
const cond = (c) => {
  const type = enumOf(c.field);
  const test = `(${want(type, c.value)} (project observation ${camel(enumOf(c.field))}))`;
  return c.op === 'is' ? test : c.op === 'is not' ? `(not ${test})` : (() => { throw new Error(`op ${c.op}`); })();
};
const conj = (xs) => xs.reduceRight((rest, x) => (rest === null ? x : `(${x} && ${rest})`), null);
// XACML first-applicable: the first rule whose conditions all hold decides; otherwise the app's default.
const decides = prompt.rules.reduceRight(
  (rest, rule) => `(if ${conj(rule.when.map(cond))} then (${want('Admission', rule.then)} (project observation admission)) else ${rest})`,
  `(${want('Admission', prompt.otherwise)} (project observation admission))`,
);
const permitted = want('Admission', 'permit');

const decl = {
  module: M,
  title: 'Observation model',
  catalog: 'Observations',
  catalogTitle: 'Observation register',
  enums,
  kinds: [
    { name: 'Subject', list: 'subjects', fields: [['name', 'String']] },
    { name: 'Period', list: 'periods', fields: [['subject', { ref: 'Subject' }], ['interval', 'String']] },
    { name: 'Metric', list: 'metrics', fields: [['slug', 'String'], ['method', 'String'], ['persons', 'Bool']] },
    { name: 'Computation', list: 'computations', fields: [['label', 'String'], ['unit', 'String'], ['source', 'String'], ['digest', 'String']] },
    {
      name: 'Observation',
      list: 'observations',
      fields: [
        ['metric', { ref: 'Metric' }], ['period', { ref: 'Period' }], ['items', 'Nat'], ['digest', 'String'],
        ...prompt.fields.map((f) => [camel(enumOf(f.name)), { enum: enumOf(f.name) }]),
        ['admission', { enum: 'Admission' }],
      ],
      checks: ['(admissionDecided $)', '(0 <? (project $ items))'],
    },
    {
      name: 'MetricValue',
      list: 'metricValues',
      fields: [['metric', { ref: 'Metric' }], ['computation', { ref: 'Computation' }], ['observation', { ref: 'Observation' }], ['amount', 'String']],
    },
    { name: 'OpenClaim', list: 'openClaims', fields: [['kind', 'String'], ['subject', 'String'], ['refusal', 'String'], ['detail', 'String']] },
  ],
  release: [['corpusDigest', 'String'], ['cut', 'String'], ['registerDigest', 'String'], ['admittedCount', 'Nat']],
  definitions: [
    ...predicates,
    def('admissionDecided', ['observation : Observation'], 'Bool', decides),
    def('admittedTotal', ['values : (List Observation)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons observation rest', `((if (${permitted} (project observation admission)) then 1 else 0) + (admittedTotal rest))`]]), 'values'),
    // Values are written in observation order, so one pass over both lists checks every reference.
    def('skipTo', ['position : Nat', 'observations : (List Observation)'], '(List Observation)',
      match('observations', [['List.nil', '(nil Observation)'], ['List.cons observation rest', `(if ((project observation index) <? position) then (skipTo position rest) else (cons observation rest))`]]), 'observations'),
    def('admitsValue', ['value : MetricValue', 'observations : (List Observation)'], 'Bool',
      match('observations', [['List.nil', 'false'], ['List.cons observation rest', `(((project observation index) =? (project value observation)) && ((${permitted} (project observation admission)) && ((project observation metric) =? (project value metric))))`]])),
    def('valuesAdmitted', ['observations : (List Observation)', 'values : (List MetricValue)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons value rest', '((admitsValue value (skipTo (project value observation) observations)) && (valuesAdmitted (skipTo (project value observation) observations) rest))']]), 'values'),
  ],
  checks: [
    '((admittedTotal observations) =? (project release admittedCount))',
    '(valuesAdmitted observations metricValues)',
  ],
};

const subjectIx = new Map(r.files.map((f) => f.subject).filter((s, i, a) => a.indexOf(s) === i).map((s, i) => [s, i]));
const periodIx = new Map(r.periods.map((p, i) => [`${p.subject}|${p.period}`, i]));
const metricIx = new Map(r.metrics.map((m, i) => [m.metric, i]));
const obsIx = new Map(r.observations.map((o, i) => [o.id, i]));
const records = {
  subjects: [...subjectIx.keys()].map((name) => ({ name })),
  periods: r.periods.map((p) => ({ subject: subjectIx.get(p.subject), interval: p.period })),
  metrics: r.metrics.map((m) => ({ slug: m.metric, method: m.method ?? 'unstated', persons: m.persons })),
  computations: r.computations.map((c) => ({ label: c.label, unit: c.unit ?? '', source: c.at.source, digest: `sha256:${c.at.digest}` })),
  observations: r.observations.map((o) => ({
    metric: metricIx.get(o.metric), period: periodIx.get(`${o.subject}|${o.period}`), items: o.items, digest: `sha256:${o.digest}`,
    ...Object.fromEntries(prompt.fields.map((f) => [camel(enumOf(f.name)), o.request[f.name]])), admission: o.admission,
  })),
  metricValues: r.values.map((v) => ({ metric: metricIx.get(v.metric), computation: v.computation, observation: obsIx.get(v.observations[0]), amount: String(v.value) }))
    .sort((a, b) => a.observation - b.observation || a.computation - b.computation),
  openClaims: r.refusals.map((c) => ({ kind: c.kind, subject: c.subject, refusal: c.refusal, detail: c.detail })),
};
const release = { corpusDigest: `sha256:${r.corpus.sha256}`, cut: r.corpus.cut, registerDigest: `sha256:${r.sha256}`, admittedCount: r.counts.admitted };

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(root, 'app');
const outputs = [
  ['src/Foundation/Observation/V1/Model.lex.tex', typesModule(decl)],
  ['src/Observations.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/observation-model.toml', entry('observation-model', 'Observation model', M, 'registerValid')],
  ['language/prism.arch/entries/observation-register.toml', entry('observation-register', 'Observation register', 'Observations', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of observations/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
process.stdout.write(`${records.observations.length} observations (${release.admittedCount} admitted), ${records.metricValues.length} values, ${records.openClaims.length} open claims\n`);
