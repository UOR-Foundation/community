#!/usr/bin/env node
/**
 * Snapshot the standard models and authorities the policy drafts read into
 * policies/snapshot.json. Each source in sources.json `web` is fetched once;
 * the snapshot keeps its URL, the fetch time, the sha256 of the bytes read,
 * and only what the register uses: the quotations each authority is cited
 * for, the text of the cited Colorado statute sections, the sections of the
 * Secretary of State's Articles of Amendment form, and the articles and
 * sections of the IRS Sample Conflict of Interest Policy, projected from the
 * PDF's own text layer and type (pdftohtml -xml) in reading order.
 *
 *   node policies/snapshot.mjs [--check]
 *
 * --check fetches again and fails when anything the register uses differs.
 * Fetch times differ on every run, and a page marked `dynamic` carries a
 * session or a per-request token, so its bytes are not compared, only what is
 * read from it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const entities = (s) => s.replace(/&nbsp;|&#160;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&sect;/g, '§').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const textOf = (html) => squash(entities(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')));

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      // eCFR serves its versioner API only to a client that accepts a compressed response.
      const res = await fetch(url, { headers: { 'accept-encoding': 'gzip, deflate' }, redirect: 'follow' });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      // A host that answers 200 with no body has not served the document; that is a failed fetch.
      if (!bytes.length) throw new Error(`${url}: empty body`);
      return { bytes, fetchedAt: new Date().toISOString() };
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
const withPdf = (bytes, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'policies-'));
  try { writeFileSync(join(dir, 'a.pdf'), bytes); return fn(join(dir, 'a.pdf'), dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
const pdfText = (bytes, layout) => withPdf(bytes, (pdf, dir) => { run('pdftotext', [...(layout ? ['-layout'] : []), pdf, join(dir, 'a.txt')]); return readFileSync(join(dir, 'a.txt'), 'utf8'); });
const quote = (text, pattern, where) => {
  const m = squash(text).match(new RegExp(pattern, 's'));
  if (!m) throw new Error(`${where}: the source no longer says /${pattern}/`);
  return m[0];
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

// The Secretary of State's form: each "Section N – Title" line, in number order, and the form's revision.
const formSections = (text, form) => {
  const sections = [...text.matchAll(/^\s*Section (\d+) – (.+?)\s*$/gm)].map((m) => ({ number: Number(m[1]), title: squash(m[2]) }));
  sections.sort((a, b) => a.number - b.number);
  sections.forEach((s, i) => { if (s.number !== i + 1) throw new Error(`${form} has no Section ${i + 1}`); s.sha256 = sha256(`${s.number} ${s.title}`); });
  const revised = text.match(new RegExp(`${form}\\s+Revised (\\d\\d/\\d\\d/\\d{4})`))?.[1];
  if (!revised) throw new Error(`${form} states no revision`);
  return { form, revised, pursuant: quote(text, 'Filed pursuant to [^\\n]+?\\(C\\.R\\.S\\.\\)', form), sections };
};

/**
 * The IRS Sample Conflict of Interest Policy, read from pdftohtml -xml: every text line with its page,
 * position, font size and bold runs. Lines are read column by column (the appendix is set in four
 * columns), top to bottom. An article heading is a wholly bold line in the size the line "Article I" is
 * set in; its title is the wholly bold line that follows. A section starts with a bold run "N." and its
 * title is that bold run, over as many lines as it stays bold. A heading line in the article size that
 * is not "Article <numeral>" is an article whose number the text layer does not state: it is recorded
 * with `numberStated: false` and the number that follows its predecessor's, and the projector requires
 * the sample's own cross-references to name it.
 */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
