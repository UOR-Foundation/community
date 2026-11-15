#!/usr/bin/env node
/**
 * Project the accessibility register of the Foundation's public web content,
 * Foundation.Accessibility.V1, from its pinned sources and the committed
 * snapshot.
 *
 * The success criteria are every criterion of WCAG 2.2, read from the
 * machine-readable guidelines/wcag.json of w3c/wcag at the commit of the
 * Recommendation's tag; Level A and AA are targeted, Level AAA is recorded as
 * not targeted for the reason the conformance requirements' own note gives,
 * and a criterion the source marks obsolete is kept so EN 301 549, which
 * still requires it through WCAG 2.1, can name it. Each axe-core rule of the
 * snapshot is mapped to the criteria its own wcagNNN tags name. Every page of
 * the snapshot then has exactly one outcome for every targeted criterion:
 *
 *   failed       a mapped rule found a violation in some reading of the page;
 *   needsReview  no violation, and a mapped rule returned incomplete;
 *   passed       no violation or incomplete result, and a mapped rule ran and passed;
 *   untested     mapped rules ran and found nothing on the page to test;
 *   uncovered    no axe rule names the criterion.
 *
 * Every outcome but passed is an open claim; a pass is axe's, never a
 * conformance claim, which needs the criteria's full text reviewed. Every
 * website page is held to be dispatched by a route of src/App.tsx at the
 * pinned commit, and EN 301 549 V3.2.1 clause 9 is mapped clause by clause to
 * the criterion it requires. Remediation drafts, one per page, are written
 * from the register as data; nothing is changed on any site. The same
 * sources and snapshot always project the same bytes.
 *
 *   node accessibility/project.mjs <sources-dir> [--check]
 *
 * <sources-dir> holds `wcag` and `website` checked out at the pinned commits.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const [dir, flag] = process.argv.slice(2);
if (!dir) {
  process.stderr.write('usage: project.mjs <sources-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const repo = (name) => sources.repositories.find((r) => r.name === name);
function pinned(source) {
  const d = join(dir, source.name);
  const head = readFileSync(join(d, '.git', 'HEAD'), 'utf8').trim();
  const at = head.startsWith('ref:') ? readFileSync(join(d, '.git', head.slice(5)), 'utf8').trim() : head;
  if (at !== source.commit) throw new Error(`${source.name} is at ${at}, not the pinned ${source.commit}`);
  return (path) => {
    const bytes = readFileSync(join(d, path));
    return { path: `${source.name}@${source.commit}:${path}`, sha256: sha256(bytes), text: bytes.toString('utf8').replace(/\r\n/g, '\n') };
  };
}
const wcagRepo = repo('wcag');
const wcag = pinned(wcagRepo);
const site = pinned(repo('website'));
const criteriaFile = wcag(wcagRepo.criteria);
const conformanceFile = wcag(wcagRepo.conformance);
const routesFile = site(repo('website').routes);
const snapshotBytes = readFileSync(join(here, 'snapshot.json'));
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
const inventoryBytes = readFileSync(join(root, sources.inventory));
const lock = JSON.parse(readFileSync(join(root, sources.oracle.lock), 'utf8'));
const pin = lock.packages[`node_modules/${sources.oracle.package}`];
if (snapshot.tools.axe.version !== pin.version || snapshot.tools.axe.integrity !== pin.integrity) {
  throw new Error(`the snapshot ran axe-core ${snapshot.tools.axe.version}; ${sources.oracle.lock} pins ${pin.version}`);
}

// ---- The success criteria, in the order of the source.
const LEVELS = ['A', 'AA', 'AAA', 'obsolete'];
const TARGETED = new Set(['A', 'AA']);
const wcagJson = JSON.parse(criteriaFile.text);
let slot = 0;
const criteria = wcagJson.principles.flatMap((p) => p.guidelines.flatMap((g) => g.successcriteria)).map((c, index) => {
  const level = c.level === '' ? (/obsolete/i.test(c.handle) ? 'obsolete' : null) : c.level;
  if (!LEVELS.includes(level)) throw new Error(`${c.num} has the level "${c.level}"`);
  const in22 = c.versions.includes('2.2');
  const targeted = in22 && TARGETED.has(level);
  return { index, num: c.num, id: c.id.replace(/^WCAG2:/, ''), handle: c.handle, level, versions: c.versions, in21: c.versions.includes('2.1'), in22, targeted, slot: targeted ? slot++ : 0 };
});
const byNum = new Map(criteria.map((c) => [c.num, c]));
const targeted = criteria.filter((c) => c.targeted);

// The conformance requirements and the note that sets Level AAA aside, as guidelines/index.html words them.
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const requirements = [...conformanceFile.text.matchAll(/<section id="(cc\d)">\s*<h3>([^<]+)<\/h3>/g)].map((m, index) => ({ index, id: m[1], title: strip(m[2]) }));
if (requirements.length !== 5) throw new Error(`guidelines/index.html has ${requirements.length} conformance requirements, not 5`);
const aaaNote = strip(conformanceFile.text.match(/<p class="note">(It is not recommended that Level AAA conformance be required[^<]*)<\/p>/)?.[1] ?? '');
if (!aaaNote) throw new Error('guidelines/index.html does not give the Level AAA note');

// ---- The oracle's rules, each mapped by its own tags.
const tagged = (tags) => tags.map((t) => t.match(/^wcag(\d)(\d)(\d+)$/)).filter(Boolean).map((m) => `${m[1]}.${m[2]}.${m[3]}`);
const rules = snapshot.rules.map((r, index) => {
  const nums = tagged(r.tags);
  for (const n of nums) if (!byNum.has(n)) throw new Error(`axe rule ${r.id} is tagged ${n}, which WCAG 2.2 does not have`);
  return { index, id: r.id, help: r.help, helpUrl: r.helpUrl, tags: r.tags, criteria: nums };
});
const ruleById = new Map(rules.map((r) => [r.id, r]));
for (const c of criteria) c.axeRules = rules.filter((r) => r.criteria.includes(c.num)).map((r) => r.id);

// ---- The website's routes, read from src/App.tsx: each `if` of App in order, rendering or redirecting.
const branches = [...routesFile.text.matchAll(/if \(([^\n]*?)\) (?:\{\s*\n\s*window\.location\.replace|return <Suspense)/g)].map((m) => ({
  render: !m[0].includes('window.location.replace'),
  exact: [...m[1].matchAll(/pathname === "([^"]+)"/g)].map((x) => x[1]),
  prefix: [...m[1].matchAll(/pathname\.startsWith\("([^"]+)"\)/g)].map((x) => x[1]),
  pattern: [...m[1].matchAll(/\/(\^[^/]*(?:\\\/[^/]*)*\$)\/\.test\(window\.location\.pathname\)/g)].map((x) => new RegExp(x[1])),
}));
if (branches.length !== (routesFile.text.match(/\bif \(/g) ?? []).length) throw new Error('src/App.tsx has a route the projector does not read');
if (!/return <FoundationHome \/>;\s*\n\}/.test(routesFile.text)) throw new Error('src/App.tsx does not end by rendering FoundationHome');
const dispatch = (path) => {
  const b = branches.find((x) => x.exact.includes(path) || x.prefix.some((p) => path.startsWith(p)) || x.pattern.some((re) => re.test(path)));
  return b ? (b.render ? 'rendered' : 'redirected') : 'rendered';
};

// ---- Pages and readings.
const CONFIGS = [];
for (const viewport of Object.keys(sources.configurations.devices)) for (const scheme of sources.configurations.schemes) CONFIGS.push({ viewport, scheme });
const refusals = [];
const pages = snapshot.pages.map((p, index) => {
  const readings = CONFIGS.map((cfg) => {
    const r = p.readings.find((x) => x.viewport === cfg.viewport && x.scheme === cfg.scheme);
    if (!r) throw new Error(`${p.url} has no ${cfg.viewport} ${cfg.scheme} reading`);
    return r;
  });
  const path = new URL(p.url).pathname;
  const route = p.property === 'service:website' ? dispatch(path) : 'unrouted';
  const ran = readings.filter((r) => r.ran).length;
  return { index, url: p.url, service: p.service, property: p.property, discovery: p.discovery, route, ran, readings };
});
for (const p of pages) {
  if (p.route === 'redirected') refusals.push({ kind: 'route-redirects', page: p.index, detail: `${p.url}: the sitemap lists it, and src/App.tsx at ${repo('website').commit} redirects it` });
  const statuses = [...new Set(p.readings.filter((r) => r.ran && (r.status < 200 || r.status > 299)).map((r) => r.status))];
  if (statuses.length) refusals.push({ kind: 'page-status', page: p.index, detail: `${p.url}: served with HTTP ${statuses.join(', ')}; a crawled link reaches it, and axe read the document served` });
  const failed = p.readings.filter((r) => !r.ran);
  if (failed.length) refusals.push({ kind: 'page-unread', page: p.index, detail: `${p.url}: ${failed.map((r) => `${r.viewport} ${r.scheme}: ${r.error ?? `HTTP ${r.status} ${r.contentType}`}`).join('; ')}` });
}
for (const prop of snapshot.properties) {
  if (prop.limited) refusals.push({ kind: 'crawl-limited', page: pages.findIndex((p) => p.url === prop.url), detail: `${prop.url}: the crawl reached its limit of ${sources.crawl.limit} pages; the page set is not complete` });
}

// ---- One outcome per page and targeted criterion.
const RULE_STATES = ['violated', 'incomplete', 'passed', 'inapplicable', 'notRun'];
const outcomes = [];
const openClaims = [];
for (const p of pages) {
  const state = (id) => {
    const ran = p.readings.filter((r) => r.ran);
    if (ran.some((r) => r.violations.some((v) => v.id === id))) return 'violated';
    if (ran.some((r) => r.incomplete.some((v) => v.id === id))) return 'incomplete';
    if (ran.some((r) => r.passes.includes(id))) return 'passed';
    if (ran.some((r) => r.inapplicable.includes(id))) return 'inapplicable';
    return 'notRun';
  };
  for (const c of targeted) {
    const states = Object.fromEntries(RULE_STATES.map((s) => [s, []]));
    for (const id of c.axeRules) states[state(id)].push(id);
    const outcome = states.violated.length ? 'failed' : states.incomplete.length ? 'needsReview' : states.passed.length ? 'passed' : c.axeRules.length ? 'untested' : 'uncovered';
    const index = outcomes.length;
    outcomes.push({ index, page: p.index, criterion: c.index, slot: c.slot, outcome, rules: states });
    if (outcome !== 'passed') {
      const named = [...states.violated, ...states.incomplete];
      const where = named.map((id) => {
        const hits = p.readings.filter((r) => r.ran).flatMap((r) => [...r.violations, ...r.incomplete].filter((v) => v.id === id).map((v) => ({ ...v, cfg: `${r.viewport} ${r.scheme}` })));
        return `${id} (${[...new Set(hits.map((h) => h.cfg))].join(', ')}: ${[...new Set(hits.flatMap((h) => h.nodes.map((n) => n.target)))].slice(0, 3).join(' | ')})`;
      });
      const detail = {
        failed: `axe found violations: ${where.join('; ')}`,
        needsReview: `axe could not decide: ${where.join('; ')}`,
        untested: `the mapped axe rules ${c.axeRules.join(', ')} found nothing to test; review by hand`,
        uncovered: 'no axe rule tests this criterion; review by hand',
      }[outcome];
      openClaims.push({ outcome: index, kind: outcome, detail: `${c.num} ${c.handle} on ${p.url}: ${detail}` });
    }
  }
}
// The conformance requirements other than the level are not observable by an automated rule.
for (const r of requirements) {
  refusals.push({ kind: 'requirement-unreviewed', page: -1, detail: `WCAG 2.2 conformance requirement ${r.id.slice(2)} (${r.title}) is not tested by axe-core; every page's conformance at Level AA stays open until it is reviewed` });
}

// ---- EN 301 549 V3.2.1 clause 9.
const en = snapshot.en301549;
if (en.status !== 200) throw new Error(`EN 301 549 was not read: HTTP ${en.status}`);
const clauses = en.clauses.map((c, index) => {
  if (c.criterion === null) throw new Error(`EN 301 549 clause ${c.clause} names no WCAG 2.1 success criterion`);
  const crit = c.criterion ? byNum.get(c.criterion) : null;
  if (c.criterion && !crit) throw new Error(`EN 301 549 clause ${c.clause} requires ${c.criterion}, which the WCAG source lacks`);
  if (crit && crit.num.split('.').slice(1).join('.') !== c.clause.split('.').slice(2).join('.')) throw new Error(`EN 301 549 clause ${c.clause} is not numbered after ${crit.num}`);
  return { index, clause: c.clause, title: c.title, void: !crit, criterion: crit ? crit.index : 0, num: crit ? crit.num : '' };
});
for (const c of clauses) {
  if (!c.void && criteria[c.criterion].level === 'obsolete') refusals.push({ kind: 'en-criterion-obsolete', page: -1, detail: `EN 301 549 clause ${c.clause} requires WCAG 2.1 ${c.num}, which WCAG 2.2 records as obsolete and removed; the WCAG 2.1 text that decides it is not among the pinned sources` });
}
const enRequirements = en.conformance.requirements;
if (enRequirements.length !== requirements.length || enRequirements.some((r, i) => r.title.toLowerCase() !== requirements[i].title.toLowerCase())) {
  throw new Error('EN 301 549 clause 9.6 does not name the five WCAG conformance requirements in order');
}

const count = (xs, pred) => xs.filter(pred).length;
const register = {
  spec: 'uor-community/accessibility-register/1',
  standards: ['W3C Web Content Accessibility Guidelines (WCAG) 2.2', 'ETSI EN 301 549 V3.2.1 clause 9 (WCAG 2.1 Level AA)'],
  wcag: { recommendation: wcagRepo.recommendation, tag: wcagRepo.tag, criteria: { path: criteriaFile.path, sha256: criteriaFile.sha256 }, conformance: { path: conformanceFile.path, sha256: conformanceFile.sha256 }, aaaNote },
  en301549: { url: en.url, version: sources.en301549.version, sha256: en.sha256, fetchedAt: en.fetchedAt, pdftotext: en.pdftotext },
  website: { path: routesFile.path, sha256: routesFile.sha256 },
  inventory: { path: sources.inventory, sha256: sha256(inventoryBytes) },
  snapshot: { sha256: sha256(snapshotBytes), takenAt: snapshot.takenAt },
  sitemap: { url: snapshot.sitemap.url, sha256: snapshot.sitemap.sha256, fetchedAt: snapshot.sitemap.fetchedAt },
  tools: { 'axe-core': snapshot.tools.axe, playwright: snapshot.tools.playwright, browser: snapshot.tools.browser, devices: snapshot.tools.devices },
  configurations: CONFIGS,
  counts: {
    criteria: criteria.length,
    targeted: targeted.length,
    rules: rules.length,
    pages: pages.length,
    readings: pages.length * CONFIGS.length,
    outcomes: Object.fromEntries(['failed', 'needsReview', 'passed', 'untested', 'uncovered'].map((o) => [o, count(outcomes, (x) => x.outcome === o)])),
    openClaims: openClaims.length,
    refusals: refusals.length,
  },
  criteria: criteria.map(({ versions, ...c }) => ({ ...c, versions })),
  requirements,
  rules,
  properties: snapshot.properties,
  exclusions: snapshot.exclusions,
  pages: pages.map(({ readings, ...p }) => ({
    ...p,
    readings: readings.map((r) => ({
      viewport: r.viewport, scheme: r.scheme, finalUrl: r.finalUrl, status: r.status, contentType: r.contentType, fetchedAt: r.fetchedAt, sha256: r.sha256, ran: r.ran,
      violations: r.ran ? r.violations.length : 0, incomplete: r.ran ? r.incomplete.length : 0, passes: r.ran ? r.passes.length : 0, inapplicable: r.ran ? r.inapplicable.length : 0,
    })),
  })),
  outcomes,
  openClaims,
  refusals,
  en301549Clauses: clauses,
};

// ---- Remediation drafts, one per page, as data.
const slug = (u) => { const x = new URL(u); return `${x.hostname}${x.pathname}`.replace(/\/$/, '').replace(/[^A-Za-z0-9]+/g, '-'); };
const drafts = pages.map((p) => {
  const mine = outcomes.filter((o) => o.page === p.index);
  const failing = [...new Set(mine.flatMap((o) => [...o.rules.violated, ...o.rules.incomplete]))].sort();
  const md = [`# Accessibility remediation draft: ${p.url}`, ''];
  md.push(`Generated by \`node accessibility/project.mjs\` from \`accessibility/register.json\`; do not edit. A draft for the maintainers of ${p.service}; nothing has been changed on the site. axe-core ${snapshot.tools.axe.version} in ${snapshot.tools.browser}, snapshot ${snapshot.takenAt}.`, '');
  md.push(`Outcomes for the ${targeted.length} WCAG 2.2 Level A and AA success criteria: ${['failed', 'needsReview', 'passed', 'untested', 'uncovered'].map((o) => `${count(mine, (x) => x.outcome === o)} ${o}`).join(', ')}.`, '');
  md.push('## Readings', '', '| Viewport | Scheme | HTTP | Fetched | Document sha256 | Violations | Incomplete |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of p.readings) md.push(`| ${r.viewport} | ${r.scheme} | ${r.status} | ${r.fetchedAt} | \`${r.sha256.slice(0, 16)}\` | ${r.ran ? r.violations.length : 'not run'} | ${r.ran ? r.incomplete.length : 'not run'} |`);
  md.push('');
  md.push('## Fix what axe found', '');
  if (!failing.length) md.push('axe-core found no violation and no incomplete result on this page.', '');
  for (const id of failing) {
    const rule = ruleById.get(id);
    const hits = p.readings.filter((r) => r.ran).flatMap((r) => [...r.violations.map((v) => ({ ...v, as: 'violation' })), ...r.incomplete.map((v) => ({ ...v, as: 'incomplete' }))].filter((v) => v.id === id).map((v) => ({ ...v, cfg: `${r.viewport} ${r.scheme}` })));
    md.push(`### ${id}: ${rule.help}`, '');
    md.push(`- Success criteria: ${rule.criteria.map((n) => `${n} ${byNum.get(n).handle} (${byNum.get(n).level})`).join('; ') || 'none'}`);
    md.push(`- Result: ${[...new Set(hits.map((h) => `${h.as} in ${h.cfg}`))].join(', ')}; impact ${[...new Set(hits.map((h) => h.impact).filter(Boolean))].join(', ') || 'unstated'}`);
    md.push(`- Rule documentation: ${rule.helpUrl}`);
    const nodes = new Map();
    for (const h of hits) for (const n of h.nodes) if (!nodes.has(n.target)) nodes.set(n.target, n.summary);
    md.push(`- Elements (${nodes.size}):`, '');
    for (const [target, summary] of [...nodes].slice(0, 20)) md.push(`  - \`${target.replace(/`/g, "'")}\`${summary ? `: ${summary.replace(/\s+/g, ' ').trim()}` : ''}`);
    md.push('');
  }
  md.push('## Review by hand', '', 'axe-core cannot decide these criteria on this page; each stays an open claim until a person reviews it against the criterion\'s text.', '');
  for (const o of mine.filter((x) => x.outcome === 'untested' || x.outcome === 'uncovered')) {
    const c = criteria[o.criterion];
    md.push(`- ${c.num} ${c.handle} (${c.level}): ${o.outcome === 'uncovered' ? 'no axe rule tests it' : `its rules (${c.axeRules.join(', ')}) found nothing to test`}. https://www.w3.org/WAI/WCAG22/Understanding/${c.id}`);
  }
  md.push('');
  return [`accessibility/drafts/${slug(p.url)}.md`, `${md.join('\n').trimEnd()}\n`];
});

const files = [['accessibility/register.json', `${JSON.stringify(register, null, 1)}\n`], ...drafts];
let stale = false;
const draftDir = join(here, 'drafts');
const expected = new Set(drafts.map(([p]) => p.split('/').pop()));
if (flag === '--check') {
  const present = existsSync(draftDir) ? readdirSync(draftDir) : [];
  for (const f of present) if (!expected.has(f)) { process.stderr.write(`accessibility/drafts/${f} is not a draft of the register\n`); stale = true; }
  for (const [path, text] of files) {
    const target = join(root, path);
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`${path} is not the projection of its pinned sources\n`); stale = true; }
  }
} else {
  if (existsSync(draftDir)) for (const f of readdirSync(draftDir)) if (!expected.has(f)) rmSync(join(draftDir, f));
  mkdirSync(draftDir, { recursive: true });
  for (const [path, text] of files) writeFileSync(join(root, path), text);
}
if (stale) process.exit(1);
const c = register.counts;
process.stdout.write(`${c.criteria} criteria (${c.targeted} targeted), ${c.rules} axe rules, ${c.pages} pages, ${c.readings} readings; outcomes ${Object.entries(c.outcomes).map(([k, v]) => `${v} ${k}`).join(', ')}; ${c.openClaims} open claims, ${c.refusals} refusals\n`);
