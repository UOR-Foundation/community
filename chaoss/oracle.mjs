#!/usr/bin/env node
/**
 * Close the ISO/IEC 15939 elements the CHAOSS templates leave open from what
 * the CHAOSS oracle, GrimoireLab, actually computes.
 *
 * Every step follows a reference one of the parties states; nothing is read
 * from prose:
 *
 *   1. A CHAOSS definition (pinned, sha256-checked) links a GrimoireLab Sigils
 *      panel, by its documentation page or by its Kibana dashboard id. The
 *      citing line is recorded by number and sha256.
 *   2. The link resolves to the Sigils dashboard file: a documentation page by
 *      its [dashboard] reference (following the renames Sigils' own history
 *      records), a Kibana id by the one dashboard carrying it.
 *   3. A visualization measures the metric only when the implementation names
 *      it: its title, an aggregation's label or a Timelion series label holds
 *      the metric's title as a word sequence, or equals a term the citing line
 *      emphasizes. Every computation in the selected visualizations is parsed:
 *      Kibana aggregations, and Timelion .es() series.
 *   4. The index each computation reads is a sirmordred alias; the alias names
 *      its data source, the data source names its ELK enricher and Perceval
 *      backend (grimoire_elk/utils.py), and those name the entity: the
 *      item_type the enricher assigns under the computation's pull_request
 *      filter, or the backend's single category. The attribute is the field
 *      aggregated, cited by its ELK schema row, the enricher line that assigns
 *      it, or the index pattern's scripted field. Units are UCUM: a count of
 *      items is {<entity>}, a field computed by get_time_diff_days or a script
 *      dividing minutes by 1440 is d. Counts and those durations are on the
 *      ratio scale.
 *
 * An element resolves only when every selected computation agrees on it; any
 * disagreement, unparsed computation or missing reference is a typed refusal
 * that stays an open claim, with the candidates it saw.
 *
 *   node chaoss/oracle.mjs <checkouts-dir> [--check]   project chaoss/oracle-methods.json
 *   node chaoss/oracle.mjs [--check]                   check it is the projection of the measurement it was made from
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const root = args.find((a) => a !== '--check');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const outPath = join(here, 'oracle-methods.json');
const measurementPath = join(here, 'measurement.json');

if (!root) {
  const o = JSON.parse(readFileSync(outPath, 'utf8'));
  if (o.measurement !== sha256(readFileSync(measurementPath))) {
    process.stderr.write('chaoss/oracle-methods.json was projected from another chaoss/measurement.json; rerun with the checkouts\n');
    process.exit(1);
  }
  process.stdout.write(`${o.counts.resolved} elements resolved by the oracle, ${o.counts.open} open\n`);
  process.exit(0);
}

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const sources = JSON.parse(readFileSync(join(here, 'oracle-sources.json'), 'utf8'));
// Every repository is fetched by commit; the release's src/ tree must pin each component at that commit.
const dirs = {};
const pins = {};
for (const r of sources.repositories) {
  const dir = join(root, r.name);
  const at = git(dir, 'rev-parse', 'HEAD').trim();
  if (at !== r.commit) throw new Error(`${r.name} is at ${at}, not the pinned ${r.commit}`);
  dirs[r.name] = dir;
  pins[r.name] = r.commit;
}
if (pins[sources.release.name] !== sources.release.commit) throw new Error('the release repository is not pinned at the release commit');
for (const line of git(dirs[sources.release.name], 'ls-tree', sources.release.commit, 'src/').trim().split('\n')) {
  const [, , commit, path] = line.split(/\s+/);
  const name = path.replace(/^src\//, '');
  if (pins[name] && pins[name] !== commit) throw new Error(`${name} is pinned at ${pins[name]}, but ${sources.release.name} ${sources.release.tag} pins ${commit}`);
}

const files = new Map();
const file = (repo, path) => {
  const k = `${repo}:${path}`;
  if (!files.has(k)) {
    const bytes = readFileSync(join(dirs[repo], path));
    files.set(k, { sha: sha256(bytes), text: bytes.toString('utf8'), lines: bytes.toString('utf8').split('\n') });
  }
  return files.get(k);
};
/** A citation of one line of a pinned file, found by its exact text. */
const cite = (repo, path, text) => {
  const f = file(repo, path);
  const hits = f.lines.flatMap((l, i) => (l.trim() === text ? [i + 1] : []));
  if (hits.length !== 1) return null;
  return { source: `${repo}@${pins[repo]}:${path}#L${hits[0]}`, digest: sha256(f.lines[hits[0] - 1].trim()) };
};
const citeObject = (repo, path, id, value) => ({ source: `${repo}@${pins[repo]}:${path}#${id}`, digest: sha256(value) });

