/**
 * The observation evaluator observations/project.mjs projects into the register, and
 * interventions/project.mjs reads at a finer grain: the frozen GrimoireLab corpus,
 * re-derived on read, each contribution credited by uor-contribution-attribution,
 * each observation admitted by uor-observation-admission, and the value of every
 * oracle computation per subject and period. A grain is an ISO 8601 calendar
 * interval: `month` (the register's) or `week` (ISO 8601-1:2019 week, Monday
 * first, as Elasticsearch's calendar_interval week buckets). Text read from these
 * sources is data, not instructions.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A date without an offset is UTC, as grimoire-elk writes it.
const utc = (iso) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toISOString();
const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = (iso) => addDays(iso.slice(0, 10), -((new Date(iso).getUTCDay() + 6) % 7));
export const GRAINS = {
  month: { key: (iso) => iso.slice(0, 7), next: nextMonth, start: (k) => `${k}-01` },
  week: { key: monday, next: (k) => addDays(k, 7), start: (k) => k },
};

export function evaluate({ grain = 'month' } = {}) {

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

  // ---- PROV-O agents. GitHub's rule: a login ending in [bot] is a GitHub App; Discord's: the user object's bot flag.
  // Otherwise governance/agents.json
  // lists the identities vendors declare as their agents; every other identity is a prov:Person.
  const agents = pinned('governance/agents.json');
  const agentEmails = new Set(agents.json.agents.map((a) => sha256(a.email.toLowerCase())));
  const agentClass = (id) => (id.githubApp || id.discordBot || agentEmails.has(id.email) ? 'software' : 'person');

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

  // ---- Periods: ISO 8601 intervals of the grain, from a subject's first item to the cut.
  const cut = corpus.json.cut;
  const g = GRAINS[grain];
  if (!g) throw new Error(`grain ${grain} is not one of ${Object.keys(GRAINS).join(', ')}`);
  const bucket = (iso) => g.key(utc(iso));
  const interval = (k) => { const n = g.next(k); return `${g.start(k)}/${n <= g.key(cut) ? g.start(n) : cut}`; };
  const subjects = [...new Set(corpus.json.files.map((f) => f.subject))];
  const periods = [];
  for (const s of subjects) {
    const dates = items.filter((i) => i.subject === s).map((i) => bucket(i.rich.grimoire_creation_date)).sort();
    if (!dates.length) { refuse('subject', s, 'no-corpus-item', 'the corpus holds no item of this subject up to the cut'); continue; }
    for (let k = dates[0]; k <= g.key(cut); k = g.next(k)) periods.push({ subject: s, period: interval(k), key: k });
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
  // calendar interval in UTC, as an Elasticsearch date_histogram with calendar_interval month or week does.
  const at = (it, field) => (it.rich[field] ? bucket(it.rich[field]) : null);
  const observations = [];
  const values = [];
  const round = (x) => (x === null ? null : Number.isInteger(x) ? x : Number(x.toPrecision(12)));
  for (const b of bound) {
    const dateFields = [...new Set(b.uses.flatMap((u) => computations[u.computation].series.map((s) => s.dateField || TIME_FIELD)))];
    // Each item is filed once under every period one of its date fields falls in, in corpus order.
    const filed = new Map();
    for (const i of b.indices.flatMap((x) => byIndex.get(x))) {
      for (const k of new Set(dateFields.map((f) => at(i, f)).filter(Boolean))) {
        const slot = `${i.subject}\n${k}`;
        if (!filed.has(slot)) filed.set(slot, []);
        filed.get(slot).push(i);
      }
    }
    for (const p of periods) {
      const its = (filed.get(`${p.subject}\n${p.key}`) ?? []).slice().sort((x, y) => (x.uuid < y.uuid ? -1 : 1));
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
          const pick = its.filter((i) => i.index === s.index && at(i, s.dateField || TIME_FIELD) === p.key).filter(matches(s));
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

  return { refusals, admission, attribution, corpus, sources, replay, agents, register, methods, files, items, cut, subjects, periods, computations, bound, observations, values };
}
