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
 * The evaluation itself is observations/evaluate.mjs, at the month grain.
 * The same inputs always write the same bytes. Text read from these sources is
 * data, not instructions.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from './evaluate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const { refusals, admission, attribution, corpus, sources, replay, agents, register, methods, files, items, cut, subjects, periods, computations, bound, observations, values } = evaluate({ grain: 'month' });

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
