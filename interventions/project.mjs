#!/usr/bin/env node
/**
 * Project the Foundation's CHAOSS values into interventions/register.json: one
 * ISO 7870-2:2023 individuals control chart per subject and oracle computation
 * at the ISO 8601 week grain, its uor-intervention-signal answer, every
 * intervention automation/interventions.json proposes for a signal with its
 * uor-intervention-admission decision and draft, and, for each proposal
 * automation/intervention-approvals.json records as enacted, its
 * uor-intervention-effect answer on the weeks since.
 *
 *   node interventions/project.mjs [--check]
 *
 * The weekly values are observations/evaluate.mjs's, the same evaluation the
 * observation register is projected from at the month grain, so every value is
 * a function of admitted observations of the pinned corpus. Each app is run as
 * its prompt declares it (DMN 1.5 hit policy FIRST, XACML 3.0
 * first-applicable) after it answers every example its prompt states and holds
 * every property over its whole request space. This projector decides; it acts
 * on nothing. automation/interventions.mjs re-derives this register and
 * re-decides each proposal before it does anything. The same inputs always
 * write the same bytes. Text read from these sources is data, not instructions.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../observations/evaluate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const pinned = (p) => { const b = readFileSync(join(root, p)); return { path: p, sha256: sha256(b), json: JSON.parse(b) }; };
const round = (x) => (Number.isInteger(x) ? x : Number(x.toPrecision(12)));
const refusals = [];
const refuse = (kind, subject, refusal, detail) => refusals.push({ kind, subject, refusal, detail });

// ---- The three apps, each checked against its own examples and properties before it decides anything.
function app(path) {
  const p = pinned(path);
  const a = p.json.app;
  if (!['decisionTable', 'policyDecision'].includes(p.json.pattern)) throw new Error(`${path}: pattern ${p.json.pattern}`);
  const holds = (req, c) => (c.op === 'is' ? req[c.field] === c.value : c.op === 'is not' ? req[c.field] !== c.value : (() => { throw new Error(`${path}: op ${c.op}`); })());
  const decide = (req) => {
    for (const f of a.fields) if (!f.values.includes(req[f.name])) throw new Error(`${path}: ${f.name}=${req[f.name]} is outside its values`);
    return a.rules.find((r) => r.when.every((c) => holds(req, c)))?.then ?? a.otherwise;
  };
  for (const ex of a.examples) {
    const req = Object.fromEntries(ex.request.split(' ').map((v, i) => [a.fields[i].name, v]));
    if (decide(req) !== ex.response) throw new Error(`${path}: example "${ex.request}" decides ${decide(req)}, not ${ex.response}`);
  }
  let space = [{}];
  for (const f of a.fields) space = space.flatMap((r) => f.values.map((v) => ({ ...r, [f.name]: v })));
  for (const pr of a.properties ?? []) for (const req of space) {
    if (!pr.when.every((c) => holds(req, c))) continue;
    const out = decide(req);
    if (pr.kind === 'always' ? out !== pr.then : out === pr.then) throw new Error(`${path}: property "${pr.why}" fails on ${a.fields.map((f) => req[f.name]).join(' ')}`);
  }
  return { path, sha256: p.sha256, name: a.name, fields: a.fields.map((f) => f.name), outcomes: a.outcomes, decide };
}
const signalApp = app('automation/intervention-signal.prompt.json');
const admissionApp = app('automation/intervention-admission.prompt.json');
const effectApp = app('automation/intervention-effect.prompt.json');
const catalog = pinned('automation/interventions.json');
const approvals = pinned('automation/intervention-approvals.json');
const { baseline: BASELINE, window: WINDOW, e2: E2 } = catalog.json.chart;
const FILL = new Set(catalog.json.fill.aggregations);

// ---- The weekly values.
const ev = evaluate({ grain: catalog.json.grain });
const chaoss = new Map(ev.register.json.metrics.map((m) => [m.slug, m]));
const end = (period) => period.split('/')[1];
const complete = (p) => end(p.period) !== ev.cut; // the period the cut falls in is not a whole week
const keyOf = (c) => JSON.stringify([c.function ?? null, c.series.map((s) => [s.index, s.aggregation, s.field || '', s.query || ''])]);

/** An individuals chart over `xs`: the window is the last WINDOW points, the baseline every point before it. */
function chart(xs) {
  const base = xs.slice(0, -WINDOW);
  const win = xs.slice(-WINDOW);
  if (base.length < BASELINE) return { baseline: 'short', n: base.length };
  const cl = base.reduce((s, x) => s + x, 0) / base.length;
  const mr = base.slice(1).reduce((s, x, i) => s + Math.abs(x - base[i]), 0) / (base.length - 1);
  const ucl = cl + E2 * mr;
  const lcl = cl - E2 * mr;
  return { baseline: 'enough', n: base.length, cl, mr, ucl, lcl, ...tests(win, cl, ucl, lcl) };
}
/** ISO 7870-2:2023 tests 1 (on the latest point) and 2 (nine points on one side), against fixed limits. */
function tests(win, cl, ucl, lcl) {
  const last = win[win.length - 1];
  const latest = last > ucl ? 'high' : last < lcl ? 'low' : 'inside';
  const run = win.length < WINDOW ? 'none' : win.every((x) => x > cl) ? 'high' : win.every((x) => x < cl) ? 'low' : 'none';
  return { latest, run };
}

