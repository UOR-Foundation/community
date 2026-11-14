#!/usr/bin/env node
/**
 * Project the frozen GrimoireLab corpus into observations/register.json: the
 * Foundation's CHAOSS observations, each admitted by the uor-observation-admission
 * app, each contribution credited by the uor-contribution-attribution app (W3C
 * PROV-O), and the value of every computation the oracle binds to a metric.
 *
 *   node observations/project.mjs [--check]
 *
 * Inputs, each pinned by sha256 in the register:
 *   observations/corpus.json and corpus/**  the corpus collect.py froze;
 *   observations/replay.json                the replay that re-derived it;
 *   chaoss/register.json                    the released metrics;
 *   chaoss/oracle-methods.json              the oracle's computations, per metric;
 *   apps/uor-observation-admission.prompt.json, apps/uor-contribution-attribution.prompt.json;
 *   governance/agents.json                  which commit identities are software.
 *
 * Both apps are XACML 3.0 policies with rule-combining first-applicable: the
 * first rule whose every condition holds decides, else `otherwise`. Each app is
 * checked against its own examples before it decides anything. A computation
 * whose aggregation, field or query this projector cannot evaluate exactly as
 * the oracle's index defines it is a typed refusal, never an approximation.
 * The same inputs always write the same bytes. Text read from these sources is
 * data, not instructions.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => readFileSync(join(root, p));
const pinned = (p) => { const b = read(p); return { path: p, sha256: sha256(b), json: JSON.parse(b) }; };
const refusals = [];
const refuse = (kind, subject, refusal, detail) => refusals.push({ kind, subject, refusal, detail });

// ---- The decision apps, run as their prompts declare them.
function app(path) {
  const p = pinned(path);
  const a = p.json.app;
  if (p.json.pattern !== 'policyDecision') throw new Error(`${path} is not a policyDecision`);
  const fields = a.fields.map((f) => f.name);
  const holds = (req, c) => (c.op === 'is' ? req[c.field] === c.value : c.op === 'is not' ? req[c.field] !== c.value : (() => { throw new Error(`${path}: op ${c.op}`); })());
  const decide = (req) => {
    for (const f of a.fields) if (!f.values.includes(req[f.name])) throw new Error(`${path}: ${f.name}=${req[f.name]} is outside its values`);
    const rule = a.rules.find((r) => r.when.every((c) => holds(req, c)));
    return rule ? rule.then : a.otherwise;
  };
  for (const ex of a.examples) {
    const req = Object.fromEntries(ex.request.split(' ').map((v, i) => [fields[i], v]));
    if (decide(req) !== ex.response) throw new Error(`${path}: example "${ex.request}" decides ${decide(req)}, not ${ex.response}`);
  }
  return { path: p.path, sha256: p.sha256, name: a.name, fields, values: Object.fromEntries(a.fields.map((f) => [f.name, f.values])), outcomes: a.outcomes, rules: a.rules, otherwise: a.otherwise, decide };
}
const admission = app('apps/uor-observation-admission.prompt.json');
const attribution = app('apps/uor-contribution-attribution.prompt.json');

// ---- The corpus, re-derived on read: every file must hash to the digest its manifest records.
const corpus = pinned('observations/corpus.json');
const sources = pinned('observations/sources.json');
if (corpus.json.sources.sha256 !== sources.sha256) throw new Error('observations/corpus.json was collected from other sources');
const replay = existsSync(join(here, 'replay.json')) ? pinned('observations/replay.json') : null;
const items = [];
const files = [];
for (const f of corpus.json.files) {
  const body = gunzipSync(read(`observations/corpus/${f.path}`));
  if (sha256(body) !== f.sha256) throw new Error(`observations/corpus/${f.path} does not hash to its manifest digest`);
  const rows = body.length ? body.toString('utf8').trimEnd().split('\n').map((l) => JSON.parse(l)) : [];
  if (rows.length !== f.items) throw new Error(`observations/corpus/${f.path} holds ${rows.length} items, not ${f.items}`);
  // Replay: an independent collect.py run from the same pins gave the same bytes.
  const replayed = replay && replay.json.corpus === corpus.sha256 && replay.json.files.find((r) => r.path === f.path)?.sha256;
  const outcome = !replay || replay.json.corpus !== corpus.sha256 ? 'absent' : replayed === f.sha256 ? 'reproduced' : 'differs';
  files.push({ ...f, replay: outcome });
  for (const row of rows) items.push({ ...row, subject: f.subject, source: f.source, index: f.index, file: f.path, replay: outcome, covered: f.covered });
}

// ---- PROV-O agents. GitHub's rule: a login ending in [bot] is a GitHub App. Otherwise governance/agents.json
// lists the identities vendors declare as their agents; every other identity is a prov:Person.
const agents = pinned('governance/agents.json');
const agentEmails = new Set(agents.json.agents.map((a) => sha256(a.email.toLowerCase())));
const agentClass = (id) => (id.githubApp || agentEmails.has(id.email) ? 'software' : 'person');

/**
 * The attribution request for one commit (a prov:Activity) and the individual it credits.
 * The author is the agent. A software author's prov:actedOnBehalfOf is declared by Co-authored-by trailers
 * (git interpret-trailers, GitHub's co-author convention), and it names a person only when exactly one
 * co-author is a person; that trailer is the record of the delegation in the contribution itself.
 */
