#!/usr/bin/env node
/**
 * Write one indicator prompt per CHAOSS metrics model in chaoss/register.json,
 * and apps/set.json listing every prompt in apps/. The same register always
 * writes the same bytes.
 *
 *   node apps/indicators.mjs [--check]
 *
 * An indicator is ISO/IEC 15939's: a measure, derived from base measures by an
 * analysis model, read against decision criteria for an information need. The
 * information need is the metrics model's own; its base measures are the
 * model's metrics (or, for a model that defines its own measures, those). The
 * CHAOSS models publish no thresholds over their metrics' values, so the only
 * decision criterion the source supports is whether every base measure has an
 * observation admitted by uor-observation-admission. That is what the
 * indicator decides, from two counts: the metrics with an admitted
 * observation, and the metrics whose observation was refused. A member the
 * register could not match to a released metric is an open claim (CC-03), and
 * it counts as refused, so that model is never answered complete.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes('--check');
const register = JSON.parse(readFileSync(join(here, '..', 'chaoss', 'register.json'), 'utf8'));
const titleOf = new Map(register.metrics.map((m) => [m.slug, m.title]));
const PREFIX = 'chaoss-';

const c = (field, op, value) => ({ field, op, value });
const committee = {
  name: 'Community and Outreach Committee',
  text: 'Reads the CHAOSS metrics models of the Foundation\'s community and needs every number behind them validated.',
  concerns: ['Correct answers', 'Proved guarantees'],
};

function indicator(model) {
  const short = model.slug.replace(/^metrics-model-/, '');
  const name = `${PREFIX}${short}`;
  const title = model.title.replace(/^Metrics Model:\s*/, '');
  const open = register.refusals.filter((r) => r.slug === model.slug && r.kind === 'model-member');
  const measures = model.members.length ? model.members.map((s) => titleOf.get(s)) : model.localMeasures.map((m) => m.title ?? m);
  const n = measures.length + open.length;
  const what = model.members.length ? 'metrics' : 'measures';
  const source = `${model.source} (sha256:${model.sha256})`;
  return {
    schema: 'prism/prompt/1',
    pattern: 'decisionTable',
    goal: `Tell whether the information need of the CHAOSS metrics model ${title} is answered for the UOR Foundation community.`,
    repository: 'UOR-Foundation/community',
    app: {
      name,
      title: `${title} indicator`.slice(0, 120),
      purpose: `The ISO/IEC 15939 indicator of the CHAOSS metrics model ${title}: from how many of its ${n} ${what} have an admitted observation and how many were refused, tell whether its information need is answered, partly answered, unmeasured or an open claim.`,
      fields: [
        { name: 'admitted', kind: 'number', min: 0, max: n, means: `how many of the model's ${n} ${what} have an observation uor-observation-admission permitted: ${[...measures, ...open.map((r) => r.detail)].join('; ')}` },
        { name: 'refused', kind: 'number', min: open.length, max: n, means: `how many of them had their observation refused${open.length ? `, counting the ${open.length} member${open.length === 1 ? '' : 's'} the register carries as an open claim` : ''}` },
      ],
      outcomes: ['open', 'complete', 'unmeasured', 'partial'],
      meanings: {
        open: 'a base measure was refused, so the information need stays an open claim',
        complete: `every one of the ${n} ${what} has an admitted observation, so the information need is answered`,
        unmeasured: 'no base measure has an admitted observation yet',
        partial: 'some base measures have admitted observations and none was refused',
      },
      rules: [
        { when: [c('refused', '>=', 1)], then: 'open', why: 'AGENTS.md R2: a refused observation is measured and reported, never restated as an answer; CC-03 carries an unmatched member the same way' },
        { when: [c('admitted', '>=', n)], then: 'complete', why: `ISO/IEC 15939 indicator: every base measure of ${source} has an admitted measurement` },
        { when: [c('admitted', '=', 0)], then: 'unmeasured', why: 'ISO/IEC 15939: an indicator with no base measure measured answers no information need' },
      ],
      otherwise: 'partial',
      otherwiseWhy: 'some base measures are admitted, none refused and some not yet observed',
      properties: [
        { kind: 'never', when: [c('refused', '>=', 1)], then: 'complete', why: 'an information need with a refused base measure is never answered complete' },
        { kind: 'never', when: [c('admitted', '<', n)], then: 'complete', why: 'an information need is answered complete only when every base measure is admitted' },
        { kind: 'always', when: [c('refused', '=', 0), c('admitted', '>=', n)], then: 'complete', why: 'every base measure admitted and none refused answers the information need' },
        { kind: 'never', when: [c('admitted', '>=', 1), c('refused', '=', 0)], then: 'unmeasured', why: 'an admitted base measure is never reported unmeasured' },
      ],
      examples: [
        { request: `${n} ${open.length}`, response: open.length ? 'open' : 'complete' },
        { request: `${n - 1} ${open.length}`, response: open.length ? 'open' : 'partial' },
        { request: `0 ${open.length}`, response: open.length ? 'open' : 'unmeasured' },
        { request: `1 ${Math.max(1, open.length)}`, response: 'open' },
      ],
    },
    stakeholders: [committee],
    components: [{ name: 'CHAOSS observation admission', kind: 'service', text: 'The uor-observation-admission app, whose permitted observations are the indicator\'s admitted count.' }],
    journeys: [{ stakeholder: committee.name, steps: ['REQ-001', 'REQ-002', 'REQ-003', 'otherwise'] }],
  };
}

const files = new Map();
for (const model of register.models) {
  const p = indicator(model);
  files.set(join(here, `${p.app.name}.prompt.json`), `${JSON.stringify(p, null, 2)}\n`);
}
const stale = [...readdirSync(here)].filter((f) => f.startsWith(PREFIX) && f.endsWith('.prompt.json') && !files.has(join(here, f)));
const prompts = [...new Set([...readdirSync(here).filter((f) => f.endsWith('.prompt.json') && !stale.includes(f)), ...[...files.keys()].map((p) => p.slice(here.length + 1))])].sort();
const setPath = join(here, 'set.json');
const set = JSON.parse(readFileSync(setPath, 'utf8'));
files.set(setPath, `${JSON.stringify({ ...set, prompts }, null, 2)}\n`);

let differs = stale.map((f) => `stale: apps/${f}`);
for (const [path, text] of files) {
  let now;
  try {
    now = readFileSync(path, 'utf8');
  } catch {}
  if (now === text) continue;
  if (check) differs.push(`differs: ${path.slice(here.length - 4)}`);
  else writeFileSync(path, text);
}
if (check && differs.length) {
  for (const d of differs) console.error(d);
  process.exit(1);
}
if (!check && stale.length) for (const f of stale) console.error(`remove apps/${f}: its metrics model is no longer in the register`);
console.log(`${register.models.length} indicators, ${prompts.length} prompts in apps/set.json${check ? ', all current' : ''}`);