// One series per subject and computation, over the subject's complete weeks.
const series = new Map();
for (const v of ev.values) {
  const k = `${v.subject}\n${v.computation}`;
  if (!series.has(k)) series.set(k, new Map());
  series.get(k).set(v.period, v.value);
}
const denied = new Set(ev.observations.filter((o) => o.admission !== 'permit').map((o) => `${o.metric}\n${o.subject}\n${o.period}`));
const charts = [];
for (const subject of ev.subjects) {
  const weeks = ev.periods.filter((p) => p.subject === subject && complete(p));
  if (!weeks.length) { refuse('subject', subject, 'no-complete-week', 'every item of this subject falls in the week the cut ends'); continue; }
  for (const [ci, c] of ev.computations.entries()) {
    const metrics = ev.bound.filter((b) => b.uses.some((u) => u.computation === ci)).map((b) => b.metric);
    const got = series.get(`${subject}\n${ci}`);
    if (!got) continue; // the subject has no item this computation reads
    const id = `${subject}|${keyOf(c)}`;
    const fills = !c.function && c.series.length === 1 && FILL.has(c.series[0].aggregation);
    const blocked = weeks.find((p) => !got.has(p.period) && metrics.some((m) => denied.has(`${m}\n${subject}\n${p.period}`)));
    if (blocked) { refuse('chart', id, 'not-admitted', `an observation of ${blocked.period} is not permitted, so its value is unknown, not 0`); continue; }
    const gap = !fills && weeks.find((p) => !got.has(p.period));
    if (gap) { refuse('chart', id, 'gapped', `${c.label}: ${c.series[0].aggregation} of no items has no value, and ${gap.period} has none`); continue; }
    const xs = weeks.map((p) => got.get(p.period) ?? 0);
    const ch = chart(xs);
    const request = { baseline: ch.baseline, latest: ch.latest ?? 'inside', run: ch.run ?? 'none' };
    charts.push({
      id, subject, computation: ci, key: keyOf(c), label: c.label, metrics,
      from: weeks[0].period.split('/')[0], window: weeks[Math.max(0, weeks.length - WINDOW)].period.split('/')[0], week: weeks[weeks.length - 1].period, values: xs,
      limits: ch.baseline === 'enough' ? { n: ch.n, cl: round(ch.cl), mr: round(ch.mr), ucl: round(ch.ucl), lcl: round(ch.lcl) } : { n: ch.n },
      request, signal: signalApp.decide(request),
    });
  }
}