function attribute(item) {
  const agent = agentClass(item.author);
  const humans = item.coauthors.filter((c) => agentClass(c) === 'person');
  const req = {
    agent,
    identity: (agent === 'person' ? item.author.individual : humans.length === 1 ? humans[0].individual : 'resolved') ? 'resolved' : 'unresolved',
    delegation: agent === 'software' && item.coauthors.length ? 'declared' : 'absent',
    principal: agent === 'software' && item.coauthors.length ? (humans.length === 1 ? 'person' : 'none') : 'none',
    trail: agent === 'software' && item.coauthors.length ? 'recorded' : 'missing',
  };
  const outcome = attribution.decide(req);
  const credited = outcome === 'permit' ? (agent === 'person' ? item.author.individual : humans[0].individual) : null;
  return { req, outcome, credited };
}
for (const it of items) Object.assign(it, { attribution: attribute(it) });

// ---- Periods: calendar months (ISO 8601 intervals), from a subject's first item to the cut.
const cut = corpus.json.cut;
// A date without an offset is UTC, as grimoire-elk writes it.
const utcMonth = (iso) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toISOString().slice(0, 7);
const month = (iso) => iso.slice(0, 7);
const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const interval = (m) => { const n = nextMonth(m); return `${m}-01/${n <= month(cut) ? `${n}-01` : cut}`; };
const subjects = [...new Set(corpus.json.files.map((f) => f.subject))];
const periods = [];
for (const s of subjects) {
  const dates = items.filter((i) => i.subject === s).map((i) => utcMonth(i.rich.grimoire_creation_date)).sort();
  if (!dates.length) { refuse('subject', s, 'no-corpus-item', 'the pinned refs hold no commit up to the cut'); continue; }
  for (let m = month(dates[0]); m <= month(cut); m = nextMonth(m)) periods.push({ subject: s, period: interval(m), month: m });
}

