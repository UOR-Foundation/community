#!/usr/bin/env node
/**
 * Project the standards applicability register, Foundation.Standards.V1, and
 * the workstreams that close its gaps.
 *
 * The parts are the Foundation's domains (standards/parts.json) and every
 * package and service of the asset register. The candidates are the standards
 * of standards/candidates.json, each with the scope its issuer states
 * (standards/snapshot.json, or for a law the nonprofit register's pinned
 * authorities). Every pair of a part and a candidate that names its kind is
 * decided by the uor-standard-applicability decision app, by evaluating the
 * prompt's own first-hit rules after holding the evaluator to the prompt's
 * examples. An applicable pair then has exactly one status:
 *
 *   implemented    a facet register cites the standard, a check (a Lean
 *                  theorem or an oracle) holds it, and nothing the facet
 *                  records is open against it;
 *   partial        a facet register cites or a pinned Foundation document
 *                  adopts it, and clauses remain open;
 *   unimplemented  nothing cites it, or, for a law, no obligation that cites
 *                  it is discharged or under way.
 *
 * A pair that does not apply has the status unrated.
 *
 * The status is read from the facets, never stated: a law's from the
 * nonprofit register's obligations that cite its authorities, a
 * standards.lock binding's from the coverage its oracles declare, a security
 * standard's from the security facet's own table, and any other from the
 * facet registers that cite it. Every pair that is not implemented, and every
 * candidate whose scope could not be read, is an open claim. The register and
 * standards/workstreams.md are written from the same inputs, so the same
 * inputs always project the same bytes.
 *
 *   node standards/project.mjs [--check]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const bytesOf = (p) => readFileSync(join(root, p));
const json = (p) => JSON.parse(bytesOf(p).toString('utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const INPUTS = ['standards/candidates.json', 'standards/parts.json', 'standards/snapshot.json', 'apps/uor-standard-applicability.prompt.json', 'inventory/register.json', 'nonprofit/register.json', 'governance/register.json', 'standards.lock'];
const inputs = INPUTS.map((path) => ({ path, sha256: sha256(bytesOf(path)) }));
const { candidates } = json('standards/candidates.json');
const partsDecl = json('standards/parts.json');
const snapshot = json('standards/snapshot.json');
const prompt = json('apps/uor-standard-applicability.prompt.json');
const inventory = json('inventory/register.json');
const nonprofit = json('nonprofit/register.json');
const governance = json('governance/register.json');
const lock = json('standards.lock');

// ---- The decision app: its fields, first-hit rules and otherwise, held to its own examples.
const app = prompt.app;
const FIELDS = ['owner', 'scope', 'inscope', 'force', 'jurisdiction', 'activity', 'adopted'];
if (prompt.pattern !== 'decisionTable') throw new Error(`${app.name} is a ${prompt.pattern}, not a decisionTable`);
if (app.fields.map((f) => f.name).join() !== FIELDS.join()) throw new Error(`${app.name} asks [${app.fields.map((f) => f.name)}]; the projector binds [${FIELDS}]`);
const decide = (request) => {
  for (const [i, rule] of app.rules.entries()) {
    if (rule.when.every((c) => { if (c.op !== 'is') throw new Error(`${app.name} uses ${c.op}`); return request[c.field] === c.value; })) return { outcome: rule.then, rule: i + 1 };
  }
  return { outcome: app.otherwise, rule: 0 };
};
for (const ex of app.examples) {
  const words = ex.request.split(/\s+/);
  const got = decide(Object.fromEntries(FIELDS.map((f, i) => [f, words[i]]))).outcome;
  if (got !== ex.response) throw new Error(`${app.name} example "${ex.request}" gives ${got}, not ${ex.response}`);
}
const APPLICABLE = new Set(['secured', 'conditional', 'mandatory', 'adopted', 'applicable']);
const MANDATORY = new Set(['mandatory', 'conditional']);

// ---- Facets, and what each cites: its register's declared standards and tools, and its pinned sources.
const facets = partsDecl.facets.map((f, index) => {
  const present = f.commit ? snapshot.security.status === 200 && f.id === 'security' : existsSync(join(root, f.register));
  let cited = '';
  if (!f.commit && present) {
    const reg = json(f.register);
    cited = f.register === 'standards.lock' ? JSON.stringify(reg.authorities.map((a) => [a.id, a.name])) : JSON.stringify([reg.spec, reg.standards ?? '', reg.standard ?? '', reg.tools ?? '']);
    const src = join(f.directory, 'sources.json');
    if (existsSync(join(root, src))) cited += bytesOf(src).toString('utf8');
  }
  // A digest is not a citation: hex runs are dropped, so a standard's number is never matched inside one.
  cited = cited.replace(/[0-9a-f]{16,}/g, '');
  return { index, ...f, present, cited };
});
const facetIndex = new Map(facets.map((f) => [f.id, f.index]));
const citers = (cand) => (cand.cites ? facets.filter((f) => f.cited && new RegExp(cand.cites).test(f.cited)) : []);
const checks = [{ facet: 0, name: 'none' }];
const checkFor = (facet) => {
  const name = facets[facet].check;
  let at = checks.findIndex((c) => c.facet === facet && c.name === name);
  if (at < 0) { at = checks.length; checks.push({ facet, name }); }
  return at;
};

// ---- Parts: the domains, then every package and service of the asset register.
const parts = [];
for (const d of partsDecl.domains) parts.push({ id: `domain:${d.kind}`, name: d.name, kind: d.kind, facets: d.facets, subjects: d.subjects });
for (const kind of ['package', 'service']) {
  for (const x of inventory[`${kind}s`]) {
    const asset = inventory.assets[x.asset];
    parts.push({ id: asset.id, name: asset.name, kind, facets: partsDecl.products[kind].facets, subjects: partsDecl.products[kind].subjects });
  }
}
for (const p of parts) for (const f of p.facets) if (!facetIndex.has(f)) throw new Error(`${p.id} names the undeclared facet ${f}`);

// ---- Standards: each candidate with its scope as its issuer states it.
const records = new Map(snapshot.records.map((r) => [r.id, r]));
const lockById = new Map(lock.authorities.map((a) => [a.id, a]));
const oracleById = new Map(lock.oracles.map((o) => [o.id, o]));
const obligationsOf = new Map();
for (const c of nonprofit.citations) {
  if (!obligationsOf.has(c.authority)) obligationsOf.set(c.authority, new Set());
  obligationsOf.get(c.authority).add(c.obligation);
}
const provisionKeys = new Map(governance.provisions.map((p) => [p.key, p]));
const refusals = [];
const standards = candidates.map((c, index) => {
  const s = c.source;
  const base = { index, id: c.id, name: c.name, issuer: c.issuer, force: c.force, owner: c.owner, subject: c.subject, jurisdiction: c.jurisdiction ?? '', parts: c.parts, home: c.home, oracle: c.oracle ?? '', lock: c.lock ?? '' };
  if (s.kind === 'nonprofit') {
    const authorities = nonprofit.authorities.map((a, i) => ({ ...a, i })).filter((a) => new RegExp(s.refs).test(a.ref));
    if (!authorities.length) throw new Error(`${c.id}: no nonprofit authority matches ${s.refs}`);
    const src = nonprofit.sources[authorities[0].source];
    const obligations = [...new Set(authorities.flatMap((a) => [...(obligationsOf.get(a.i) ?? [])]))].sort((a, b) => a - b).map((o) => nonprofit.obligations[o]);
    return { ...base, edition: src.url.match(/crs(\d{4})|USCODE-(\d{4})|versioner\/v1\/full\/([\d-]+)|irs-pdf\/(\w+)/)?.slice(1).find(Boolean) ?? '', url: src.url, sha256: (src.digest ?? '').replace(/^sha256:/, ''), fetchedAt: src.fetchedAt ?? '', quote: authorities[0].quote, quoteFrom: `nonprofit/register.json authority ${authorities[0].key}`, clauses: authorities.map((a) => a.ref), obligations, scope: 'quoted' };
  }
  if (s.kind === 'security') {
    const reported = s.match ? snapshot.security.standards.some((row) => new RegExp(s.match).test(row)) : false;
    return { ...base, edition: '', url: s.url, sha256: '', fetchedAt: '', quote: '', quoteFrom: 'owned by the security facet', clauses: [], scope: 'quoted', securityStatus: reported ? 'implemented' : (s.status ?? 'unimplemented'), securityPinned: reported };
  }
  const r = records.get(c.id);
  if (!r) throw new Error(`${c.id} has no snapshot record; run standards/snapshot.mjs`);
  const edition = r.kind === 'iso' ? `${(r.title.match(/^([^-]+?) - /)?.[1] ?? '').trim()}${r.edition ? `, edition ${r.edition}` : ''}` : c.name.match(/\d+(\.\d+)+|\d{4}/)?.[0] ?? '';
  const scope = r.quote ? 'quoted' : 'unread';
  if (scope === 'unread') refusals.push({ standard: index, refusal: r.status === 200 ? 'scope-not-on-issuer-page' : 'issuer-page-unreadable', detail: `${c.name}: ${r.url} returned HTTP ${r.status}${r.status === 200 ? ' without the scope statement' : ''}; the scope is not restated, the candidate stays open` });
  return { ...base, edition, url: r.url, sha256: r.sha256, fetchedAt: r.fetchedAt, quote: r.quote, quoteFrom: r.kind === 'iso' ? `ISO page ${r.quoteFrom}` : 'issuer page', clauses: r.clauses, scope };
});

// ---- The status of an applicable pair, read from the facets.
function status(part, std) {
  const cand = candidates[std.index];
  if (std.owner === 'security') {
    const f = facetIndex.get('security');
    const s = std.securityStatus;
    return { status: s, facet: f, check: s === 'unimplemented' ? 0 : checkFor(f), open: s === 'implemented' ? [] : [std.securityPinned ? 'the security facet states its clause coverage' : `reported ${s} by the security thread; not yet in security/README.md at the pinned commit`] };
  }
  if (cand.source.kind === 'nonprofit') {
    const f = facetIndex.get('nonprofit');
    const ob = std.obligations;
    const open = ob.filter((o) => o.status !== 'discharged').map((o) => `${o.name} (${o.status})`);
    const s = ob.length === 0 ? 'unimplemented' : open.length === 0 ? 'implemented' : ob.some((o) => ['discharged', 'active'].includes(o.status)) ? 'partial' : 'unimplemented';
    return { status: s, facet: f, check: s === 'unimplemented' ? 0 : checkFor(f), open: ob.length ? open : ['no obligation of the nonprofit register cites this law'] };
  }
  if (std.lock && part.kind === 'sdlc') {
    const a = lockById.get(std.lock);
    if (!a) throw new Error(`${std.id}: standards.lock has no authority ${std.lock}`);
    const f = facetIndex.get('template');
    const oracles = a.oracle_ids.map((id) => oracleById.get(id));
    const open = oracles.length ? oracles.flatMap((o) => o.does_not_cover.map((x) => `${o.id} does not cover ${x}`)) : [`${a.id} is ${a.source_role}: ${a.statement}`];
    return { status: open.length ? 'partial' : 'implemented', facet: f, check: checkFor(f), open };
  }
  const citing = citers(cand);
  const own = citing.find((f) => part.facets.includes(f.id)) ?? citing[0];
  if (own) return { status: 'partial', facet: own.index, check: checkFor(own.index), open: [`${own.register} cites it; no check of this repository verifies its clauses for ${part.name}`] };
  if (cand.adoptedBy && provisionKeys.has(cand.adoptedBy.provision)) {
    const f = facetIndex.get(cand.adoptedBy.facet);
    return { status: 'partial', facet: f, check: checkFor(f), open: [`adopted by ${cand.adoptedBy.provision} (sha256:${provisionKeys.get(cand.adoptedBy.provision).sha256}); no facet register cites it by name or checks its clauses`] };
  }
  return { status: 'unimplemented', facet: facetIndex.get(part.facets[0]), check: 0, open: ['nothing in the Foundation cites or implements it'] };
}

// ---- Every candidate pair, decided.
const entityJurisdictions = new Set(['US', nonprofit.entity.jurisdiction]);
const decisions = [];
const openClaims = [];
parts.forEach((part, p) => {
  for (const std of standards) {
    if (!std.parts.includes(part.kind)) continue;
    const cand = candidates[std.index];
    const adopted = citers(cand).length > 0 || Boolean(cand.adoptedBy && provisionKeys.has(cand.adoptedBy.provision)) || Boolean(std.lock && lockById.has(std.lock));
    let activity = cand.activity ?? 'present';
    // A law's activity is undetermined when every obligation that cites it is conditional on what the sources do not settle.
    if (std.obligations && std.obligations.length && std.obligations.every((o) => o.applicability === 'conditional' && ['undetermined', 'unobservable'].includes(o.status))) activity = 'undetermined';
    const request = {
      owner: std.owner,
      scope: std.scope,
      inscope: [std.subject].flat().some((x) => part.subjects.includes(x)) ? 'yes' : 'no',
      force: std.force,
      jurisdiction: std.force === 'law' ? (entityJurisdictions.has(std.jurisdiction) ? 'own' : 'foreign') : 'unbound',
      activity: std.force === 'law' ? activity : 'present',
      adopted: adopted ? 'yes' : 'no',
    };
    const { outcome, rule } = decide(request);
    const st = APPLICABLE.has(outcome) ? status(part, std) : { status: 'unrated', facet: facetIndex.get(part.facets[0]), check: 0, open: [] };
    const index = decisions.length;
    decisions.push({ index, part: p, standard: std.index, ...request, outcome, rule, status: st.status, facet: st.facet, check: st.check, open: st.open });
    if (outcome === 'undecided') openClaims.push({ decision: index, owner: std.owner, refusal: 'applicability-undecided', detail: `${std.name} for ${part.name}: ${refusals.find((r) => r.standard === std.index)?.detail ?? 'the app could not decide'}` });
    else if (APPLICABLE.has(outcome) && st.status !== 'implemented') openClaims.push({ decision: index, owner: std.owner, refusal: `standard-${st.status}`, detail: `${std.name} for ${part.name}: ${st.open.join('; ')}` });
  }
});
for (const [i, part] of parts.entries()) {
  if (!decisions.some((d) => d.part === i && APPLICABLE.has(d.outcome))) throw new Error(`${part.id} has no applicable standard`);
}

// ---- Workstreams: the gaps grouped by standard, mandatory first, then by how many parts each binds.
const gaps = new Map();
for (const d of decisions) {
  if (!(d.outcome === 'undecided' || (APPLICABLE.has(d.outcome) && d.status !== 'implemented'))) continue;
  if (!gaps.has(d.standard)) gaps.set(d.standard, []);
  gaps.get(d.standard).push(d);
}
const workstreams = [...gaps.entries()].map(([s, ds]) => {
  const std = standards[s];
  return {
    standard: s,
    id: std.id,
    name: std.name,
    owner: std.owner,
    mandatory: ds.some((d) => MANDATORY.has(d.outcome)),
    outcomes: [...new Set(ds.map((d) => d.outcome))],
    undecided: ds.every((d) => d.outcome === 'undecided'),
    parts: ds.map((d) => parts[d.part].name),
    statuses: [...new Set(ds.map((d) => d.status))].filter((x) => x !== 'unrated'),
    clauses: std.clauses,
    oracle: std.oracle,
    home: std.home,
    url: std.url,
  };
}).sort((a, b) => (a.owner === b.owner ? 0 : a.owner === 'security' ? 1 : -1) || (a.undecided === b.undecided ? 0 : a.undecided ? 1 : -1) || (b.mandatory - a.mandatory) || (b.parts.length - a.parts.length) || (a.id < b.id ? -1 : 1));

const count = (pred) => decisions.filter(pred).length;
const counts = {
  parts: parts.length,
  standards: standards.length,
  decisions: decisions.length,
  applicable: count((d) => APPLICABLE.has(d.outcome)),
  byOutcome: Object.fromEntries(app.outcomes.map((o) => [o, count((d) => d.outcome === o)])),
  byStatus: Object.fromEntries(['implemented', 'partial', 'unimplemented'].map((s) => [s, count((d) => d.status === s)])),
  openClaims: openClaims.length,
  workstreams: workstreams.length,
};
const register = {
  spec: 'uor-community/standards-register/1',
  about: 'The standards applicability register of The UOR Foundation, projected by standards/project.mjs. Every candidate pair of a part and a standard is decided by the uor-standard-applicability decision app; every applicable pair has exactly one status read from the facets; every pair that is not implemented, and every candidate whose scope could not be read, is an open claim.',
  inputs,
  app: { name: app.name, path: 'apps/uor-standard-applicability.prompt.json', outcomes: app.outcomes, rules: app.rules.length },
  tools: snapshot.tools,
  security: { url: snapshot.security.url, sha256: snapshot.security.sha256, fetchedAt: snapshot.security.fetchedAt, standards: snapshot.security.standards },
  counts,
  facets: facets.map(({ cited, ...f }) => f),
  checks,
  parts: parts.map((p, index) => ({ index, ...p })),
  standards: standards.map(({ obligations, securityPinned, ...s }) => s),
  decisions,
  refusals,
  openClaims,
  workstreams,
};

// ---- standards/workstreams.md, written from the register alone.
const md = [];
md.push('# Standards workstreams', '');
md.push('Generated by `node standards/project.mjs` from `standards/register.json`; do not edit. Each workstream implements one standard (or one tight family of law) in every part it binds, and is independent of the others. They are ordered mandatory law first, then by how many parts the standard binds; candidates whose scope could not be read follow, then the standards the security facet owns.', '');
md.push(`${counts.parts} parts, ${counts.standards} candidate standards, ${counts.decisions} decided pairs, ${counts.applicable} applicable: ${counts.byStatus.implemented} implemented, ${counts.byStatus.partial} partial, ${counts.byStatus.unimplemented} unimplemented; ${counts.byOutcome.undecided} undecided; ${counts.openClaims} open claims in ${counts.workstreams} workstreams.`, '');
for (const [n, w] of workstreams.entries()) {
  const tag = w.owner === 'security' ? 'owner: security' : w.undecided ? 'applicability undecided' : w.outcomes.includes('mandatory') ? 'mandatory' : w.mandatory ? 'conditional law' : 'voluntary';
  md.push(`## ${n + 1}. ${w.name} (${tag})`, '');
  md.push(`- Standard: \`${w.id}\`, ${w.url}`);
  md.push(`- Parts (${w.parts.length}): ${w.parts.length > 12 ? `${w.parts.slice(0, 12).join('; ')}; and ${w.parts.length - 12} more` : w.parts.join('; ')}`);
  if (w.statuses.length) md.push(`- Status now: ${w.statuses.join(', ')}`);
  md.push(`- Clauses to implement: ${w.clauses.length ? `${w.clauses.length}: ${w.clauses.join(', ')}` : w.undecided ? 'none until the scope is read from the issuer' : 'the issuer page does not list them; obtain the standard\'s text and register each clause'}`);
  md.push(`- Oracle: ${w.oracle || 'the security facet chooses it'}`);
  md.push(`- Facet directory: \`${w.home}/\``, '');
}
const files = [
  ['standards/register.json', `${JSON.stringify(register, null, 2)}\n`],
  ['standards/workstreams.md', `${md.join('\n').trimEnd()}\n`],
];
let stale = false;
for (const [path, text] of files) {
  const target = join(root, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`${path} is not the projection of its inputs\n`); stale = true; }
  } else writeFileSync(target, text);
}
if (stale) process.exit(1);
process.stdout.write(`${counts.parts} parts, ${counts.standards} standards, ${counts.decisions} pairs, ${counts.applicable} applicable (${counts.byStatus.implemented} implemented, ${counts.byStatus.partial} partial, ${counts.byStatus.unimplemented} unimplemented), ${counts.byOutcome.undecided} undecided, ${counts.openClaims} open claims, ${counts.workstreams} workstreams\n`);