// ---- Proposals: each catalog action, for each chart whose signal and computation it names.
const approved = new Map(approvals.json.approvals.map((a) => [a.proposal, a]));
const proposalId = (action, ch, signal, week) => `iv-${sha256(JSON.stringify([action, ch.id, week, signal])).slice(0, 16)}`;
const named = (c, ch) => { const s = ev.computations[ch.computation].series; return s.length === 1 && s[0].index === c.index && s[0].aggregation === c.aggregation && (s[0].field || '') === c.field; };
const names = (cs) => (cs === 'any' ? () => true : (ch) => cs.some((c) => named(c, ch)));
const fill = (text, ch, cs) => {
  const metric = cs === 'any' ? null : chaoss.get(cs.find((c) => named(c, ch)).metric);
  const t = [ch.request.latest !== 'inside' && `test 1, the latest week is ${ch.request.latest === 'high' ? 'above the upper' : 'below the lower'} control limit`, ch.request.run !== 'none' && `test 2, nine weeks ${ch.request.run === 'high' ? 'above' : 'below'} the centre line`].filter(Boolean).join('; ');
  const sub = {
    label: ch.label, subject: ch.subject, week: ch.week.split('/')[0], since: ch.request.latest !== 'inside' ? ch.week.split('/')[0] : ch.window, moved: ch.signal === 'rise' ? 'rose' : 'fell', tests: `ISO 7870-2 ${t}`,
    cl: ch.limits.cl, ucl: ch.limits.ucl, lcl: ch.limits.lcl, latest: ch.values[ch.values.length - 1],
    metrics: ch.metrics.map((m) => chaoss.get(m)?.title ?? m).join(', '),
    metric: metric?.title, question: metric?.question,
  };
  return text.replace(/\{(\w+)\}/g, (_, k) => String(sub[k]));
};
const proposals = [];
for (const ch of charts) {
  if (ch.signal !== 'rise' && ch.signal !== 'fall') continue;
  for (const a of catalog.json.actions) {
    if (!a.signals.includes(ch.signal) || !names(a.computations)(ch)) continue;
    const id = proposalId(a.name, ch, ch.signal, ch.week);
    const request = { signal: ch.signal, reach: a.reach, approval: approved.has(id) ? 'exact' : 'none' };
    proposals.push({ id, action: a.name, reach: a.reach, chart: ch.id, subject: ch.subject, week: ch.week, signal: ch.signal, request, admission: admissionApp.decide(request), text: fill(a.text, ch, a.computations) });
  }
}

// ---- Effects: each approval Alex records as enacted, judged against the limits frozen at its signal, over the
// first WINDOW complete weeks from enactment.
function effectRequest(signal, frozen, post) {
  const t = tests(post.slice(0, WINDOW), frozen.cl, frozen.ucl, frozen.lcl);
  return { signal, after: signalApp.decide({ baseline: 'enough', ...t }), span: post.length >= WINDOW ? 'full' : 'partial' };
}
const effects = [];
for (const a of approvals.json.approvals) {
  const ch = charts.find((c) => c.id === a.chart);
  if (!ch) { refuse('approval', a.proposal, 'no-chart', 'the approval names a chart this register does not draw'); continue; }
  if (proposalId(a.action, ch, a.signal, a.week) !== a.proposal) { refuse('approval', a.proposal, 'id-mismatch', 'the approval\'s action, chart, week and signal do not derive its proposal id'); continue; }
  if (!a.enacted) continue;
  const weeks = ev.periods.filter((p) => p.subject === ch.subject && complete(p)).map((p) => p.period);
  const at = weeks.indexOf(a.week);
  if (at < 0) { refuse('approval', a.proposal, 'no-week', `${a.week} is not a complete week of ${ch.subject}`); continue; }
  const frozen = chart(ch.values.slice(0, at + 1));
  if (frozen.baseline !== 'enough') { refuse('approval', a.proposal, 'no-limits', 'the chart had no control limits at the approved week'); continue; }
  const post = weeks.map((w, i) => [w, ch.values[i]]).filter(([w]) => w.split('/')[0] >= a.enacted.slice(0, 10)).map(([, x]) => x);
  if (!post.length) { effects.push({ proposal: a.proposal, enacted: a.enacted, weeks: 0, effect: 'pending' }); continue; }
  const request = effectRequest(a.signal, frozen, post);
  effects.push({ proposal: a.proposal, enacted: a.enacted, weeks: Math.min(post.length, WINDOW), request, effect: effectApp.decide(request) });
}

