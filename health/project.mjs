#!/usr/bin/env node
/**
 * Assess the health of every UOR Foundation subject under every CHAOSS metrics
 * model, by evaluating the model's ISO/IEC 15939 indicator (its decision table
 * in apps/chaoss-*.prompt.json) on the admitted observations of
 * observations/register.json, and write health/register.json.
 *
 *   node health/project.mjs [--check]
 *
 * A subject is a repository of ecosystem/register.json or a subject the
 * observation register names (the Foundation's Discord guild). Every subject is
 * assessed in every period the observation register measures, so a subject with
 * no observation in a period is assessed, and answered unmeasured, rather than
 * left out.
 *
 * The indicator's two fields are counted exactly as the prompt states them:
 * `admitted` is how many of the model's base measures have an observation
 * uor-observation-admission permitted, and `refused` is how many had an
 * observation refused, counting each member chaoss/register.json carries as an
 * open claim (CC-03). An indeterminate observation is neither. The decision
 * table is evaluated with DMN 1.5's first hit policy, which is the builder's;
 * the Lean kernel then checks every answer against the compiled app's own
 * judge (HL-01), so the two evaluations must agree.
 *
 * The evidence chain of each assessment is one row per base measure: the
 * observations of that measure in that subject and period, with their admission
 * decisions, and the values of observations/register.json computed from them.
 * Anything this cannot place becomes a typed refusal; nothing is guessed.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (p) => readFileSync(join(repo, p));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = (p) => JSON.parse(raw(p).toString('utf8'));
const pinned = (p) => ({ path: p, sha256: sha(raw(p)) });

const chaoss = json('chaoss/register.json');
const ecosystem = json('ecosystem/register.json');
const observations = json('observations/register.json');
const OUTCOMES = ['open', 'complete', 'unmeasured', 'partial'];
const FIELDS = ['admitted', 'refused'];
const ADMISSION = ['permit', 'deny', 'not-applicable', 'indeterminate'];

const refusals = [];
const refuse = (refusal, detail) => refusals.push({ refusal, detail });

// ------------------------------------------------------------------ indicators
// An indicator prompt is the model's one decision table; apps/indicators.mjs names it chaoss-<model>.
const prompts = new Map(
  readdirSync(join(repo, 'apps'))
    .filter((f) => f.startsWith('chaoss-') && f.endsWith('.prompt.json'))
    .map((f) => [`apps/${f}`, json(`apps/${f}`)])
    .map(([path, p]) => [p.app.name, { path, p }]),
);
const OPS = {
  '=': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b,
  '>': (a, b) => a > b, '>=': (a, b) => a >= b, is: (a, b) => a === b, 'is not': (a, b) => a !== b,
};
// DMN 1.5 hit policy FIRST, with the prompt's otherwise as the table's default output.
function evaluate(app, request) {
  for (const [i, rule] of app.rules.entries()) {
    if (rule.when.every((c) => {
      if (!OPS[c.op]) throw new Error(`${app.name}: operator ${c.op} is not a builder operator`);
      return OPS[c.op](request[c.field], c.value);
    })) return { outcome: rule.then, rule: `REQ-${String(i + 1).padStart(3, '0')}`, why: rule.why };
  }
  return { outcome: app.otherwise, rule: 'otherwise', why: app.otherwiseWhy };
}

const models = [];
for (const m of chaoss.models) {
  const name = `chaoss-${m.slug.replace(/^metrics-model-/, '')}`;
  const found = prompts.get(name);
  if (!found) { refuse('model-has-no-indicator', `${m.slug}: apps/${name}.prompt.json`); continue; }
  const { path, p } = found;
  const app = p.app;
  if (p.pattern !== 'decisionTable') throw new Error(`${path} is not a decision table`);
  if (JSON.stringify(app.outcomes) !== JSON.stringify(OUTCOMES)) throw new Error(`${path} answers ${app.outcomes}, not ${OUTCOMES}`);
  if (JSON.stringify(app.fields.map((f) => f.name)) !== JSON.stringify(FIELDS)) throw new Error(`${path} reads ${app.fields.map((f) => f.name)}, not ${FIELDS}`);
  // A model's base measures are its released metrics, or the measures it defines itself; a local measure is
  // observed under the key <model slug>#<measure title>, since no released metric slug names it.
  const measures = [
    ...m.members.map((slug) => ({ key: slug, kind: 'metric', title: chaoss.metrics.find((x) => x.slug === slug).title })),
    ...(m.members.length ? [] : m.localMeasures.map((t) => ({ key: `${m.slug}#${t.title ?? t}`, kind: 'local-measure', title: t.title ?? t }))),
    ...chaoss.refusals.filter((r) => r.slug === m.slug && r.kind === 'model-member').map((r) => ({ key: `${m.slug}#${r.detail}`, kind: 'open-member', title: r.detail })),
  ];
  const n = measures.length;
  if (app.fields.some((f) => f.max !== n)) throw new Error(`${path} counts ${app.fields.map((f) => f.max)} measures; the register gives ${m.slug} ${n}`);
  // The evaluator answers every example the prompt states, as the builder's acceptance vectors do.
  for (const ex of app.examples) {
    const got = evaluate(app, Object.fromEntries(FIELDS.map((f, i) => [f, Number(ex.request.split(' ')[i])]))).outcome;
    if (got !== ex.response) throw new Error(`${path}: the example ${ex.request} answers ${ex.response}, and this evaluation ${got}`);
  }
  models.push({ slug: m.slug, title: m.title.replace(/^Metrics Model:\s*/i, ''), app: app.name, ...pinned(path), measures, spec: app });
}