// ---- Sigils: dashboards by file and by id, documentation pages, renames. ----
const SIG = 'grimoirelab-sigils';
const panelFiles = [];
const walk = (rel) => {
  for (const e of readdirSync(join(dirs[SIG], rel), { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(rel, e.name));
    else if (e.name.endsWith('.json')) panelFiles.push(join(rel, e.name));
  }
};
walk('panels/json'); walk('chaoss-gmd-cde');
const dashboardById = new Map();
const indexPatterns = new Map();
for (const p of panelFiles) {
  const d = JSON.parse(file(SIG, p).text);
  if (d.dashboard) dashboardById.set(d.dashboard.id, [...(dashboardById.get(d.dashboard.id) ?? []), p]);
  for (const ip of d.index_patterns ?? []) indexPatterns.set(ip.id, { file: p, ...ip });
}
const renames = new Map();
for (const l of git(dirs[SIG], 'log', '--format=', '--name-status', '--diff-filter=R', '-M100%', pins[SIG]).split('\n')) {
  const m = l.match(/^R100\t(\S+)\t(\S+)$/);
  if (m && !renames.has(m[1])) renames.set(m[1], m[2]);
}
const follow = (p) => { const seen = new Set(); while (!existsSync(join(dirs[SIG], p)) && renames.has(p) && !seen.has(p)) { seen.add(p); p = renames.get(p); } return existsSync(join(dirs[SIG], p)) ? p : null; };

function resolveLink(url) {
  const id = url.match(/chaoss\.biterg\.io\/app\/kibana#\/dashboard\/([^?#\s]+)/);
  if (id) {
    const hit = dashboardById.get(decodeURIComponent(id[1])) ?? [];
    // The Kibana and OpenSearch exports of one dashboard carry one id; the Kibana JSON is the one Sigils documents.
    const kib = hit.filter((p) => p.endsWith('.json'));
    return kib.length === 1 ? { file: kib[0], via: `kibana-dashboard-id:${decodeURIComponent(id[1])}` } : { refusal: kib.length ? 'dashboard-id-ambiguous' : 'dashboard-id-unknown' };
  }
  const page = url.match(/chaoss\.github\.io\/grimoirelab-sigils\/([a-z0-9_-]+)\/([a-z0-9_.-]+)\/?$/i);
  if (!page) return { refusal: 'not-a-panel-page' };
  const md = `docs/_${page[1]}/${page[2]}.md`;
  if (!existsSync(join(dirs[SIG], md))) return { refusal: 'panel-page-unknown' };
  const ref = file(SIG, md).text.match(/^\[dashboard\]: https:\/\/raw\.githubusercontent\.com\/chaoss\/grimoirelab-sigils\/master\/(\S+)$/m);
  if (!ref) return { refusal: 'panel-page-without-dashboard' };
  const p = follow(ref[1]);
  return p ? { file: p, via: `${SIG}@${pins[SIG]}:${md}` } : { refusal: 'panel-file-missing' };
}

// ---- Computations: Kibana aggregations and Timelion series. ----
const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const holds = (hay, needle) => { const h = words(hay); const n = words(needle); return n.length > 0 && h.some((_, i) => n.every((w, j) => h[i + j] === w)); };
const parseQuery = (q) => { const m = String(q ?? '').match(/\bpull_request:(true|false)\b/); return m ? m[1] === 'true' : undefined; };
const filterFlag = (filters = []) => {
  let v;
  for (const f of filters) if (f?.meta?.key === 'pull_request' && !f.meta.disabled) { const x = String(f.meta.params?.query ?? f.meta.value) === 'true'; v = f.meta.negate ? !x : x; }
  return v;
};
const indexTitle = (ref) => (indexPatterns.has(ref) ? indexPatterns.get(ref).value.title : ref);

function computations(dashFile) {
  const d = JSON.parse(file(SIG, dashFile).text);
  const dss = JSON.parse(d.dashboard.value.kibanaSavedObjectMeta?.searchSourceJSON || '{}');
  const searches = new Map((d.searches ?? []).map((s) => [s.id, JSON.parse(s.value.kibanaSavedObjectMeta?.searchSourceJSON || '{}')]));
  const out = [];
  for (const v of d.visualizations ?? []) {
    const vs = JSON.parse(v.value.visState);
    const ss = JSON.parse(v.value.kibanaSavedObjectMeta?.searchSourceJSON || '{}');
    const saved = v.value.savedSearchId ? searches.get(v.value.savedSearchId) ?? {} : {};
    const index = indexTitle(ss.index ?? saved.index ?? '');
    const flag = [parseQuery(ss.query?.query), filterFlag(ss.filter), parseQuery(saved.query?.query), filterFlag(saved.filter), filterFlag(dss.filter)].find((x) => x !== undefined);
    const query = [ss.query?.query, saved.query?.query].filter(Boolean).join(' AND ');
    const at = citeObject(SIG, dashFile, v.id, v.value.visState);
    if (vs.type === 'timelion') {
      const chains = String(vs.params.expression).split(/,\s*\n/).map((c) => c.trim()).filter(Boolean);
      for (const chain of chains) {
        const label = (chain.match(/\.label\('([^']*)'\)/) || [])[1] ?? '';
        const series = [...chain.matchAll(/\.es\(([^)]*)\)/g)].map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)=('([^']*)'|[^,\s]+)/g)].map((x) => [x[1], x[3] ?? x[2]])));
        const ops = [...chain.matchAll(/\.(divide|multiply|subtract|sum|trend|cusum|derivative|movingaverage)\(/g)].map((m) => m[1]).filter((o) => o !== 'trend');
        const parsed = series.map((s) => { const [agg, field] = (s.metric ?? 'count').split(':'); return { aggregation: agg, field: field ?? '', index: indexTitle(s.index ?? index), pullRequest: parseQuery(s.q), query: s.q ?? '', dateField: s.timefield ?? '' }; });
        if (!series.length || ops.some((o) => o !== 'divide') || (ops.length && series.length !== 2)) out.push({ vis: v.id, title: vs.title, names: [vs.title, label], unparsed: series.length ? `timelion-${ops.join('-')}` : 'timelion-without-es', at });
        else out.push({ vis: v.id, title: vs.title, names: [vs.title, label], label, series: parsed, function: ops[0] ?? null, at });
      }
      continue;
    }
    if (['markdown', 'input_control_vis'].includes(vs.type)) continue;
    const aggs = vs.aggs ?? [];
    if (!aggs.length) { out.push({ vis: v.id, title: vs.title, names: [vs.title], unparsed: vs.type, at }); continue; }
    const dateField = (aggs.find((a) => a.type === 'date_histogram')?.params?.field) ?? '';
    for (const a of aggs.filter((x) => x.schema === 'metric' || ['count', 'cardinality', 'sum', 'avg', 'median', 'percentiles', 'min', 'max'].includes(x.type) && x.schema !== 'bucket' && x.schema !== 'segment' && x.schema !== 'split')) {
      out.push({ vis: v.id, title: vs.title, names: [vs.title, a.params?.customLabel ?? ''], label: a.params?.customLabel ?? '', series: [{ aggregation: a.type, field: a.params?.field ?? '', index, pullRequest: flag, query, dateField }], function: null, at });
    }
  }
  return out;
}

// ---- The oracle's references from an index to its entity and fields. ----
const ALIASES = JSON.parse(file('grimoirelab-sirmordred', 'aliases.json').text);
const ELK = 'grimoirelab-elk';
const PERCEVAL = 'grimoirelab-perceval';
function dataSource(index) {
  // Sections of one connector that give the alias one definition (github and github:issue) are one data source.
  const sections = Object.entries(ALIASES).filter(([, v]) => (v.enrich ?? []).some((a) => a.alias === index));
  const kinds = new Set(sections.map(([k, v]) => `${k.split(':')[0]} ${JSON.stringify(v.enrich.find((a) => a.alias === index))}`));
  if (kinds.size !== 1) return { refusal: sections.length ? 'alias-spans-data-sources' : 'alias-unknown', sections: sections.map(([k]) => k) };
  const [section, v] = sections[0];
  const aliasFilter = (v.enrich.find((a) => a.alias === index).filter?.terms?.pull_request ?? [])[0];
  const connector = section.split(':')[0];
  const utils = file(ELK, 'grimoire_elk/utils.py');
  const row = utils.lines.findIndex((l) => l.trim().startsWith(`"${connector}": [`));
  if (row < 0) return { refusal: 'connector-unknown', sections: [section] };
  const [backendClass, , enrichClass] = utils.lines[row].trim().replace(/^"[^"]+": \[|\],?$/g, '').split(',').map((x) => x.trim());
  const imp = (re) => (utils.lines.find((l) => re.test(l)) || '').match(/from (\S+) import/)?.[1];
  const enricherModule = imp(new RegExp(`^from \\.enriched\\.\\w+ import .*\\b${enrichClass}\\b`));
  const backendModule = imp(new RegExp(`^from perceval\\.backends\\.core\\.\\w+ import .*\\b${backendClass}\\b`));
  if (!enricherModule || !backendModule) return { refusal: 'connector-module-unknown', sections: [section] };
  const aliasLine = file('grimoirelab-sirmordred', 'aliases.json').lines.findIndex((l) => l.includes(`"${section}": {`));
  return {
    section, aliasFilter: aliasFilter === undefined ? undefined : aliasFilter === 'true',
    enricher: `grimoire_elk/${enricherModule.replace(/^\./, '').replace(/\./g, '/')}.py`,
    backend: `${backendModule.replace(/\./g, '/')}.py`,
    cites: [
      { source: `grimoirelab-sirmordred@${pins['grimoirelab-sirmordred']}:aliases.json#L${aliasLine + 1}`, digest: sha256(JSON.stringify(v)) },
      { source: `${ELK}@${pins[ELK]}:grimoire_elk/utils.py#L${row + 1}`, digest: sha256(utils.lines[row].trim()) },
    ],
  };
}
function entityOf(ds, pullRequest) {
  const flag = pullRequest ?? ds.aliasFilter;
  if (flag !== undefined) {
    // Every place the enricher sets pull_request to the filter's value must assign one item_type on the next line.
    const en = file(ELK, ds.enricher);
    const hits = [];
    for (let i = 0; i + 1 < en.lines.length; i++) {
      const set = en.lines[i].trim().match(/^(\w+)\['pull_request'\] = (True|False)$/);
      const typ = en.lines[i + 1].trim().match(/^(\w+)\['item_type'\] = '([a-z_]+)'$/);
      if (set && (set[2] === 'True') === flag) hits.push(typ && set[1] === typ[1] ? { value: typ[2], cite: { source: `${ELK}@${pins[ELK]}:${ds.enricher}#L${i + 2}`, digest: sha256(en.lines[i + 1].trim()) } } : null);
    }
    const values = [...new Set(hits.map((h) => h?.value ?? null))];
    if (hits.length && values.length === 1 && values[0]) return { value: values[0], cites: hits.map((h) => h.cite) };
    return { refusal: 'item-type-unassigned' };
  }
  const be = file(PERCEVAL, ds.backend);
  const cats = (be.lines.find((l) => /^\s*CATEGORIES = \[/.test(l)) || '').match(/\[(.*)\]/)?.[1].split(',').map((x) => x.trim()).filter(Boolean) ?? [];
  if (cats.length !== 1) return { refusal: 'backend-has-several-categories', candidates: cats };
  const decl = be.lines.find((l) => l.startsWith(`${cats[0]} = `));
  const value = decl?.match(/= ['"]([a-z_]+)['"]/)?.[1];
  if (!value) return { refusal: 'category-undeclared' };
  return { value, cites: [cite(PERCEVAL, ds.backend, decl.trim()), cite(PERCEVAL, ds.backend, be.lines.find((l) => /^\s*CATEGORIES = \[/.test(l)).trim())] };
}
const schemaFile = (ds) => { const n = ds.section.replace(':', '_'); for (const c of [`schema/${n}.csv`, `schema/${ds.section.split(':')[0]}.csv`, `schema/${ds.section.split(':')[0]}_issues.csv`]) if (existsSync(join(dirs[ELK], c))) return c; return null; };
function attributeOf(ds, index, field, entity) {
  if (!field) return { refusal: 'count-of-items', unit: entity ? `{${entity}}` : null };
  const ip = [...indexPatterns.values()].find((p) => p.value.title === index);
  const scripted = ip && JSON.parse(ip.value.fields).find((f) => f.name === field && f.scripted);
  if (scripted) {
    const days = /\.toMinutes\(\)\/1440\.0;/.test(scripted.script) && !/return (?!Duration|0;)/.test(scripted.script.replace(/return Duration[^;]*;/g, ''));
    return { name: field, kind: 'scripted', cites: [citeObject(SIG, ip.file, `${ip.id}/fields/${field}`, scripted.script)], unit: days ? 'd' : null, type: scripted.type };
  }
  const schema = schemaFile(ds);
  const row = schema && file(ELK, schema).lines.find((l) => l.startsWith(`${field},`));
  if (!row) return { refusal: 'field-not-in-schema' };
  const type = row.split(',')[1];
  const en = file(ELK, ds.enricher);
  const k = en.lines.findIndex((l) => new RegExp(`\\['${field}'\\] = \\\\?$|\\['${field}'\\] = get_time_diff_days\\(`).test(l.trim()));
  const assign = k >= 0 ? [en.lines[k], en.lines[k + 1] ?? ''].join(' ') : '';
  const unit = /get_time_diff_days\(/.test(assign) ? 'd' : null;
  const cites = [cite(ELK, schema, row.trim())];
  if (k >= 0) cites.push({ source: `${ELK}@${pins[ELK]}:${ds.enricher}#L${k + 1}`, digest: sha256(assign.trim()) });
  if (unit) cites.push(cite(ELK, 'grimoire_elk/enriched/utils.py', 'def get_time_diff_days(start, end):'));
  return { name: field, kind: 'enriched', type, unit, cites };
}
// ISO/IEC 15939 scale of a base measure, from what the computation is: a count of items or of distinct
// values, or a duration in days (an amount of time with a true zero), is on the ratio scale.
const COUNTS = new Set(['count', 'cardinality']);
const scaleOf = (c, attr) => (COUNTS.has(c.aggregation) ? 'ratio' : attr?.unit === 'd' ? 'ratio' : null);

// ---- Project every open element of every metric. ----
const m = JSON.parse(readFileSync(measurementPath, 'utf8'));
const register = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const LINK = /https?:\/\/(?:chaoss\.github\.io\/grimoirelab-sigils\/[^\s)\]>"]*|chaoss\.biterg\.io\/app\/kibana#\/dashboard\/[^\s)\]>"?]+)/g;
const items = [];
for (const x of m.items) {
  const open = x.entries.filter((e) => e.status === 'open').map((e) => e.element);
  if (!open.length) continue;
  if (x.kind === 'model') { items.push({ index: x.index, slug: x.slug, kind: x.kind, elements: open.map((element) => ({ element, status: 'open', reason: 'oracle-computes-no-metrics-model' })) }); continue; }
  const def = register.metrics.find((r) => r.slug === x.slug);
  const [, wg, commit, path] = def.source.match(/^([^@]+)@([0-9a-f]{40}):(.+)$/);
  const bytes = readFileSync(join(root, wg, path));
  if (sha256(bytes) !== def.sha256) throw new Error(`${def.source} does not hash to the register's ${def.sha256}`);
  if (git(join(root, wg), 'rev-parse', 'HEAD').trim() !== commit) throw new Error(`${wg} is not at ${commit}`);
  const lines = bytes.toString('utf8').replace(/\r\n/g, '\n').split('\n');
  const links = [];
  lines.forEach((l, i) => { for (const u of l.match(LINK) ?? []) links.push({ url: u, line: i + 1, digest: sha256(l.trim()), emphasized: [...l.matchAll(/(?<![*\w])\*([A-Za-z][\w ]*?)\*(?!\*)/g)].map((e) => e[1]) }); });
  const resolved = [];
  for (const l of links) {
    const r = resolveLink(l.url);
    const cited = { source: `${def.source}#L${l.line}`, digest: l.digest, url: l.url };
    if (r.refusal) { resolved.push({ ...cited, refusal: r.refusal }); continue; }
    const all = computations(r.file);
    const named = all.filter((c) => c.names.some((n) => holds(n, x.title)) || c.names.some((n) => l.emphasized.includes(n)));
    resolved.push({ ...cited, dashboard: `${SIG}@${pins[SIG]}:${r.file}`, via: r.via, computations: all.length, named, all });
  }
  // The candidates: the computations the implementation names for the metric, or, where it names none, every
  // computation of every panel the definition cites. An element resolves only when all candidates agree on it.
  const named = resolved.flatMap((r) => r.named ?? []);
  const uniq = (xs) => [...new Map(xs.map((v) => [JSON.stringify(v), v])).values()];
  // Two links to one panel cite one set of computations.
  const candidates = uniq(named.length ? named : resolved.flatMap((r) => r.all ?? []));
  const refuse = (reason, extra = {}) => ({ status: 'open', reason, ...extra });
  const why = !links.length ? 'definition-cites-no-oracle-panel'
    : !candidates.length ? `oracle-link-unresolved:${uniq(resolved.filter((r) => r.refusal).map((r) => r.refusal)).join('+')}`
    : candidates.some((c) => c.unparsed) ? 'oracle-computation-unparsed' : null;
  const facts = why ? [] : candidates.map((c) => {
    const series = c.series.map((sr) => {
      const ds = dataSource(sr.index);
      if (ds.refusal) return { sr, refusal: ds.refusal };
      // ISO/IEC 15939: an attribute is a property of an entity. A field aggregated over items is a property of each
      // item, so the item is the entity. A count of items, or of distinct values, characterizes the collection the
      // items fall in, which the computation does not name: its entity and attribute stay open, its unit is the item.
      const item = entityOf(ds, sr.pullRequest ?? undefined);
      const counting = COUNTS.has(sr.aggregation);
      const entity = counting ? { refusal: 'count-characterizes-a-collection' } : item;
      const attr = counting ? (sr.field ? attributeOf(ds, sr.index, sr.field) : { refusal: 'count-of-items' }) : attributeOf(ds, sr.index, sr.field);
      const unit = sr.aggregation === 'count' ? (item.value ? `{${item.value}}` : null)
        : sr.aggregation === 'cardinality' ? (attr.name ? `{${attr.name}}` : null)
        : attr.unit ?? null;
      const scale = COUNTS.has(sr.aggregation) || unit === 'd' ? (unit ? 'ratio' : null) : null;
      return { sr, ds, item, entity, attr, unit, scale };
    });
    const one = (k) => { const v = uniq(series.map(k)); return v.length === 1 ? v[0] : null; };
    // A Timelion quotient of two series in one unit is dimensionless (UCUM 1) and on the ratio scale.
    const quotient = c.function === 'divide';
    return {
      c, series,
      refusal: series.find((x) => x.refusal)?.refusal,
      entity: one((x) => x.entity?.value ?? null),
      attribute: quotient || series.some((x) => COUNTS.has(x.sr.aggregation)) ? null : one((x) => x.attr?.name ?? null),
      unit: quotient ? (one((x) => x.unit) ? '1' : null) : one((x) => x.unit),
      scale: one((x) => x.scale),
      cites: { entity: series.flatMap((x) => x.entity?.cites ?? []), item: series.flatMap((x) => x.item?.cites ?? []), attribute: series.flatMap((x) => x.attr?.cites ?? []) },
    };
  });
  const binding = (f) => ({ index: f.c.series.map((x) => x.index), function: f.c.function, series: f.c.series, entity: f.entity, unit: f.unit, label: f.c.label, at: f.c.at });
  const bindings = uniq(facts.filter((f) => !f.refusal).map(binding));
  const agree = (element, key, cites) => {
    if (why) return refuse(why);
    const blocked = facts.find((f) => f.refusal);
    if (blocked) return refuse(`oracle-index-unresolved:${blocked.refusal}`);
    const values = uniq(facts.map((f) => f[key]));
    if (values.includes(null)) return refuse(`${element}-unstated-by-oracle`, { candidates: facts.length });
    if (values.length !== 1) return refuse('implementations-disagree', { candidates: values });
    return { status: 'resolved', value: values[0], ...(key === 'unit' ? { system: 'UCUM' } : {}), cites: uniq(facts.flatMap(cites)) };
  };
  const elements = open.map((element) => {
    if (element === 'entity') return agree(element, 'entity', (f) => f.cites.entity);
    if (element === 'attribute') return agree(element, 'attribute', (f) => f.cites.attribute);
    if (element === 'unit') return agree(element, 'unit', (f) => [...f.cites.attribute, ...f.cites.item, f.c.at]);
    if (element === 'scale') return agree(element, 'scale', (f) => [f.c.at]);
    if (element === 'measurementMethod') {
      if (why) return refuse(why);
      return facts.length === 1 && !facts[0].refusal ? { status: 'resolved', value: binding(facts[0]), cites: [facts[0].c.at] } : refuse('implementations-disagree', { candidates: facts.length });
    }
    return refuse(`oracle-states-no-${element}`);
  }).map((e, k) => ({ element: open[k], ...e }));
  items.push({ index: x.index, slug: x.slug, kind: x.kind, candidates: named.length ? 'named' : 'panel', links: resolved.map(({ named: n, all: a, ...r }) => ({ ...r, named: (n ?? []).length })), bindings, elements });
}
const all = items.flatMap((x) => x.elements);
const out = {
  spec: 'uor-community/chaoss-oracle-methods/1',
  standard: 'ISO/IEC 15939:2017',
  units: 'UCUM',
  measurement: sha256(readFileSync(measurementPath)),
  release: sources.release,
  pins: Object.fromEntries(Object.keys(dirs).sort().map((k) => [k, pins[k]])),
  counts: { open: all.filter((e) => e.status === 'open').length, resolved: all.filter((e) => e.status === 'resolved').length },
  items,
};
const text = JSON.stringify(out, null, 1) + '\n';
if (check) {
  if (!existsSync(outPath) || readFileSync(outPath, 'utf8') !== text) { process.stderr.write('chaoss/oracle-methods.json is not the oracle projection of chaoss/measurement.json\n'); process.exit(1); }
} else writeFileSync(outPath, text);
process.stdout.write(`${out.counts.resolved} elements resolved by the oracle, ${out.counts.open} open\n`);