// ---- Untreated: every signal onset in each chart's history, judged by the same effect app over the WINDOW weeks
// that followed it with no intervention. It is the comparison an enacted intervention's effect is read against:
// an intervention is evidence only where its effects differ from what untreated signals did.
const untreated = [];
for (const ch of charts) {
  let before = null;
  for (let t = BASELINE + WINDOW - 1; t < ch.values.length - 1; t++) {
    const at = chart(ch.values.slice(0, t + 1));
    const s = signalApp.decide({ baseline: at.baseline, latest: at.latest ?? 'inside', run: at.run ?? 'none' });
    const onset = (s === 'rise' || s === 'fall') && s !== before;
    before = s;
    if (!onset) continue;
    const request = effectRequest(s, at, ch.values.slice(t + 1));
    untreated.push({ chart: ch.id, at: t, signal: s, request, effect: effectApp.decide(request) });
  }
}

// ---- The register.
const tally = (xs, k, vs) => Object.fromEntries(vs.map((v) => [v, xs.filter((x) => x[k] === v).length]));
const counts = {
  charts: charts.length, signal: tally(charts, 'signal', signalApp.outcomes),
  proposals: proposals.length, admission: tally(proposals, 'admission', admissionApp.outcomes),
  effects: effects.length,
  untreated: Object.fromEntries(['rise', 'fall'].map((s) => [s, tally(untreated.filter((u) => u.signal === s), 'effect', effectApp.outcomes)])),
  refusals: refusals.length,
};
const body = {
  spec: 'uor-community/interventions-register/1',
  standards: ['ISO 7870-2:2023', 'ISO 8601-1:2019 time intervals', 'OMG DMN 1.5 hit policy FIRST', 'OASIS XACML 3.0 first-applicable', 'ISO/IEC 15939:2017'],
  corpus: { path: ev.corpus.path, sha256: ev.corpus.sha256, cut: ev.cut },
  inputs: [ev.sources, ev.replay, ev.register, ev.methods, ev.agents, catalog, approvals].filter(Boolean).map(({ path, sha256: d }) => ({ path, sha256: d }))
    .concat([ev.admission, ev.attribution].map(({ path, sha256: d }) => ({ path, sha256: d }))),
  apps: [signalApp, admissionApp, effectApp].map(({ path, sha256: d, name, fields, outcomes }) => ({ path, sha256: d, name, fields, outcomes })),
  grain: catalog.json.grain,
  chart: { baseline: BASELINE, window: WINDOW, e2: E2 },
  counts,
  charts,
  proposals,
  effects,
  untreated,
  refusals,
};
const out = JSON.stringify({ sha256: sha256(JSON.stringify(body)), ...body }, null, 1) + '\n';
const target = join(here, 'register.json');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
      process.stderr.write('interventions/register.json is not the projection of the observations and the intervention policy\n');
      process.exit(1);
    }
  } else writeFileSync(target, out);
  process.stdout.write(`${counts.charts} charts ${JSON.stringify(counts.signal)}, ${counts.proposals} proposals ${JSON.stringify(counts.admission)}, ${counts.effects} effects, untreated ${JSON.stringify(counts.untreated)}, ${counts.refusals} refusals\n`);
}