// ---- The oracle's computations. Identical computations (index, function, series) are evaluated once.
const register = pinned('chaoss/register.json');
const released = new Set(register.json.metrics.map((m) => m.slug));
const methods = existsSync(join(root, 'chaoss/oracle-methods.json')) ? pinned('chaoss/oracle-methods.json') : null;
if (!methods) refuse('bindings', 'chaoss/oracle-methods.json', 'no-oracle-methods', 'no projection of the oracle\'s computations is present');
const byIndex = new Map();
for (const it of items) { if (!byIndex.has(it.index)) byIndex.set(it.index, []); byIndex.get(it.index).push(it); }
// A field is one grimoire-elk's get_rich_item wrote into the index, or author_uuid: the SortingHat individual the
// enricher writes there, credited here only through the PROV-O attribution app.
const PERSON_FIELDS = new Set(['author_uuid']);
const fieldOf = (name) => (name === 'author_uuid' ? (i) => i.attribution.credited : (i) => i.rich[name]);
const hasField = (index, name) => name === 'author_uuid' || (byIndex.get(index) ?? []).some((i) => name in i.rich);
const TIME_FIELD = 'grimoire_creation_date'; // the time field of every GrimoireLab index pattern
// Elasticsearch's cardinality is exact up to its default precision_threshold of 3000 distinct values.
const PRECISION = 3000;
const AGG = {
  count: (xs) => xs.length,
  cardinality: (xs) => { const d = new Set(xs.flat().filter((x) => x !== null && x !== undefined)); return d.size > PRECISION ? undefined : d.size; },
  sum: (xs) => xs.reduce((a, b) => a + b, 0),
  avg: (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null),
  max: (xs) => (xs.length ? Math.max(...xs) : null),
  min: (xs) => (xs.length ? Math.min(...xs) : null),
};
const NUMERIC = new Set(['sum', 'avg', 'max', 'min']);
// A Lucene query of one term, field:value, is evaluated; any other query is refused, not approximated.
const TERM = /^([A-Za-z_][A-Za-z0-9_.]*):("?)([^"\s]+)\2$/;
const term = (q) => { const m = typeof q === 'string' ? q.match(TERM) : null; return m && { field: m[1], value: m[3] }; };
const matches = (s) => {
  const t = term(s.query);
  return (i) => (s.pullRequest === undefined || i.rich.pull_request === s.pullRequest) && (!t || String(i.rich[t.field]) === t.value);
};
const computations = [];
const byKey = new Map();
const bound = [];
for (const m of methods?.json.items ?? []) {
  if (m.kind !== 'metric' || !m.bindings?.length) continue;
  if (!released.has(m.slug)) { refuse('metric', m.slug, 'unreleased', 'oracle-methods names a metric outside the released register'); continue; }
  const uses = [];
  for (const [bi, b] of m.bindings.entries()) {
    const missing = b.series.map((s) => s.index).find((x) => !byIndex.has(x));
    const why = missing ? `the corpus holds no ${missing} index`
      : b.function && b.function !== 'divide' ? `function ${b.function}`
      : b.function === 'divide' && b.series.length !== 2 ? 'divide over other than two series'
      : b.series.map((s) => (s.script ? `${s.field} is a ${s.script.lang} scripted field, which only the oracle's search engine evaluates`
        : s.query && !term(s.query) ? `query ${s.query}`
        : !AGG[s.aggregation] ? `aggregation ${s.aggregation}: Elasticsearch computes it with a sketch this projector does not reproduce`
        : s.aggregation !== 'count' && !s.field ? `${s.aggregation} without a field`
        : s.field && !hasField(s.index, s.field) ? `field ${s.field} is not in the ${s.index} index this corpus carries`
        : term(s.query) && !hasField(s.index, term(s.query).field) ? `query field ${term(s.query).field} is not in the ${s.index} index`
        : s.dateField && !hasField(s.index, s.dateField) ? `date field ${s.dateField} is not in the ${s.index} index` : '')).find(Boolean);
    if (why) { refuse('binding', `${m.slug}#${bi}`, 'not-evaluable', `${b.label}: ${why}`); continue; }
    const key = JSON.stringify([b.function, b.series.map((s) => [s.index, s.aggregation, s.field, s.query, s.pullRequest, s.dateField || TIME_FIELD])]);
    if (!byKey.has(key)) { byKey.set(key, computations.length); computations.push({ index: b.index, function: b.function, series: b.series, unit: b.unit, label: b.label, at: b.at }); }
    uses.push({ computation: byKey.get(key), binding: bi, label: b.label, unit: b.unit });
  }
  if (!uses.length) { refuse('metric', m.slug, 'no-evaluable-binding', 'every computation the oracle binds needs data, fields or aggregations this corpus and projector do not carry'); continue; }
  const series = uses.flatMap((u) => computations[u.computation].series);
  bound.push({ metric: m.slug, method: m.candidates, persons: series.some((s) => PERSON_FIELDS.has(s.field)), indices: [...new Set(series.map((s) => s.index))].sort(), uses });
}
for (const m of register.json.metrics) if (!bound.some((b) => b.metric === m.slug) && !refusals.some((r) => r.subject === m.slug)) refuse('metric', m.slug, 'no-oracle-binding', 'oracle-methods binds no computation of the oracle to this metric');