function coiSample(bytes, src) {
  const xml = withPdf(bytes, (pdf, dir) => { run('pdftohtml', ['-xml', '-i', '-q', '-nodrm', pdf, join(dir, 'x')]); return readFileSync(join(dir, 'x.xml'), 'utf8'); });
  const sizes = Object.fromEntries([...xml.matchAll(/<fontspec id="(\d+)" size="(\d+)"/g)].map((m) => [m[1], Number(m[2])]));
  const pages = [...xml.matchAll(/<page number="(\d+)"[^>]*width="(\d+)"[^>]*>([\s\S]*?)<\/page>/g)];
  const startPage = pages.findIndex((p) => p[3].includes(`<b>${src.heading}</b>`));
  if (startPage < 0) throw new Error(`i1023 has no ${src.heading}`);
  const lines = [];
  for (const [, number, width, body] of pages.slice(startPage)) {
    if (/<b>Appendix B:/.test(body)) break;
    const scale = Number(width) / src.columns.at(-1);
    for (const m of body.matchAll(/<text top="(-?\d+)" left="(\d+)" width="\d+" height="\d+" font="(\d+)">([\s\S]*?)<\/text>/g)) {
      const top = Number(m[1]) / scale;
      const left = Number(m[2]) / scale;
      const raw = m[4].replace(/<\/?i>/g, '');
      const text = entities(raw.replace(/<\/?b>/g, ''));
      // The proof slug above the page and the folio below it are outside the band the policy is set in; the
      // appendix heading names the model, not a part of it.
      if (top < src.band[0] || top > src.band[1] || !text.trim() || squash(text) === src.heading) continue;
      const bold = [...raw.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((b) => entities(b[1])).join('');
      const column = src.columns.findIndex((x, i) => left >= x && left < src.columns[i + 1]);
      lines.push({ page: Number(number), column, top, size: sizes[m[3]], text: text.replace(/\s+$/, ''), bold: bold.trim(), allBold: squash(bold) === squash(text) });
    }
  }
  lines.sort((a, b) => a.page - b.page || a.column - b.column || a.top - b.top);
  const headingSize = lines.find((l) => l.allBold && squash(l.text) === 'Article I')?.size;
  if (!headingSize) throw new Error('the sample has no "Article I" heading');
  // A line that ends in a hyphen and is followed by a lower-case word is one word broken across lines.
  const joined = (parts) => parts.reduce((acc, p) => (acc.endsWith('-') && /^[a-z]/.test(p) ? acc.slice(0, -1) + p : acc ? `${acc} ${p}` : p), '');
  const notes = [];
  const articles = [];
  let cur = null;
  let section = null;
  let titleOpen = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = squash(l.text);
    if (l.allBold && l.size === headingSize) {
      const stated = t.match(/^Article ([IVX]+)$/);
      const number = stated ? stated[1] : ROMAN[ROMAN.indexOf(articles.at(-1)?.number ?? '') + 1];
      cur = { number, numberStated: !!stated, title: stated ? '' : t, preamble: [], sections: [] };
      if (stated) { const next = lines[i + 1]; if (!next?.allBold) throw new Error(`Article ${number} has no title`); cur.title = squash(next.text); i++; }
      articles.push(cur);
      section = null;
      titleOpen = false;
      continue;
    }
    if (!cur) { notes.push(t); continue; }
    const sec = l.bold.match(/^(\d+)\.\s+(.*)$/);
    if (sec && l.text.trimStart().startsWith(l.bold.slice(0, 2))) {
      section = { number: Number(sec[1]), title: [sec[2].trim()], text: [] };
      const rest = squash(l.text.trimStart().slice(l.bold.length));
      if (rest) section.text.push(rest);
      titleOpen = !rest;
      cur.sections.push(section);
      continue;
    }
    if (section && titleOpen && l.allBold) { section.title.push(t); continue; }
    titleOpen = false;
    (section ? section.text : cur.preamble).push(l.text.trim());
  }
  const out = articles.map((a) => ({
    number: a.number,
    numberStated: a.numberStated,
    title: a.title,
    text: joined(a.preamble),
    sections: a.sections.map((s) => ({ number: s.number, title: joined(s.title), text: joined(s.text) })),
  }));
  for (const a of out) for (const s of [a, ...a.sections]) s.sha256 = sha256(`${s.title}\n${s.text}`);
  return { heading: src.heading, notes: joined(notes), articles: out };
}

const snapshot = { spec: 'uor-community/policies-snapshot/1', tools: { pdftotext: execFileSync('sh', ['-c', 'pdftotext -v 2>&1'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)[0], pdftohtml: execFileSync('sh', ['-c', 'pdftohtml -v 2>&1'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)[0] }, sources: [] };
for (const src of sources.web) {
  const got = await get(src.url);
  const rec = { key: src.key, kind: src.kind, url: src.url, dynamic: !!src.dynamic, fetchedAt: got.fetchedAt, bytes: got.bytes.length, sha256: sha256(got.bytes) };
  if (src.kind === 'html-quotes') {
    const text = textOf(got.bytes.toString('utf8'));
    rec.quotes = Object.fromEntries(Object.entries(src.quotes).map(([k, p]) => [k, quote(text, p, `${src.key}.${k}`)]));
  } else if (src.kind === 'pdf-quotes') {
    const text = pdfText(got.bytes, false);
    if (src.edition) rec.edition = quote(text, src.edition, `${src.key} edition`);
    rec.quotes = Object.fromEntries(Object.entries(src.quotes).map(([k, p]) => [k, quote(text, p, `${src.key}.${k}`)]));
  } else if (src.kind === 'statute-pdf') {
    const text = pdfText(got.bytes, true);
    if (!text.includes(src.edition)) throw new Error(`${src.key} is not the ${src.edition}`);
    rec.edition = src.edition;
    rec.sections = statuteSections(text, src.sections);
  } else if (src.kind === 'sos-form') {
    rec.model = formSections(pdfText(got.bytes, false), src.form);
  } else if (src.kind === 'irs-coi-sample') {
    rec.model = coiSample(got.bytes, src);
  } else throw new Error(`unknown source kind ${src.kind}`);
  snapshot.sources.push(rec);
  process.stderr.write(`${src.key}\n`);
}

const target = join(here, 'snapshot.json');
if (process.argv[2] === '--check') {
  const strip = (s) => JSON.stringify(s, (k, v) => (k === 'fetchedAt' ? undefined : v), 0);
  const volatile = (s) => ({ ...s, sources: s.sources.map((x) => (x.dynamic ? { ...x, bytes: undefined, sha256: undefined } : x)) });
  if (!existsSync(target) || strip(volatile(JSON.parse(readFileSync(target, 'utf8')))) !== strip(volatile(snapshot))) {
    process.stderr.write('policies/snapshot.json differs from the live sources; re-snapshot and re-project\n');
    process.exit(1);
  }
} else writeFileSync(target, `${JSON.stringify(snapshot, null, 1)}\n`);
process.stdout.write(`${snapshot.sources.length} sources\n`);
