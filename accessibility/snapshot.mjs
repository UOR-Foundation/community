#!/usr/bin/env node
/**
 * Snapshot the accessibility of the Foundation's public web content into
 * accessibility/snapshot.json, by running Deque axe-core in Chromium.
 *
 * The pages are the website's own sitemap.xml and, for every other deployed
 * service of inventory/register.json that serves HTML, its landing page and
 * the same-origin pages under its URL prefix its rendered links reach. Every
 * page is read at the desktop and phone widths and in the light and dark
 * color schemes accessibility/sources.json names, and axe-core, at the exact
 * version package-lock.json pins, is run once per reading with its default
 * rules. Each reading records its URL, final URL, HTTP status, fetch time and
 * the sha256 of the document bytes the server sent; each rule records what
 * axe decided and, for a violation or an incomplete result, the selectors it
 * names. EN 301 549 V3.2.1 is fetched, digested and its clause 9 read with
 * pdftotext. Only what the register reads is kept; no page text or markup is.
 *
 * This is the live read and is never run by push CI; accessibility/project.mjs
 * projects the committed snapshot, pinned by its sha256.
 *
 *   node accessibility/snapshot.mjs
 *
 * Playwright is the pre-installed one (the global npm root); browsers are
 * never installed by this script.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const inventory = JSON.parse(readFileSync(join(root, sources.inventory), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, sources.oracle.lock), 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const now = () => new Date().toISOString();

// ---- The oracle: axe-core exactly as the lock pins it, checked against the lock's integrity on read.
const pinned = lock.packages[`node_modules/${sources.oracle.package}`];
if (!pinned) throw new Error(`${sources.oracle.lock} does not pin ${sources.oracle.package}`);
const axeDir = dirname(require.resolve(`${sources.oracle.package}/package.json`));
const axeVersion = JSON.parse(readFileSync(join(axeDir, 'package.json'), 'utf8')).version;
if (axeVersion !== pinned.version) throw new Error(`installed axe-core ${axeVersion} is not the pinned ${pinned.version}; run npm ci`);
const tarball = Buffer.from(await (await fetch(pinned.resolved)).arrayBuffer());
const [algo, digest] = pinned.integrity.split('-');
if (createHash(algo).update(tarball).digest('base64') !== digest) throw new Error(`${pinned.resolved} does not match the lock's integrity`);
const axeSource = readFileSync(join(axeDir, 'axe.min.js'), 'utf8');

// The pre-installed Playwright, whose Chromium build is the one installed beside it; the locked development copy
// names a browser build this environment does not carry, and browsers are never downloaded here.
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const playwrightAt = require.resolve('playwright', { paths: [globalRoot] });
const { chromium, devices } = require(playwrightAt);
const playwrightVersion = JSON.parse(readFileSync(join(dirname(playwrightAt), 'package.json'), 'utf8')).version;
const configurations = [];
for (const [viewport, device] of Object.entries(sources.configurations.devices)) {
  if (!devices[device] || devices[device].defaultBrowserType !== 'chromium') throw new Error(`${device} is not a Chromium device of Playwright ${playwrightVersion}`);
  for (const scheme of sources.configurations.schemes) configurations.push({ viewport, device, scheme });
}

// ---- EN 301 549 V3.2.1, clause 9.
async function en301549() {
  const res = await fetch(sources.en301549.url);
  const fetchedAt = now();
  const bytes = Buffer.from(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), 'en301549-'));
  try {
    writeFileSync(join(dir, 'a.pdf'), bytes);
    execFileSync('pdftotext', ['-layout', join(dir, 'a.pdf'), join(dir, 'a.txt')]);
    const lines = readFileSync(join(dir, 'a.txt'), 'utf8').split('\n');
    const pdftotext = execFileSync('sh', ['-c', 'pdftotext -v 2>&1'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)[0];
    // A clause heading of the body is the number and title alone on a line; the table of contents and the
    // annex tables put more on the line, so they never match.
    const heads = [];
    lines.forEach((l, i) => { const m = l.match(/^(9\.[1-4]\.\d+\.\d+)\s{2,}(\S.*?)\s*$/); if (m) heads.push({ at: i, clause: m[1], title: m[2] }); });
    const clauses = heads.map((h, k) => {
      const body = lines.slice(h.at + 1, k + 1 < heads.length ? heads[k + 1].at : h.at + 40).join(' ').replace(/\s+/g, ' ');
      const m = body.match(/Where ICT is a web page, it shall satisfy WCAG 2\.1 Success Criterion (\d\.\d\.\d+)/);
      return { clause: h.clause, title: h.title, criterion: h.title === 'Void' ? '' : (m ? m[1] : null) };
    });
    const at = lines.findIndex((l) => /^9\.6\s+WCAG conformance requirements\s*$/.test(l));
    const requirements = [];
    if (at >= 0) {
      for (const l of lines.slice(at + 1, at + 20)) { const m = l.match(/^\s+(\d)\)\s+(\S.*?)\s*$/); if (m) requirements.push({ number: Number(m[1]), title: m[2] }); }
    }
    return { url: sources.en301549.url, status: res.status, fetchedAt, sha256: sha256(bytes), pdftotext, clauses, conformance: { clause: '9.6', requirements } };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- The pages.
const prefixOf = (u) => { const x = new URL(u); return `${x.origin}${x.pathname.replace(/[^/]*$/, '')}`; };
const services = inventory.services.map((s) => ({ ...s, id: inventory.assets[s.asset].id }));
const sitemapRes = await fetch(sources.sitemap.url);
const sitemapBytes = Buffer.from(await sitemapRes.arrayBuffer());
const sitemap = { url: sources.sitemap.url, status: sitemapRes.status, fetchedAt: now(), sha256: sha256(sitemapBytes), locs: [...sitemapBytes.toString('utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()) };
const siteOrigin = new URL(sources.sitemap.url).origin;
// A page belongs to the service whose URL is the longest prefix of it.
const slashed = (u) => (u.endsWith('/') ? u : `${u}/`);
const owner = (u) => services.filter((s) => s.url && slashed(u).startsWith(prefixOf(s.url)) && new URL(s.url).origin === new URL(u).origin).sort((a, b) => prefixOf(b.url).length - prefixOf(a.url).length)[0];
const properties = [];
const exclusions = [];
const website = services.find((s) => s.url === `${siteOrigin}/`);
properties.push({ service: website.id, url: website.url, discovery: 'sitemap', pages: sitemap.locs });
for (const s of services) {
  if (s.url && new URL(s.url).origin === siteOrigin) continue;
  if (!s.url) { exclusions.push({ service: s.id, url: '', reason: 'no-url' }); continue; }
  if (!s.deployed) { exclusions.push({ service: s.id, url: s.url, reason: 'not-deployed', status: s.httpStatus }); continue; }
  if (s.location && new URL(s.location).origin !== new URL(s.url).origin) { exclusions.push({ service: s.id, url: s.url, reason: 'third-party-host', location: s.location }); continue; }
  const res = await fetch(s.url);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  await res.arrayBuffer();
  if (type !== 'text/html') { exclusions.push({ service: s.id, url: s.url, reason: 'not-html', contentType: type, status: res.status }); continue; }
  properties.push({ service: s.id, url: s.url, discovery: 'crawl', pages: [s.url] });
}

// ---- One reading: a fresh context per configuration, the document's own bytes digested, axe run once.
const browser = await chromium.launch();
const browserVersion = browser.version();
async function read(url, cfg, links) {
  // A page's Content-Security-Policy would refuse the injected axe script; bypassing it is the only change made
  // to how the page is read, and every reading records that it was made.
  const context = await browser.newContext({ ...devices[cfg.device], colorScheme: cfg.scheme, bypassCSP: sources.configurations.bypassCSP });
  const page = await context.newPage();
  const fetchedAt = now();
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const body = res ? await res.body().catch(() => Buffer.alloc(0)) : Buffer.alloc(0);
    const type = res ? (res.headers()['content-type'] ?? '').split(';')[0].trim() : '';
    const reading = { ...cfg, bypassCSP: sources.configurations.bypassCSP, url, finalUrl: page.url(), status: res ? res.status() : 0, contentType: type, fetchedAt, sha256: sha256(body) };
    if (type !== 'text/html') return { reading: { ...reading, ran: false }, links: [] };
    let found = [];
    if (links) found = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
    await page.addScriptTag({ content: axeSource });
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const out = await axe.run(document, { resultTypes: ['violations', 'incomplete'] });
      const nodes = (x) => x.nodes.map((n) => ({ target: n.target.map((t) => (Array.isArray(t) ? t.join(' >>> ') : t)).join(' '), summary: (n.failureSummary ?? '').slice(0, 600) }));
      return {
        version: out.testEngine.version,
        violations: out.violations.map((x) => ({ id: x.id, impact: x.impact ?? '', nodes: nodes(x) })),
        incomplete: out.incomplete.map((x) => ({ id: x.id, impact: x.impact ?? '', nodes: nodes(x) })),
        passes: out.passes.map((x) => x.id),
        inapplicable: out.inapplicable.map((x) => x.id),
      };
    });
    if (r.version !== axeVersion) throw new Error(`axe ran as ${r.version}, not ${axeVersion}`);
    const cap = (xs) => xs.map((x) => ({ id: x.id, impact: x.impact, count: x.nodes.length, nodes: x.nodes.slice(0, 20) })).sort((a, b) => (a.id < b.id ? -1 : 1));
    return {
      reading: { ...reading, ran: true, violations: cap(r.violations), incomplete: cap(r.incomplete), passes: [...r.passes].sort(), inapplicable: [...r.inapplicable].sort() },
      links: found,
    };
  } catch (e) {
    return { reading: { ...cfg, url, finalUrl: page.url(), status: 0, contentType: '', fetchedAt, sha256: '', ran: false, error: String(e.message).split('\n')[0] }, links: [] };
  } finally { await context.close(); }
}

// The rule set: every rule of this axe-core, with the tags it maps by and its own help text.
const rules = await (async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent('<!doctype html><html lang="en"><title>rules</title></html>');
  await page.addScriptTag({ content: axeSource });
  const out = await page.evaluate(() => axe.getRules().map((x) => ({ id: x.ruleId, tags: x.tags, help: x.help, helpUrl: x.helpUrl })));
  await context.close();
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
})();

const pages = [];
for (const p of properties) {
  const seen = new Set(p.pages);
  const queue = [...p.pages];
  const prefix = prefixOf(p.url);
  let limited = false;
  while (queue.length) {
    const batch = queue.splice(0, 4);
    const done = await Promise.all(batch.map(async (url) => {
      const readings = [];
      let links = [];
      for (const [i, cfg] of configurations.entries()) {
        const r = await read(url, cfg, p.discovery === 'crawl' && i === 0);
        readings.push(r.reading);
        if (i === 0) links = r.links;
      }
      return { url, readings, links };
    }));
    for (const d of done) {
      const o = owner(d.url);
      pages.push({ url: d.url, property: p.service, service: o ? o.id : p.service, discovery: p.discovery, readings: d.readings });
      process.stderr.write(`${d.url}: ${d.readings.map((r) => (r.ran ? r.violations.length : 'x')).join(' ')}\n`);
      for (const href of d.links) {
        let u;
        try { u = new URL(href); } catch { continue; }
        u.hash = ''; u.search = '';
        const s = u.toString();
        if (!s.startsWith(prefix) || seen.has(s)) continue;
        if (seen.size >= sources.crawl.limit) { limited = true; continue; }
        seen.add(s); queue.push(s);
      }
    }
  }
  p.limited = limited;
  p.pages = [...seen];
}
await browser.close();

const snapshot = {
  spec: 'uor-community/accessibility-snapshot/1',
  takenAt: now(),
  tools: {
    axe: { version: axeVersion, resolved: pinned.resolved, integrity: pinned.integrity, script: `axe.min.js#sha256:${sha256(axeSource)}` },
    playwright: playwrightVersion,
    browser: `chromium ${browserVersion}`,
    devices: Object.fromEntries(Object.values(sources.configurations.devices).map((d) => [d, { viewport: devices[d].viewport, isMobile: devices[d].isMobile, userAgent: devices[d].userAgent }])),
  },
  en301549: await en301549(),
  sitemap,
  properties: properties.map((p) => ({ service: p.service, url: p.url, discovery: p.discovery, limited: Boolean(p.limited), pages: p.pages.length })),
  exclusions,
  rules,
  pages: pages.sort((a, b) => (a.url < b.url ? -1 : 1)),
};
writeFileSync(join(here, 'snapshot.json'), `${JSON.stringify(snapshot, null, 1)}\n`);
process.stdout.write(`${pages.length} pages, ${pages.length * configurations.length} readings, ${exclusions.length} services excluded\n`);
