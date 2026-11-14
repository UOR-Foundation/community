#!/usr/bin/env node
/**
 * Write the Foundation.Health.V1 facet from health/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Health/V1/Model.lex.tex  its types and registerValid, which
 *     imports every indicator app's module and checks each assessment against that
 *     app's own compiled judge (HL-01), and each assessment's counts against its
 *     evidence rows (HL-02);
 *   app/src/Health.lex.tex  every subject, indicator, assessment, evidence row and
 *     open claim, and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * The same register always writes the same bytes.
 *
 *   node health/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel, pascal } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Health.V1.Model';

// The builder names an app's module and declarations after the app (ADR 0001), and numbers its answers in the
// order of its outcomes, which every indicator shares with this register.
const appModule = (app) => pascal(app);
const judge = (m) => {
  const A = appModule(m.app);
  return `(${A}::${camel(m.app)}Judge (record ${A}::${A}Request {admitted := admitted, refused := refused}))`;
};
const verdict = r.models.reduceRight((rest, m, i) => `(if (model =? ${i}) then ${judge(m)} else ${rest})`, String(r.outcomes.length));

// An answer's constructor is prefixed, as the builder's answer constants are, since `open` and `partial` are Lean
// keywords.
const ans = (o) => `answer-${o}`;
const decl = {
  module: M,
  title: 'Health model',
  catalog: 'Health',
  catalogTitle: 'Health register',
  imports: r.models.map((m) => appModule(m.app)),
  enums: { Answer: r.outcomes.map(ans), SubjectKind: ['repository', 'chat'] },
  kinds: [
    { name: 'Subject', list: 'subjects', fields: [['name', 'String'], ['kind', { enum: 'SubjectKind' }]] },
    { name: 'Period', list: 'periods', fields: [['interval', 'String']] },
    {
      name: 'Indicator',
      list: 'indicators',
      fields: [['slug', 'String'], ['app', 'String'], ['source', 'String'], ['measures', 'Nat'], ['openMembers', 'Nat']],
      checks: ['((project $ openMembers) <=? (project $ measures))'],
    },
    {
      name: 'Assessment',
      list: 'assessments',
      fields: [['subject', { ref: 'Subject' }], ['period', { ref: 'Period' }], ['model', { ref: 'Indicator' }], ['admitted', 'Nat'], ['refused', 'Nat'], ['outcome', { enum: 'Answer' }]],
      checks: ['((answerCode (project $ outcome)) =? (verdict (project $ model) (project $ admitted) (project $ refused)))'],
    },
    {
      // One row per base measure that has an observation in the assessment's subject and period, at the measure's
      // position in the indicator; a measure with none counts toward neither field, so it needs no row. The
      // measure's key and its observation ids are the row's in health/register.json.
      name: 'Evidence',
      list: 'evidence',
      fields: [
        ['assessment', { ref: 'Assessment' }], ['position', 'Nat'], ['permitted', 'Nat'], ['denied', 'Nat'], ['indeterminate', 'Nat'], ['values', 'Nat'],
      ],
      // A value is computed only from admitted observations, so a measure with a value has a permitted one.
      checks: ['(((project $ values) =? 0) || (1 <=? (project $ permitted)))'],
    },
    { name: 'OpenClaim', list: 'openClaims', fields: [['name', 'String'], ['reason', 'String']] },
  ],
  release: [
    ['chaossDigest', 'String'], ['ecosystemDigest', 'String'], ['observationsDigest', 'String'], ['corpus', 'String'],
    ...r.outcomes.map((o) => [`${camel(o)}Count`, 'Nat']),
  ],
  definitions: [
    def('answerCode', ['answer : Answer'], 'Nat', match('answer', r.outcomes.map((o, i) => [`Answer.${camel(ans(o))}`, String(i)]))),
    // The indicator app's own answer: its compiled judge, applied to the assessment's two counts.
    def('verdict', ['model : Nat', 'admitted : Nat', 'refused : Nat'], 'Nat', verdict),
    def('answered', ['answer : Answer', 'values : (List Assessment)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons assessment rest', '((if ((answerCode (project assessment outcome)) =? (answerCode answer)) then 1 else 0) + (answered answer rest))']]), 'values'),
    def('indicatorAt', ['position : Nat', 'values : (List Indicator)'], '(Option Indicator)',
      match('values', [['List.nil', '(ctor Option.none [Indicator])'], ['List.cons indicator rest', '(if ((project indicator index) =? position) then (ctor Option.some [Indicator] indicator) else (indicatorAt position rest))']]), 'values'),
    // An assessment closes with the counts its rows gave: admitted is the rows with a permitted observation, and
    // refused the rows with a refused one plus the members the CHAOSS register carries as open claims (CC-03), as
    // the indicator's fields state. Its rows name distinct observable measures, in order.
    def('closesWith', ['assessment : Assessment', 'admitted : Nat', 'refused : Nat', 'floor : Nat', 'found : (Option Indicator)'], 'Bool',
      match('found', [['Option.none', 'false'], ['Option.some indicator', '(((project assessment admitted) =? admitted) && (((project assessment refused) =? (refused + (project indicator openMembers))) && (floor <=? (prim subtract (project indicator measures) (project indicator openMembers) : Nat))))']])),
    def('closes', ['indicators : (List Indicator)', 'admitted : Nat', 'refused : Nat', 'floor : Nat', 'pending : (List Assessment)'], 'Bool',
      match('pending', [['List.nil', 'false'], ['List.cons assessment rest', '(closesWith assessment admitted refused floor (indicatorAt (project assessment model) indicators))']])),
    def('later', ['pending : (List Assessment)'], '(List Assessment)', match('pending', [['List.nil', '(nil Assessment)'], ['List.cons assessment rest', 'rest']])),
    def('done', ['pending : (List Assessment)'], 'Bool', match('pending', [['List.nil', 'true'], ['List.cons assessment rest', 'false']])),
    def('headIndex', ['pending : (List Assessment)'], 'Nat', match('pending', [['List.nil', '0'], ['List.cons assessment rest', '(project assessment index)']])),
    def('rowFor', ['position : Nat', 'rows : (List Evidence)'], 'Bool', match('rows', [['List.nil', 'false'], ['List.cons row rest', '((project row assessment) =? position)']])),
    def('exhausted', ['rows : (List Evidence)'], 'Bool', match('rows', [['List.nil', 'true'], ['List.cons row rest', 'false']])),
    def('drop', ['rows : (List Evidence)'], '(List Evidence)', match('rows', [['List.nil', '(nil Evidence)'], ['List.cons row rest', 'rest']])),
    def('admits', ['rows : (List Evidence)'], 'Nat', match('rows', [['List.nil', '0'], ['List.cons row rest', '(if (1 <=? (project row permitted)) then 1 else 0)']])),
    def('refuses', ['rows : (List Evidence)'], 'Nat', match('rows', [['List.nil', '0'], ['List.cons row rest', '(if (1 <=? (project row denied)) then 1 else 0)']])),
    def('above', ['floor : Nat', 'rows : (List Evidence)'], 'Bool', match('rows', [['List.nil', 'false'], ['List.cons row rest', '(floor <=? (project row position))']])),
    def('next', ['rows : (List Evidence)'], 'Nat', match('rows', [['List.nil', '0'], ['List.cons row rest', '((project row position) + 1)']])),
    // One pass over the assessments and the evidence rows together, both in register order: each assessment owns
    // the run of rows that name it, and closes with exactly what that run admits and refuses. Fuel bounds the walk
    // by the number of both, so every assessment and every row is reached.
    def('tallied', ['indicators : (List Indicator)', 'pending : (List Assessment)', 'rows : (List Evidence)', 'admitted : Nat', 'refused : Nat', 'floor : Nat', 'fuel : Nat'], 'Bool',
      match('fuel', [
        ['Nat.zero', 'false'],
        ['Nat.succ more', '(if (done pending) then (exhausted rows) else (if (rowFor (headIndex pending) rows) then ((above floor rows) && (tallied indicators pending (drop rows) (admitted + (admits rows)) (refused + (refuses rows)) (next rows) more)) else ((closes indicators admitted refused floor pending) && (tallied indicators (later pending) rows 0 0 0 more))))'],
      ]), 'fuel'),
  ],
  checks: [
    `(tallied indicators assessments evidence 0 0 0 ${r.assessments.length + r.evidence.length + 1})`,
    ...r.outcomes.map((o) => `((answered (ctor Answer.${camel(ans(o))}) assessments) =? (project release ${camel(o)}Count))`),
  ],
};

const records = {
  subjects: r.subjects.map((s) => ({ name: s.name, kind: s.kind })),
  periods: r.periods.map((p) => ({ interval: p })),
  indicators: r.models.map((m) => ({
    slug: m.slug, app: m.app, source: `${m.path}#sha256:${m.sha256}`, measures: m.measures.length,
    openMembers: m.measures.filter((x) => x.kind === 'open-member').length,
  })),
  assessments: r.assessments.map((a) => ({ subject: a.subject, period: a.period, model: a.model, admitted: a.admitted, refused: a.refused, outcome: ans(a.outcome) })),
  evidence: r.evidence.map((e) => ({
    assessment: e.assessment, position: e.position, permitted: e.permitted, denied: e.denied, indeterminate: e.indeterminate, values: e.values.length,
  })),
  openClaims: r.refusals.map((c) => ({ name: c.detail, reason: c.refusal })),
};
const release = {
  chaossDigest: `sha256:${r.inputs.chaoss.sha256}`,
  ecosystemDigest: `sha256:${r.inputs.ecosystem.sha256}`,
  observationsDigest: `sha256:${r.inputs.observations.sha256}`,
  corpus: String(r.inputs.observations.corpus),
  ...Object.fromEntries(r.outcomes.map((o) => [`${camel(o)}Count`, r.counts[o]])),
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Health/V1/Model.lex.tex', typesModule(decl)],
  ['src/Health.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/health-model.toml', entry('health-model', 'Health model', M, 'registerValid')],
  ['language/prism.arch/entries/health-register.toml', entry('health-register', 'Health register', 'Health', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of health/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
process.stdout.write(`${records.assessments.length} assessments, ${records.evidence.length} evidence rows, ${records.openClaims.length} open claims\n`);
