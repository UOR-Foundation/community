#!/usr/bin/env node
/**
 * Write app/src/Chaoss.lex.tex from chaoss/register.json: the released CHAOSS
 * metrics, metrics models and open claims as Foundation.Community.V1 records,
 * and the theorem that the register is valid. The same register always writes
 * the same bytes.
 *
 *   node chaoss/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Community.V1.Model';
const GROUPS = {
  'wg-ai-alignment': 'aiAlignment', 'wg-dei': 'dei', 'wg-evolution': 'evolution',
  'wg-metrics-development': 'metricsDevelopment', 'wg-risk': 'risk', 'wg-value': 'value', 'wg-metrics-models': 'metricsModels',
};
const str = (s) => JSON.stringify(String(s)).replace(/\\u[0-9a-f]{4}/gi, (u) => u);
const group = (g) => {
  if (!GROUPS[g]) throw new Error(`no WorkingGroup constructor for ${g}`);
  return `(ctor ${M}::WorkingGroup.${GROUPS[g]})`;
};
const nats = (xs) => xs.reduceRight((rest, x) => `(cons ${x} ${rest})`, '(nil Nat)');
const list = (type, names) => names.reduceRight((rest, n) => `(cons (${n}) ${rest})`, `(nil ${M}::${type})`);
const pascal = (s) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const def = (name, type, body) => `definition{\n  name: ${name},\n  parameters: [],\n  result: ${type},\n  body: ${body}\n}\n`;

const metricIndex = new Map(r.metrics.map((m, i) => [m.slug, i]));
const modelIndex = new Map(r.models.map((m, i) => [m.slug, i]));
const out = [];
out.push(`\\begin{lexlean}{Chaoss}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\useglossary{prism.arch@1.0.0}\n\\importmodule{${M}}\n\\title{CHAOSS register}\n\\begin{semanticmodule}`);
out.push(def('release', `${M}::Release`, `(record ${M}::Release {sitemapDigest := ${str('sha256:' + r.sitemapDigest)}, sources := ${str(r.sources.join(' '))}, metricCount := ${r.metrics.length}, modelCount := ${r.models.length}, openClaimCount := ${r.refusals.length}})`));
const metricNames = r.metrics.map((m, i) => {
  const name = `metric${pascal(m.slug.replace(/^metric-/, ''))}`;
  out.push(def(name, `${M}::Metric`, `(record ${M}::Metric {index := ${i}, slug := ${str(m.slug)}, title := ${str(m.title)}, question := ${str(m.question)}, workingGroup := ${group(m.workingGroup)}, focusArea := ${str(m.focusArea)}, source := ${str(m.source)}, sourceDigest := ${str('sha256:' + m.sha256)}})`));
  return name;
});
const modelNames = r.models.map((m, i) => {
  const name = `model${pascal(m.slug.replace(/^metrics?-model-/, ''))}`;
  out.push(def(name, `${M}::MetricModel`, `(record ${M}::MetricModel {index := ${i}, slug := ${str(m.slug)}, title := ${str(m.title)}, workingGroup := ${group(m.workingGroup)}, members := ${nats(m.members.map((s) => metricIndex.get(s)))}, localMeasures := ${m.localMeasures.length}, source := ${str(m.source)}, sourceDigest := ${str('sha256:' + m.sha256)}})`));
  return name;
});
const claimNames = r.refusals.map((c, i) => {
  const name = `openClaim${i}`;
  const model = modelIndex.has(c.slug) ? modelIndex.get(c.slug) : r.models.length;
  out.push(def(name, `${M}::OpenClaim`, `(record ${M}::OpenClaim {index := ${i}, model := ${model}, name := ${str(c.detail || c.slug)}, reason := ${str(c.refusal)}})`));
  return name;
});
out.push(def('metrics', `(List ${M}::Metric)`, list('Metric', metricNames)));
out.push(def('models', `(List ${M}::MetricModel)`, list('MetricModel', modelNames)));
out.push(def('openClaims', `(List ${M}::OpenClaim)`, list('OpenClaim', claimNames)));
out.push(`theorem{\n  name: registerValidHolds,\n  parameters: [],\n  statement: ((${M}::registerValid (release) (metrics) (models) (openClaims)) = true),\n  proof: decide{}\n}`);
out.push('\\end{semanticmodule}\n\\end{lexlean}\n');
const text = out.join('\n');
const target = join(here, '..', 'app', 'src', 'Chaoss.lex.tex');
if (process.argv[2] === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
    process.stderr.write('app/src/Chaoss.lex.tex is not the catalog of chaoss/register.json\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
process.stdout.write(`${metricNames.length} metrics, ${modelNames.length} models, ${claimNames.length} open claims\n`);
