#!/usr/bin/env node
/**
 * Read each candidate standard's scope from its issuer into standards/snapshot.json.
 *
 * For every candidate of standards/candidates.json whose source is an issuer
 * page, the page is fetched once, its bytes are addressed by sha256 with the
 * time they were read, and its scope is quoted from the page's own words: an
 * ISO page's abstract (following "Revised by" to the published edition when
 * the page is withdrawn), or, on any other page, the sentence that begins at
 * the candidate's anchor. A clause pattern, where the candidate names one,
 * lists the clauses the page itself numbers. A page that cannot be read, or
 * that does not hold its anchor, is recorded with what was returned and no
 * quote: the scope is never written by hand. The security facet's standards
 * table is read from security/README.md at the commit standards/parts.json
 * pins. Only the extracted fields are kept, so the snapshot changes only when
 * an issuer's statement does; --check re-reads every page and fails when a
 * quote, edition, status or clause list has changed.
 *
 *   node standards/snapshot.mjs [--check]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { candidates } = JSON.parse(readFileSync(join(here, 'candidates.json'), 'utf8'));
const { facets } = JSON.parse(readFileSync(join(here, 'parts.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'standards-'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// One read of a URL: the final status, the bytes and when they were read.
function fetchPage(url) {
  const file = join(scratch, 'page');
  rmSync(file, { force: true });
  let status = 0;
  try {
    status = Number(execFileSync('curl', ['-sS', '-L', '--compressed', '-A', 'Mozilla/5.0 (compatible; uor-standards-register)', '--max-time', '60', '-o', file, '-w', '%{http_code}', url], { encoding: 'utf8' }));
  } catch { status = 0; }
  const bytes = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  return { status, bytes, fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', reg: '®', copy: '©', trade: '™', sect: '§' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m));
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const htmlText = (s) => flat(decode(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')));
function pageText(bytes) {
  if (bytes.subarray(0, 4).toString() === '%PDF') {
    const pdf = join(scratch, 'page.pdf');
    writeFileSync(pdf, bytes);
    return flat(execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  }
  return htmlText(bytes.toString('utf8'));
}
const pdftotext = execFileSync('sh', ['-c', 'pdftotext -v 2>&1'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)[0];

// The quote: from the anchor to the end of its sentence (or of `sentences` sentences, or through `until`).
function quoteAt(text, source) {
  const at = text.indexOf(source.anchor);
  if (at < 0) return '';
  const rest = text.slice(at);
  if (source.until) {
    const end = rest.indexOf(source.until);
    return end < 0 ? '' : rest.slice(0, end + source.until.length);
  }
  let end = 0;
  for (let n = 0; n < (source.sentences ?? 1); n++) {
    const m = rest.slice(end).match(/[.!?](?=\s|$)/);
    if (!m) return '';
    end += m.index + 1;
  }
  return rest.slice(0, end);
}
const clausesOf = (text, pattern) => (pattern ? [...new Set([...text.matchAll(new RegExp(pattern, 'g'))].map((m) => m.slice(1).filter(Boolean).join(' ')))] : []);

// An ISO page: designation, status, edition, publication date and abstract, as the page states them.
function isoRecord(url) {
  const chain = [];
  let next = url;
  for (let hop = 0; hop < 4 && next; hop++) {
    const { status, bytes, fetchedAt } = fetchPage(next);
    const html = bytes.toString('utf8');
    const title = flat(decode(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''));
    const pubStatus = flat(html.match(/id="publicationStatus">[\s\S]*?<span>([\s\S]*?)<\/span>/)?.[1] ?? '');
    const date = flat(html.match(/itemprop="releaseDate">([^<]*)</)?.[1] ?? '');
    const edition = flat(html.match(/entry-label">Edition<\/div>&nbsp;:&nbsp;(\d+)/)?.[1] ?? '');
    const desc = html.indexOf('itemprop="description"');
    const paragraphs = desc < 0 ? [] : [...html.slice(desc, html.indexOf('</div>', desc)).matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => htmlText(m[1])).filter(Boolean);
    const revised = html.match(/Revised by<\/h3>[\s\S]*?section-head">Published<\/div>\s*<h4><a href="(\/standard\/[^"]+)">/);
    // A page with no abstract states its scope in its "What is ISO ...?" overview, which is then quoted instead.
    const overview = htmlText(html).match(/What is ISO[^?]*\? (.*)/)?.[1] ?? '';
    const quote = paragraphs.length ? paragraphs.slice(0, 2).join(' ') : quoteAt(overview, { anchor: overview.slice(0, 20), sentences: 2 });
    chain.push({ url: next, status, fetchedAt, sha256: sha256(bytes), bytes: bytes.length, title, publicationStatus: pubStatus, publicationDate: date, edition, quoteFrom: paragraphs.length ? 'abstract' : quote ? 'overview' : '', quote });
    next = pubStatus === 'Withdrawn' && revised ? new URL(revised[1], next).href : '';
  }
  return chain;
}

const records = [];
for (const c of candidates) {
  const s = c.source;
  if (s.kind === 'iso') {
    const chain = isoRecord(s.url);
    const last = chain[chain.length - 1];
    records.push({ id: c.id, kind: 'iso', ...last, supersedes: chain.slice(0, -1).map((x) => ({ url: x.url, title: x.title, publicationStatus: x.publicationStatus, sha256: x.sha256, fetchedAt: x.fetchedAt })), clauses: [] });
  } else if (s.kind === 'page') {
    const { status, bytes, fetchedAt } = fetchPage(s.url);
    const text = status === 200 ? pageText(bytes) : '';
    records.push({ id: c.id, kind: 'page', url: s.url, status, fetchedAt, sha256: sha256(bytes), bytes: bytes.length, quote: quoteAt(text, s), clauses: clausesOf(text, s.clauses) });
  }
}

// The security facet's own table of the standards it implements, at the pinned commit.
const security = facets.find((f) => f.id === 'security');
const readmeUrl = `https://raw.githubusercontent.com/UOR-Foundation/community/${security.commit}/security/README.md`;
const readme = fetchPage(readmeUrl);
const section = readme.bytes.toString('utf8').split('\n## Standards\n')[1]?.split('\n## ')[0] ?? '';
const securityTable = section.split('\n').filter((l) => /^\| /.test(l) && !/^\| (What|---)/.test(l)).map((l) => l.split('|').map((x) => x.trim())[2]);
rmSync(scratch, { recursive: true });

const snapshot = {
  spec: 'uor-community/standards-snapshot/1',
  tools: { curl: execFileSync('curl', ['--version'], { encoding: 'utf8' }).split(' ')[1], pdftotext },
  security: { url: readmeUrl, status: readme.status, fetchedAt: readme.fetchedAt, sha256: sha256(readme.bytes), standards: securityTable },
  records,
};
const target = join(here, 'snapshot.json');
// What an issuer states, without when it was read or the bytes around it, which change on every read.
const stated = (x) => JSON.stringify({
  security: x.security.standards,
  records: x.records.map((r) => ({ id: r.id, url: r.url, status: r.status, title: r.title, publicationStatus: r.publicationStatus, edition: r.edition, quote: r.quote, clauses: r.clauses })),
});
if (process.argv[2] === '--check') {
  if (!existsSync(target) || stated(JSON.parse(readFileSync(target, 'utf8'))) !== stated(snapshot)) {
    process.stderr.write('standards/snapshot.json differs from what the issuers now state; re-snapshot and re-project\n');
    process.exit(1);
  }
} else writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`);
const quoted = records.filter((r) => r.quote).length;
process.stdout.write(`${records.length} issuer pages read, ${quoted} scopes quoted, ${securityTable.length} security standards\n`);
