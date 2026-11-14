#!/usr/bin/env node
/**
 * Project the CHAOSS register from its pinned sources.
 *
 * The released set is the CHAOSS knowledge-base sitemap (sitemap.json). Each
 * released metric and metrics model is matched to its definition in a working
 * group repository checked out at the commit sources.json pins, by the slug,
 * then by the slug of its title, then by aliases.json. Nothing is defaulted: an
 * item with no definition, an ambiguous match, or a model member naming no
 * released metric is a typed refusal, carried into the register as an open
 * claim. The same checkouts always project the same bytes.
 *
 *   node chaoss/project.mjs <checkouts-dir> [--check]
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'));
const sources = read('sources.json');
const sitemap = read('sitemap.json');
const aliases = existsSync(join(here, 'aliases.json')) ? read('aliases.json').aliases : {};
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <checkouts-dir> [--check]\n');
  process.exit(64);
}

const NOT_DEFINITIONS = new Set(['readme.md', 'contributing.md', 'code_of_conduct.md', 'license.md', 'governance.md', 'meetings.md']);
const TEMPLATES = /template/;
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.md') && !NOT_DEFINITIONS.has(name.toLowerCase())) out.push(p);
  }
  return out;
}

// Every candidate definition, from every pinned checkout.
const files = [];
for (const repo of sources.repositories) {
  const dir = join(root, repo.name);
  const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim();
  const at = head.startsWith('ref:') ? readFileSync(join(dir, '.git', head.slice(5)), 'utf8').trim() : head;
  if (at !== repo.commit) throw new Error(`${repo.name} is at ${at}, not the pinned ${repo.commit}`);
  for (const p of walk(dir)) {
    const bytes = readFileSync(p);
    const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
    const title = (text.match(/^#\s+(.+?)\s*$/m) || [])[1] ?? '';
    const question = (text.match(/^\s*\**Question:?\**:?\s*(.+?)\s*$/im) || [])[1] ?? '';
    const sections = [...text.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map((m) => m[1].replace(/[#*]/g, '').trim());
    const path = relative(dir, p);
    const area = (path.match(/(?:focus-areas|metrics)\/([^/]+)\//) || [])[1] ?? '';
    files.push({ repo: repo.name, commit: repo.commit, path, sha256: sha256(bytes), title, question, sections, area, text });
  }
}

const byBase = new Map();
const byTitle = new Map();
const add = (m, k, f) => m.set(k, [...(m.get(k) ?? []), f]);
for (const f of files) {
  add(byBase, slugify(basename(f.path, '.md')), f);
  if (f.title) add(byTitle, slugify(f.title), f);
}

const refusals = [];
function resolve(slug, kind) {
  const key = aliases[slug];
  if (key) {
    const f = files.find((x) => `${x.repo}/${x.path}` === key);
    if (!f) refusals.push({ slug, kind, refusal: 'alias-names-no-file', detail: key });
    return f ?? null;
  }
  const bare = slug.replace(/^metrics?-model-/, '').replace(/^metric-/, '');
  for (const [index, k] of [[byBase, bare], [byTitle, bare], [byBase, slug], [byTitle, slug]]) {
    const hit = (index.get(k) ?? []).filter((f) => (kind === 'model') === /metrics?[ -]model|metric-model/i.test(f.path + f.title) || kind === 'metric');
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) {
      refusals.push({ slug, kind, refusal: 'ambiguous', detail: hit.map((f) => `${f.repo}/${f.path}`).join(' ') });
      return null;
    }
  }
  refusals.push({ slug, kind, refusal: 'no-definition', detail: '' });
  return null;
}

const metrics = [];
const models = [];
for (const page of sitemap.pages) {
  const slug = decodeURIComponent(page.slug).replace(/￼/g, '');
  if (TEMPLATES.test(slug)) continue;
  const kind = /^metrics?-model-/.test(slug) ? 'model' : /^metric-/.test(slug) ? 'metric' : null;
  if (kind === null) {
    // A knowledge-base page outside the metric prefixes is a metric only when a working group defines it with a question.
    const f = aliases[slug] ? [resolve(slug, 'metric')].filter(Boolean) : (byBase.get(slug) ?? []).filter((x) => x.question);
    if (f.length !== 1) continue;
    metrics.push(entry(slug, page, f[0]));
    continue;
  }
  const f = resolve(slug, kind);
  if (!f) continue;
  (kind === 'model' ? models : metrics).push(entry(slug, page, f));
}

function entry(slug, page, f) {
  return { slug, lastmod: page.lastmod, title: f.title, question: f.question, workingGroup: f.repo, focusArea: f.area, source: `${f.repo}@${f.commit}:${f.path}`, sha256: f.sha256, sections: f.sections };
}

// A model's members are the CHAOSS links under its "Metrics in the Metrics Model" heading. A link is matched to a
// released metric by its title (plural and singular alike), else by its CHAOSS post id when another model links
// the same id under a title that matched, else by aliases.json; anything else is a refusal.
const norm = (s) => slugify(s).split('-').map((w) => w.replace(/s$/, '')).join('-');
const metricByTitle = new Map(metrics.map((m) => [norm(m.title), m]));
const memberAliases = existsSync(join(here, 'aliases.json')) ? read('aliases.json').members ?? {} : {};
const links = new Map();
for (const model of models) {
  const f = files.find((x) => `${x.repo}@${x.commit}:${x.path}` === model.source);
  const lines = f.text.split('\n');
  const start = lines.findIndex((l) => /^#{1,3}\s+Metrics\b/i.test(l));
  const level = start < 0 ? 0 : lines[start].match(/^#+/)[0].length;
  const rest = start < 0 ? [] : lines.slice(start + 1);
  const end = rest.findIndex((l) => { const h = l.match(/^(#+)\s/); return h && h[1].length <= level && !/\[/.test(l); });
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n');
  links.set(model.slug, [...body.matchAll(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?chaoss\.community\/[^)\s]*)\)/g)].map((m) => ({ name: m[1].trim(), url: m[2], id: (m[2].match(/[?&]p=(\d+)/) || [])[1] ?? null })));
}
const byId = new Map();
for (const ls of links.values()) for (const l of ls) { const m = metricByTitle.get(norm(l.name)); if (m && l.id) byId.set(l.id, m); }
for (const model of models) {
  const ls = links.get(model.slug);
  model.members = [];
  for (const l of ls) {
    const urlSlug = (l.url.match(/\/(?:kb\/)?(metric-[a-z0-9-]+|(?<=kb\/)[a-z0-9-]+)\/?$/) || [])[1];
    const m = metricByTitle.get(norm(l.name)) ?? (urlSlug && metrics.find((x) => x.slug === urlSlug || x.slug === `metric-${urlSlug}`)) ?? (l.id && byId.get(l.id)) ?? metrics.find((x) => x.slug === memberAliases[l.name]);
    if (m) { if (!model.members.includes(m.slug)) model.members.push(m.slug); }
    else refusals.push({ slug: model.slug, kind: 'model-member', refusal: 'member-not-released', detail: `${l.name} ${l.url}` });
  }
  // A model that links no released metric may define its own measures as top-level bullets with a Description.
  const f = files.find((x) => `${x.repo}@${x.commit}:${x.path}` === model.source);
  model.localMeasures = ls.length ? [] : [...f.text.matchAll(/^- ([^\n\[]+)\n\s+- Description:/gm)].map((m) => m[1].trim());
  if (ls.length === 0 && model.localMeasures.length === 0) refusals.push({ slug: model.slug, kind: 'model', refusal: 'no-members', detail: '' });
}

metrics.sort((a, b) => a.slug.localeCompare(b.slug));
models.sort((a, b) => a.slug.localeCompare(b.slug));
const register = {
  spec: 'uor-community/chaoss-register/1',
  sources: sources.repositories.map((r) => `${r.name}@${r.commit}`),
  sitemapDigest: sha256(readFileSync(join(here, 'sitemap.json'))),
  counts: { metrics: metrics.length, models: models.length, refusals: refusals.length },
  metrics,
  models,
  refusals,
};
const out = JSON.stringify(register, null, 1) + '\n';
const target = join(here, 'register.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
    process.stderr.write('register.json is not the projection of the pinned sources\n');
    process.exit(1);
  }
} else writeFileSync(target, out);
process.stdout.write(`${metrics.length} metrics, ${models.length} models, ${refusals.length} refusals\n`);