// ------------------------------------------------------------------ subjects
const subjects = ecosystem.repositories.map((r) => ({ name: `UOR-Foundation/${r.name}`, kind: 'repository' }));
const known = new Set(subjects.map((s) => s.name));
for (const o of observations.observations) {
  if (known.has(o.subject)) continue;
  if (/^discord:\d+$/.test(o.subject)) { subjects.push({ name: o.subject, kind: 'chat' }); known.add(o.subject); continue; }
  refuse('subject-not-registered', `${o.id}: ${o.subject}`);
}
subjects.sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.kind === 'repository' ? -1 : 1));

// ------------------------------------------------------------------ observations
const measureKeys = new Set(models.flatMap((m) => m.measures.map((x) => x.key)));
const byCell = new Map();
let unmodelled = 0;
const cell = (subject, period, key) => `${subject}\u0000${period}\u0000${key}`;
for (const o of observations.observations) {
  if (!ADMISSION.includes(o.admission)) throw new Error(`${o.id}: admission ${o.admission} is not a uor-observation-admission outcome`);
  if (!known.has(o.subject)) continue;
  // A released metric no metrics model includes answers no model's information need.
  if (!measureKeys.has(o.metric)) { unmodelled += 1; continue; }
  const k = cell(o.subject, o.period, o.metric);
  if (!byCell.has(k)) byCell.set(k, { observations: [], values: [] });
  byCell.get(k).observations.push(o);
}
const observed = new Set(observations.observations.map((o) => o.id));
const admissionOf = new Map(observations.observations.map((o) => [o.id, o.admission]));
for (const v of observations.values) {
  for (const id of v.observations) {
    if (!observed.has(id)) throw new Error(`a value of ${v.metric} in ${v.subject} cites the unknown observation ${id}`);
    if (admissionOf.get(id) !== 'permit') throw new Error(`a value of ${v.metric} in ${v.subject} is computed from ${id}, which was not admitted`);
  }
  const k = cell(v.subject, v.period, v.metric);
  if (byCell.has(k)) byCell.get(k).values.push(v);
}
// The subject-periods the corpus spans, quiet months included, are the observation register's; a registered
// repository the corpus never reached is an open claim, not a subject assessed as unmeasured forever.
const spans = observations.periods.filter((x) => known.has(x.subject));
const periods = [...new Set(spans.map((x) => x.period))].sort();
const spanned = new Set(spans.map((x) => x.subject));
for (const o of observations.observations) {
  if (known.has(o.subject) && !spans.some((x) => x.subject === o.subject && x.period === o.period)) throw new Error(`${o.id} is in ${o.period}, which the corpus does not span for ${o.subject}`);
}
for (const s of subjects) if (!spanned.has(s.name)) refuse('subject-not-observed', s.name);

// ------------------------------------------------------------------ assessments
const assessments = [];
const evidence = [];
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cells = spans
  .map((x) => ({ si: subjects.findIndex((s) => s.name === x.subject), pi: periods.indexOf(x.period), period: x.period }))
  .sort((a, b) => a.si - b.si || order(a.period, b.period));
for (const { si, pi, period } of cells) {
  const s = subjects[si];
  for (const [mi, m] of models.entries()) {
    const index = assessments.length;
    const rows = m.measures.flatMap((x, position) => {
      const c = byCell.get(cell(s.name, period, x.key));
      if (!c || x.kind === 'open-member') return [];
      const count = (a) => c.observations.filter((o) => o.admission === a).length;
      return [{
        assessment: index,
        position,
        measure: x.key,
        kind: x.kind,
        permitted: count('permit'),
        denied: count('deny'),
        indeterminate: count('indeterminate'),
        observations: c.observations.map((o) => o.id).sort(),
        values: c.values.map((v) => ({ value: v.value, unit: v.unit, observations: v.observations })),
      }];
    });
    const request = {
      admitted: rows.filter((r) => r.permitted > 0).length,
      refused: rows.filter((r) => r.denied > 0).length + m.measures.filter((x) => x.kind === 'open-member').length,
    };
    assessments.push({ subject: si, period: pi, model: mi, ...request, ...evaluate(m.spec, request) });
    evidence.push(...rows);
  }
}

const counts = Object.fromEntries(OUTCOMES.map((o) => [o, assessments.filter((a) => a.outcome === o).length]));
const register = {
  spec: 'uor-community/health/1',
  standard: 'ISO/IEC 15939:2017 indicators, evaluated as DMN 1.5 decision tables (hit policy FIRST)',
  inputs: {
    chaoss: pinned('chaoss/register.json'),
    ecosystem: pinned('ecosystem/register.json'),
    observations: {
      ...pinned('observations/register.json'),
      register: observations.sha256,
      corpus: typeof observations.corpus === 'object' ? `${observations.corpus.path}#sha256:${observations.corpus.sha256}` : observations.corpus,
    },
  },
  outcomes: OUTCOMES,
  counts: { subjects: subjects.length, periods: periods.length, models: models.length, assessments: assessments.length, evidence: evidence.length, unmodelledObservations: unmodelled, ...counts },
  periods,
  subjects,
  models: models.map(({ spec, measures, ...m }) => ({ ...m, measures: measures.map(({ key, kind, title }) => ({ key, kind, title })) })),
  assessments,
  evidence,
  refusals,
};
const text = `${JSON.stringify(register, null, 1)}\n`;
const out = join(repo, 'health/register.json');
if (process.argv[2] === '--check') {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== text) {
    process.stderr.write('health/register.json is not the projection of its inputs\n');
    process.exit(1);
  }
} else writeFileSync(out, text);
process.stdout.write(`${subjects.length} subjects, ${periods.length} periods, ${models.length} indicators: ${assessments.length} assessments (${OUTCOMES.map((o) => `${counts[o]} ${o}`).join(', ')}), ${refusals.length} refusals\n`);