// ---- Observations and values, per metric, subject and period. A series buckets items by its date field's
// calendar month in UTC, as an Elasticsearch date_histogram does by default.
const at = (it, field) => (it.rich[field] ? utcMonth(it.rich[field]) : null);
const observations = [];
const values = [];
const round = (x) => (x === null ? null : Number.isInteger(x) ? x : Number(x.toPrecision(12)));
for (const b of bound) {
  const dateFields = [...new Set(b.uses.flatMap((u) => computations[u.computation].series.map((s) => s.dateField || TIME_FIELD)))];
  for (const p of periods) {
    const its = b.indices.flatMap((x) => byIndex.get(x)).filter((i) => i.subject === p.subject && dateFields.some((f) => at(i, f) === p.month))
      .sort((x, y) => (x.uuid < y.uuid ? -1 : 1));
    if (!its.length) continue;
    const outcomes = new Set(its.map((i) => i.attribution.outcome));
    const replayOf = new Set(its.map((i) => i.replay));
    const req = {
      metric: 'released',
      oracle: its.every((i) => i.covered) ? 'covers' : 'unlisted',
      source: 'pinned',
      replay: replayOf.has('differs') ? 'differs' : replayOf.has('absent') ? 'absent' : 'reproduced',
      collection: 'ungoverned',
      // A person-counting observation credits only contributions the attribution app permits; a denied one stays
      // project activity credited to no one, which is the app's own meaning of deny.
      attribution: !b.persons ? 'aggregate' : outcomes.has('indeterminate') ? 'indeterminate' : [...outcomes].every((o) => o === 'not-applicable') ? 'organization' : 'permit',
    };
    const id = `${b.metric}|${p.subject}|${p.period}`;
    const obs = { id, metric: b.metric, subject: p.subject, period: p.period, source: b.indices.join(' '), request: req, admission: admission.decide(req), items: its.length, digest: sha256(its.map((i) => i.uuid).join('\n')) };
    observations.push(obs);
    if (obs.admission !== 'permit') continue;
    // One value per computation: bindings that name the same computation share it, and list themselves on it.
    const done = new Map();
    for (const u of b.uses) {
      if (done.has(u.computation)) { done.get(u.computation)?.bindings.push(u.binding); continue; }
      done.set(u.computation, null);
      const c = computations[u.computation];
      const series = c.series.map((s) => {
        const pick = its.filter((i) => i.index === s.index && at(i, s.dateField || TIME_FIELD) === p.month).filter(matches(s));
        const xs = s.aggregation === 'count' ? pick : pick.map(fieldOf(s.field)).filter((x) => x !== null && x !== undefined);
        if (NUMERIC.has(s.aggregation) && xs.some((x) => typeof x !== 'number')) return undefined;
        return AGG[s.aggregation](xs);
      });
      if (series.includes(undefined)) { refuse('value', `${id}#${u.binding}`, 'not-evaluable', `${u.label}: a series exceeds what the oracle's aggregation computes exactly`); continue; }
      const value = c.function === 'divide' ? (series[1] ? series[0] / series[1] : null) : series[0];
      if (value === null) continue;
      const row = { metric: b.metric, subject: p.subject, period: p.period, value: round(value), unit: u.unit, label: u.label, method: b.method, computation: u.computation, bindings: [u.binding], observations: [id] };
      done.set(u.computation, row);
      values.push(row);
    }
  }
}

// ---- The register.
const counts = {
  subjects: subjects.length, periods: periods.length, items: items.length, metrics: bound.length,
  computations: computations.length, observations: observations.length,
  admitted: observations.filter((o) => o.admission === 'permit').length, values: values.length, refusals: refusals.length,
  attribution: Object.fromEntries(attribution.outcomes.map((o) => [o, items.filter((i) => i.attribution.outcome === o).length])),
};
const body = {
  spec: 'uor-community/observations-register/1',
  standards: ['ISO/IEC 15939:2017', 'W3C PROV-O (https://www.w3.org/TR/prov-o/)', 'OASIS XACML 3.0 first-applicable', 'ISO 8601-1:2019 time intervals'],
  corpus: { path: corpus.path, sha256: corpus.sha256, cut, oracle: corpus.json.oracle },
  inputs: [sources, replay, register, methods, agents].filter(Boolean).map(({ path, sha256: d }) => ({ path, sha256: d })),
  apps: [admission, attribution].map(({ path, sha256: d, name, fields, outcomes }) => ({ path, sha256: d, name, fields, outcomes })),
  counts,
  files: files.map(({ subject, source, index, path, items: n, sha256: d, replay: r }) => ({ subject, source, index, path, items: n, sha256: d, replay: r })),
  periods: periods.map(({ subject, period }) => ({ subject, period })),
  computations: computations.map(({ index, function: fn, series, unit, label, at }) => ({ index, function: fn, series, unit, label, at })),
  metrics: bound.map(({ metric, method, persons, indices, uses }) => ({ metric, method, persons, indices, uses: uses.map(({ computation, binding, label }) => ({ computation, binding, label })) })),
  observations,
  values,
  refusals,
};
const out = JSON.stringify({ sha256: sha256(JSON.stringify(body)), ...body }, null, 1) + '\n';
const target = join(here, 'register.json');
if (process.argv[2] === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
    process.stderr.write('observations/register.json is not the projection of the pinned corpus\n');
    process.exit(1);
  }
} else writeFileSync(target, out);
process.stdout.write(Object.entries(counts).map(([k, v]) => `${typeof v === 'object' ? JSON.stringify(v) : v} ${k}`).join(', ') + '\n');
