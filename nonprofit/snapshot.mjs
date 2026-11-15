#!/usr/bin/env node
/**
 * Snapshot the public records, statutes, regulations, forms and instructions
 * the nonprofit register reads into nonprofit/snapshot.json. Each source in
 * sources.json `web` is fetched once; the snapshot keeps its URL, the fetch
 * time, the sha256 of the bytes read, and only what the register uses: the
 * Colorado Secretary of State's entity fields and filing history, the text of
 * the cited statute sections, the quotations each authority is cited for, the
 * Form 990 Part VI line items, and for each IRS data file its row count and
 * how many organization names match the Foundation's legal name.
 *
 * Personal data is never kept. The Secretary of State's records name a
 * registered agent, incorporators and filers with their addresses; the
 * snapshot keeps none of it, only the filed document's type, number, date,
 * digest and the clauses about the corporation itself.
 *
 *   node nonprofit/snapshot.mjs [--check]
 *
 * --check fetches again and fails when anything the register uses differs.
 * Fetch times differ on every run, and the Secretary of State's pages carry a
 * session, and its filed documents are rendered on each request, so their
 * bytes differ too; neither is compared, only what is read from them.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const entities = (s) => s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const textOf = (html) => squash(entities(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')));

// One cookie jar per host: the Secretary of State's history and document pages need the session the detail page opens.
const jar = new Map();
async function get(url, init = {}) {
  const host = new URL(url).host;
  const headers = { 'accept-encoding': 'gzip, deflate', ...(init.headers ?? {}) };
  if (jar.has(host)) headers.cookie = [...jar.get(host)].map(([k, v]) => `${k}=${v}`).join('; ');
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers, redirect: 'follow' });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const cookies = jar.get(host) ?? new Map();
      for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
      jar.set(host, cookies);
      return { bytes: Buffer.from(await res.arrayBuffer()), fetchedAt: new Date().toISOString(), type: res.headers.get('content-type') ?? '' };
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
const pdfText = (bytes, layout) => {
  const dir = mkdtempSync(join(tmpdir(), 'nonprofit-'));
  try {
    writeFileSync(join(dir, 'a.pdf'), bytes);
    execFileSync('pdftotext', [...(layout ? ['-layout'] : []), join(dir, 'a.pdf'), join(dir, 'a.txt')], { stdio: ['ignore', 'ignore', 'ignore'] });
    return readFileSync(join(dir, 'a.txt'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
// A quotation is found in the source's text with its whitespace collapsed; the snapshot keeps the words found.
const quote = (text, pattern, where) => {
  const m = squash(text).match(new RegExp(pattern, 's'));
  if (!m) throw new Error(`${where}: the source no longer says /${pattern}/`);
  return m[0];
};

// The organization-name search the brief and sources.json define: every token of the legal name but the article.
const tokens = (name) => new Set(String(name).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
const matches = (name, want) => { const t = tokens(name); return want.every((w) => t.has(w)); };
// RFC 4180 fields of one CSV line (the IRS files quote no field that holds a line break).
const csvFields = (line) => {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
};
// The single member of a ZIP archive (PKWARE APPNOTE 6.3.10, 4.3.7 local file header), inflated in memory.
const unzipOne = (zip) => {
  if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error('not a ZIP local file header');
  const method = zip.readUInt16LE(8);
  const start = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
  if (method !== 8) throw new Error(`ZIP method ${method} is not deflate`);
  return { name: zip.subarray(30, 30 + zip.readUInt16LE(26)).toString('utf8'), data: inflateRawSync(zip.subarray(start)) };
};
const nameSearch = (src, bytes) => {
  let text;
  let member = '';
  if (src.format === 'zip-pipe') { const one = unzipOne(bytes); text = one.data.toString('utf8'); member = one.name; } else text = bytes.toString('utf8');
  const lines = text.split(/\r?\n/);
  let column = src.nameColumn;
  let split = (l) => l.split('|');
  let body = lines;
  if (src.format === 'csv') {
    const header = csvFields(lines[0]);
    column = header.indexOf(src.nameColumn);
    if (column < 0) throw new Error(`${src.key}: no column ${src.nameColumn}`);
    split = csvFields;
    body = lines.slice(1);
  }
  let rows = 0;
  let matched = 0;
  let near = 0;
  for (const l of body) {
    if (!l.trim()) continue;
    rows += 1;
    const name = split(l)[column] ?? '';
    if (matches(name, sources.search.tokens)) matched += 1;
    if (matches(name, sources.search.near)) near += 1;
  }
  return { member, rows, matched, near };
};

// The Colorado Revised Statutes printout: a section runs from its heading to the next section's, without page footers.
const statuteSections = (text, wanted) => {
  const lines = text.split('\n').filter((l) => !/^Colorado Revised Statutes \d{4}\s+Page \d+ of \d+\s+Uncertified Printout\s*$/.test(l.trim()));
  const heading = /^\s*(\d+-\d+-\d+(?:\.\d+)?)\.\s+(.*)$/;
  const out = {};
  for (const ref of wanted) {
    const at = lines.findIndex((l) => { const m = l.match(heading); return m && m[1] === ref; });
    if (at < 0) throw new Error(`the printout has no section ${ref}`);
    let end = at + 1;
    while (end < lines.length && !heading.test(lines[end]) && !/^\s*(ARTICLE|PART) \d+\s*$/.test(lines[end])) end++;
    const body = squash(lines.slice(at, end).join(' '));
    const title = body.match(/^\S+\. (.+?)\.(?: \(|\s)/)[1];
    out[ref] = { title, text: body, sha256: sha256(body) };
  }
  return out;
};

// Form 990 Part VI: each line item's number and question, in the order the form prints them.
const partSix = (text) => {
  const from = text.search(/Part VI\s+Governance, Management, and Disclosure/);
  const to = text.slice(from).search(/\n\s*Part VII\s+Compensation/) + from;
  if (from < 0 || to < from) throw new Error('Form 990 has no Part VI');
  const lines = text.slice(from, to).split('\n');
  const items = [];
  let section = '';
  let number = '';
  let cur = null;
  for (const raw of lines) {
    const sec = raw.match(/^\s*(Section [ABC]\.\s+.+?)\s*(?:\(continued\))?\s*(?:Yes\s+No)?\s*$/);
    if (sec) { section = squash(sec[1]); cur = null; continue; }
    if (/^\s*Form 990 \(\d{4}\)|^\s*Page \d+\s*$|Check if Schedule O contains/.test(raw)) { cur = null; continue; }
    const m = raw.match(/^\s{0,6}(\d{1,2})?\s*([a-c])?\s{1,}(\S.*)$/);
    const startsItem = m && (m[1] || m[2]) && !/^\s{7,}/.test(raw);
    if (startsItem) {
      if (m[1]) number = m[1];
      const id = `${number}${m[2] ?? ''}`;
      cur = { line: id, section, question: '' };
      items.push(cur);
      cur.question = m[3];
    } else if (cur && section) cur.question += ` ${raw.trim()}`;
  }
  // The dot leaders and the answer-column label the form prints after each question are layout, not words.
  for (const it of items) it.question = squash(it.question.replace(/(?:\s*\.){2,}/g, ' ').replace(new RegExp(`\\s${it.line}(?=\\s|$)`, 'g'), ' ').replace(/\s+(Yes|No)\s*$/, '')).replace(/ \.$/, '');
  const kept = items.filter((it) => it.section && it.question);
  for (const it of kept) it.sha256 = sha256(it.question);
  return kept;
};
// The titles of the financial Parts the register asks for (Parts I, VIII, IX and X).
const partTitles = (text) => {
  const want = { I: /Part I\s+Summary/, VIII: /Part VIII\s+Statement of Revenue/, IX: /Part IX\s+Statement of Functional Expenses/, X: /Part X\s+Balance Sheet/ };
  return Object.fromEntries(Object.entries(want).map(([k, re]) => { const m = squash(text).match(new RegExp(`${re.source}`)); if (!m) throw new Error(`Form 990 has no Part ${k}`); return [k, m[0]]; }));
};

// The Secretary of State's summary: each <th> label and the <td> that follows it.
const sosFields = (html, fields) => {
  const out = {};
  for (const m of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const label = textOf(m[1]);
    // The first table is the entity's own; later tables name its registered agent, whom the snapshot does not keep.
    if (fields.includes(label) && !(label in out)) out[label] = textOf(m[2]);
  }
  for (const f of fields) if (!(f in out)) throw new Error(`the Secretary of State summary has no ${f}`);
  return out;
};
const sosHistory = (html) => {
  const events = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 7 || !/^\d+$/.test(textOf(cells[0]))) continue;
    const doc = cells[5].match(/fileId=(\d+)/)?.[1] ?? '';
    events.push({ event: textOf(cells[1]), dateFiled: textOf(cells[2]), datePosted: textOf(cells[3]), effective: textOf(cells[4]), document: doc, comment: textOf(cells[6]) });
  }
  if (!events.length) throw new Error('the Secretary of State history has no events');
  return events;
};
// What a filed document says about the corporation itself; never a person's name or address.
const DOCUMENT_CLAUSES = {
  title: /^\s*(Articles of Incorporation for a Nonprofit Corporation|Statement of Change|Periodic Report|Articles of Amendment[^\n]*?)\s*$/m,
  pursuant: /^\s*(?:filed|Filed) pursuant to (.+)$/m,
  filedOn: /Filed on: (\d\d\/\d\d\/\d{4})/,
  voting: /^(There (?:are|are no) voting members for the nonprofit corporation\.)$/m,
  dissolution: /(Upon dissolution, assets shall be distributed .+?\.)\s*(?:\n\s*\n|Causing)/s,
  agentConsent: /(The person (?:above has agreed to be appointed|appointed as registered agent has consented)[^.]*\.)/,
  jurisdiction: /Jurisdiction under the law of which the entity was formed or registered is\s+(\S+)/,
};
const documentFacts = (text) => {
  const facts = {};
  for (const [k, re] of Object.entries(DOCUMENT_CLAUSES)) { const m = text.match(re); if (m) facts[k] = squash(m[1]); }
  // The organizational test reads the articles for a statement of purposes; the word is searched for, not inferred.
  facts.statesPurposes = /\bpurposes?\b/i.test(text);
  return facts;
};

async function ccsaSearch(src) {
  const run = async (q) => {
    jar.delete(new URL(src.url).host);
    const page = (await get(src.url)).bytes.toString('utf8');
    const state = page.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)?.[1];
    if (!state) throw new Error('the charities search has no view state');
    const body = new URLSearchParams({ basicSearchForm: 'basicSearchForm', 'basicSearchForm:basicSearch': q, 'basicSearchForm:searchButton': 'Search', 'javax.faces.ViewState': state });
    const res = await get(src.url, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    return { query: q, results: /No results found/.test(res.bytes.toString('utf8')) ? 0 : null, sha256: sha256(res.bytes), fetchedAt: res.fetchedAt };
  };
  const control = await run(src.control);
  // The control is an organization the registry holds; a search that finds it shows the method can find a record.
  if (control.results === 0) throw new Error(`the charities search finds no ${src.control}; the method is broken`);
  const queries = [];
  for (const q of src.queries) queries.push(await run(q));
  return { control: { query: control.query, found: true }, queries: queries.map(({ query, results, sha256: d, fetchedAt }) => ({ query, found: results !== 0, sha256: d, fetchedAt })) };
}

const snapshot = { spec: 'uor-community/nonprofit-snapshot/1', tools: { pdftotext: execFileSync('sh', ['-c', 'pdftotext -v 2>&1'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)[0] }, search: sources.search, sources: [] };
for (const src of sources.web) {
  const rec = { key: src.key, kind: src.kind, url: src.url, dynamic: !!src.dynamic };
  if (src.kind === 'ccsa-search') { Object.assign(rec, await ccsaSearch(src)); snapshot.sources.push(rec); continue; }
  const got = await get(src.url);
  Object.assign(rec, { fetchedAt: got.fetchedAt, bytes: got.bytes.length, sha256: sha256(got.bytes) });
  if (src.kind === 'sos-entity') {
    rec.fields = sosFields(got.bytes.toString('latin1'), src.fields);
    rec.fieldsSha256 = sha256(JSON.stringify(rec.fields));
  } else if (src.kind === 'sos-history') {
    rec.events = sosHistory(got.bytes.toString('latin1'));
    rec.documents = [];
    for (const e of rec.events.filter((x) => x.document)) {
      const doc = await get(src.document.replace('{id}', e.document));
      if (!/^%PDF-/.test(doc.bytes.subarray(0, 5).toString('latin1'))) throw new Error(`document ${e.document} is not a PDF`);
      rec.documents.push({ document: e.document, url: src.document.replace('{id}', e.document), fetchedAt: doc.fetchedAt, sha256: sha256(doc.bytes), facts: documentFacts(pdfText(doc.bytes, true)) });
    }
  } else if (src.kind === 'html-quotes') {
    const text = textOf(got.bytes.toString('utf8'));
    rec.quotes = Object.fromEntries(Object.entries(src.quotes).map(([k, p]) => [k, quote(text, p, `${src.key}.${k}`)]));
  } else if (src.kind === 'pdf-quotes') {
    const text = pdfText(got.bytes, false);
    rec.quotes = Object.fromEntries(Object.entries(src.quotes).map(([k, p]) => [k, quote(text, p, `${src.key}.${k}`)]));
  } else if (src.kind === 'statute-pdf') {
    const text = pdfText(got.bytes, true);
    if (!text.includes(src.edition)) throw new Error(`${src.key} is not the ${src.edition}`);
    rec.edition = src.edition;
    rec.sections = statuteSections(text, src.sections);
  } else if (src.kind === 'form-990-part-vi') {
    const text = pdfText(got.bytes, true);
    rec.edition = squash(text.match(/Form\s+990\s+\((\d{4})\)/)?.[0] ?? '');
    rec.partVI = partSix(text);
    rec.parts = partTitles(text);
  } else if (src.kind === 'name-search') {
    Object.assign(rec, nameSearch(src, got.bytes));
  } else throw new Error(`unknown source kind ${src.kind}`);
  snapshot.sources.push(rec);
  process.stderr.write(`${src.key}\n`);
}

const text = `${JSON.stringify(snapshot, null, 1)}\n`;
const target = join(here, 'snapshot.json');
if (process.argv[2] === '--check') {
  // Compare what the register reads: everything but fetch times, and the bytes of a page that carries a session.
  const strip = (s) => JSON.stringify(s, (k, v) => (k === 'fetchedAt' ? undefined : v), 0);
  const volatile = (s) => ({ ...s, sources: s.sources.map((x) => (x.dynamic ? { ...x, bytes: undefined, sha256: undefined, queries: x.queries?.map((q) => ({ ...q, sha256: undefined })), documents: x.documents?.map((d) => ({ ...d, sha256: undefined })) } : x)) });
  if (!existsSync(target) || strip(volatile(JSON.parse(readFileSync(target, 'utf8')))) !== strip(volatile(snapshot))) {
    process.stderr.write('nonprofit/snapshot.json differs from the live sources; re-snapshot and re-project\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
process.stdout.write(`${snapshot.sources.length} sources\n`);
