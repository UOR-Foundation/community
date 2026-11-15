#!/usr/bin/env node
/**
 * Project the UOR Foundation's nonprofit legal, tax and finance compliance
 * register from its pinned sources.
 *
 * The entity is a Schema.org NGO and a W3C ORG FormalOrganization, identified
 * by the Colorado Secretary of State's entity ID; its fields are the Secretary
 * of State's own, read from nonprofit/snapshot.json. Its obligations are the
 * duties nonprofit/obligations.json declares, each citing the statute,
 * regulation, IRS instruction, agency page or Bylaws provision that imposes
 * it, with the W3C ORG Post of governance/register.json responsible for it.
 * IRS Form 990 Part VI is projected line by line from the form itself.
 *
 * Nothing is defaulted or guessed. Whether an obligation is discharged is
 * evaluated from what the snapshot observed; an obligation whose evidence is
 * not public, whose trigger cannot be observed, or whose evidence shows it
 * undone is an open claim, as is every Part VI line no public source answers,
 * every financial figure the returns need, and every public statement no
 * authority confirms. An absence in public data is recorded as an observation
 * (what was searched, how, and what matched), never as a finding about the
 * Foundation's conduct. The same inputs always project the same bytes.
 *
 *   node nonprofit/project.mjs <checkouts-dir> [--check]
 *
 * <checkouts-dir> holds one clone per repository in sources.json, named by its
 * `name`.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const bytesOf = (p) => readFileSync(join(repoRoot, p));
const json = (p) => JSON.parse(bytesOf(p).toString('utf8'));
const sources = json('nonprofit/sources.json');
const declared = json('nonprofit/obligations.json');
const snapshot = json('nonprofit/snapshot.json');
const governance = json(sources.governance);
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <checkouts-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const git = (repo, ...args) => execFileSync('git', ['-C', join(root, repo.name), ...args], { maxBuffer: 1 << 26 });
const web = new Map(snapshot.sources.map((s) => [s.key, s]));
const need = (key) => { if (!web.has(key)) throw new Error(`the snapshot has no source ${key}`); return web.get(key); };

const claims = [];
const claim = (area, subjectKind, subject, refusal, detail, closes) => claims.push({ area, subjectKind, subject, refusal, detail, closes });

// ---- Sources: each git document at its commit, the in-repository inputs, and every snapshot fetch.
const sourceList = [];
const docs = {};
for (const repo of sources.repositories) {
  const at = git(repo, 'rev-parse', `${repo.commit}^{commit}`).toString().trim();
  if (at !== repo.commit) throw new Error(`${repo.name} does not hold the pinned ${repo.commit}`);
  for (const [key, path] of Object.entries(repo.documents)) {
    const bytes = git(repo, 'show', `${repo.commit}:${path}`);
    docs[key] = { repo, path, bytes };
    sourceList.push({ key, url: `${repo.url}/blob/${repo.commit}/${path}`, fetchedAt: '', digest: `sha256:${sha256(bytes)}` });
  }
}
for (const path of [sources.governance, sources.app, 'nonprofit/obligations.json', 'nonprofit/snapshot.json']) sourceList.push({ key: path, url: path, fetchedAt: '', digest: `sha256:${sha256(bytesOf(path))}` });
for (const s of snapshot.sources) {
  if (s.kind === 'ccsa-search') { for (const q of s.queries) sourceList.push({ key: `${s.key}:${q.query}`, url: s.url, fetchedAt: q.fetchedAt, digest: `sha256:${q.sha256}` }); continue; }
  sourceList.push({ key: s.key, url: s.url, fetchedAt: s.fetchedAt, digest: `sha256:${s.sha256}` });
  for (const d of s.documents ?? []) sourceList.push({ key: `${s.key}:${d.document}`, url: d.url, fetchedAt: d.fetchedAt, digest: `sha256:${d.sha256}` });
}
const sourceIndex = (key) => { const i = sourceList.findIndex((s) => s.key === key); if (i < 0) throw new Error(`no source ${key}`); return i; };

// The Bylaws read here are the bytes governance/register.json projected; their provisions are referenced, not re-read.
const govBylaws = governance.sources.find((s) => s.document === 'bylaws');
if (docs.bylaws.repo.commit !== govBylaws.commit || sha256(docs.bylaws.bytes) !== govBylaws.sha256) throw new Error('the Bylaws pinned here are not the ones governance/register.json projects');
const scratch = mkdtempSync(join(tmpdir(), 'nonprofit-'));
writeFileSync(join(scratch, 'b.pdf'), docs.bylaws.bytes);
execFileSync('pdftotext', ['-layout', join(scratch, 'b.pdf'), join(scratch, 'b.txt')]);
const bylawsText = squash(readFileSync(join(scratch, 'b.txt'), 'utf8').replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
rmSync(scratch, { recursive: true });
const pdftotext = execFileSync('sh', ['-c', 'pdftotext -v 2>&1'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)[0];

// ---- The entity: the Secretary of State's fields, ISO 3166-2 for its jurisdiction.
const sos = need('sos-entity').fields;
if (sos.Name !== sources.entity.legalName || sos['ID number'] !== sources.entity.coloradoId) throw new Error('the Secretary of State record is not the pinned entity');
if (sos.Jurisdiction !== 'Colorado' || sources.entity.jurisdiction !== 'US-CO') throw new Error(`the entity's jurisdiction is ${sos.Jurisdiction}, not the US-CO the authorities are read for`);
const [mm, dd, yyyy] = sos['Formation date'].split('/').map(Number);
const iso = (d) => d.toISOString().slice(0, 10);
const endOfMonthAfter = (months) => new Date(Date.UTC(yyyy, mm - 1 + months + 1, 0));
const history = need('sos-history');
const articlesDoc = history.documents.find((d) => d.facts.title === 'Articles of Incorporation for a Nonprofit Corporation');
if (!articlesDoc) throw new Error('the history holds no Articles of Incorporation');

// ---- Authorities: every provision an obligation, a post's basis or a need cites, resolved to its pinned source.
const authorities = [];
const authorityIndex = new Map();
const bylawsJurisdiction = /construed in accordance with the laws of the State of Colorado/.test(bylawsText) ? 'US-CO' : null;
if (!bylawsJurisdiction) throw new Error('Bylaws 13.1 no longer names Colorado law');
const authority = (key) => {
  if (authorityIndex.has(key)) return authorityIndex.get(key);
  const [src, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  let a;
  if (src === 'crs') {
    const title = ref.startsWith('6-') ? 'crs-title-6' : 'crs-title-7';
    const s = need(title).sections[ref];
    if (!s) throw new Error(`the snapshot holds no C.R.S. ${ref}`);
    a = { key, instrument: 'statute', ref: `C.R.S. ${ref}`, title: s.title, jurisdiction: 'US-CO', source: sourceIndex(title), quote: s.text.slice(0, 240), textSha256: s.sha256 };
  } else if (src === 'bylaws') {
    const p = governance.provisions.findIndex((x) => x.key === key);
    if (p < 0) throw new Error(`governance/register.json has no provision ${key}`);
    a = { key, instrument: 'bylaws', ref: `Bylaws ${governance.provisions[p].ref}`, title: governance.provisions[p].title, jurisdiction: bylawsJurisdiction, source: sourceIndex('bylaws'), quote: '', textSha256: governance.provisions[p].sha256, provision: p };
  } else if (src === 'f990') {
    const t = need('f990').parts[ref];
    if (!t) throw new Error(`Form 990 has no Part ${ref}`);
    a = { key, instrument: 'form', ref: `Form 990 Part ${ref}`, title: t, jurisdiction: 'US', source: sourceIndex('f990'), quote: t, textSha256: sha256(t) };
  } else {
    const s = need(src);
    const q = s.quotes?.[ref];
    if (!q) throw new Error(`${src} has no quotation ${ref}`);
    const kind = /^usc-/.test(src) ? 'statute' : /^cfr-/.test(src) ? 'regulation' : /^sos-/.test(src) ? 'agencyGuidance' : 'instructions';
    const cite = sources.web.find((w) => w.key === src).cites?.[ref];
    if (!cite) throw new Error(`sources.json gives no citation for ${key}`);
    a = { key, instrument: kind, ref: cite, title: q.slice(0, 120), jurisdiction: /^sos-/.test(src) ? 'US-CO' : 'US', source: sourceIndex(src), quote: q, textSha256: sha256(q) };
  }
  authorityIndex.set(key, authorities.length);
  authorities.push(a);
  return authorities.length - 1;
};

// ---- Posts: every W3C ORG Post of the governance register, in its order, so an index here is the index there.
const posts = governance.posts.map((p, i) => ({ name: p.name, unit: governance.units[p.unit].name, governanceIndex: i }));
const postOf = (name) => {
  const spec = declared.posts[name];
  if (!spec) throw new Error(`obligations.json assigns no basis to the post ${name}`);
  const i = posts.findIndex((p) => p.name === name && p.unit === spec.unit);
  if (i < 0) throw new Error(`governance/register.json has no post ${name} of the ${spec.unit}`);
  return { post: i, basis: authority(spec.basis) };
};

// ---- Filings, as the Secretary of State's history lists them.
const filings = history.events.map((e) => {
  const doc = history.documents.find((d) => d.document === e.document);
  return { event: e.event, dateFiled: e.dateFiled, document: e.document, comment: e.comment, documentDigest: doc ? `sha256:${doc.sha256}` : '' };
});
const asDate = (mdy) => { const [m, d, y] = mdy.split('/').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fetched = new Date(history.fetchedAt);

// ---- IRS public data: what was searched, how, and what matched.
const RECOGNITION = /^(bmf-|pub78$)/;
const observations = snapshot.sources.filter((s) => s.kind === 'name-search').map((s) => ({
  dataset: s.key, url: s.url, source: sourceIndex(s.key), shows: RECOGNITION.test(s.key) ? 'recognition' : 'filing', rows: s.rows, matched: s.matched, near: s.near, fetchedAt: s.fetchedAt,
}));
const recognitionMatched = observations.filter((o) => o.shows === 'recognition').reduce((n, o) => n + o.matched, 0);
const filingMatched = observations.filter((o) => o.shows === 'filing').reduce((n, o) => n + o.matched, 0);
const searched = (shows) => observations.filter((o) => o.shows === shows).map((o) => `${o.dataset} ${o.matched}/${o.rows}`).join(', ');
const method = `${snapshot.search.about} Searched ${fetched.toISOString().slice(0, 10)}.`;

// ---- Website statements of status, read at the pinned commit.
const website = sources.repositories.find((r) => r.name === 'website');
const statements = [];
const grep = git(website, 'grep', '-n', '-F', '501(c)(3)', website.commit, '--', 'src', ':(exclude)src/docs/*.generated.ts').toString().trim().split('\n').filter(Boolean);
for (const line of grep) {
  const m = line.match(/^[0-9a-f]+:([^:]+):(\d+):(.*)$/);
  const key = Object.keys(website.documents).find((k) => website.documents[k] === m[1]);
  if (!key) throw new Error(`the website states 501(c)(3) in ${m[1]}, which sources.json does not pin`);
  statements.push({ repository: website.url, commit: website.commit, path: m[1], line: Number(m[2]), text: squash(m[3]), claim: 'Nonprofit501c3', consistency: recognitionMatched > 0 ? 'verified' : 'unverified', source: sourceIndex(key) });
}

// ---- Obligations, each evaluated from the snapshot.
const DISCHARGE = {
  'sos-report': (d) => {
    const dues = history.events.map((e) => e.comment.startsWith(d.due) ? asDate(e.comment.slice(d.due.length)) : null).filter(Boolean);
    if (!dues.length) return { status: 'unobservable', due: '', why: 'the Secretary of State history states no periodic report due date' };
    const last = new Date(Math.max(...dues));
    const opened = new Date(Date.UTC(last.getUTCFullYear() - 1, last.getUTCMonth(), last.getUTCDate() + 1));
    const filed = history.events.find((e) => e.event === d.event && asDate(e.dateFiled) >= opened && asDate(e.dateFiled) <= last);
    const next = new Date(Date.UTC(last.getUTCFullYear() + 1, last.getUTCMonth(), last.getUTCDate()));
    const due = `${iso(last)} (stated by the Secretary of State); annually thereafter under C.R.S. 7-90-501(4)(c)(I), next ${iso(next)}`;
    if (fetched > next) return { status: 'undischarged', due, why: `no report for the period due ${iso(next)}` };
    return filed ? { status: 'discharged', due, why: `${filed.event} filed ${filed.dateFiled}, document ${filed.document}` } : { status: 'undischarged', due, why: `no ${d.event} filed in the 12 months before ${iso(last)}` };
  },
  'sos-latest-fact': (d) => {
    const latest = history.documents.at(-1);
    return latest.facts[d.fact] ? { status: 'discharged', due: '', why: `document ${latest.document}: ${latest.facts[d.fact]}` } : { status: 'undischarged', due: '', why: `document ${latest.document} states no ${d.fact}` };
  },
  'sos-status': (d) => (sos.Status === d.status ? { status: 'discharged', due: '', why: `the summary shows ${sos.Status}` } : { status: 'undischarged', due: '', why: `the summary shows ${sos.Status}` }),
  'sos-event': (d) => {
    const e = history.events.find((x) => x.event.startsWith(d.event));
    return e ? { status: 'discharged', due: '', why: `${e.event} filed ${e.dateFiled}` } : { status: 'undischarged', due: '', why: `the history lists no ${d.event}; the Articles (document ${articlesDoc.document}) state: ${articlesDoc.facts.voting}` };
  },
  'articles-fact': (d) => (articlesDoc.facts[d.fact]
    ? { status: 'discharged', due: '', why: `the Articles (document ${articlesDoc.document}) state: ${articlesDoc.facts[d.fact] === true ? 'purposes' : articlesDoc.facts[d.fact]}` }
    : { status: 'undischarged', due: '', why: `the Articles (document ${articlesDoc.document}, sha256:${articlesDoc.sha256}) state no ${d.fact === 'statesPurposes' ? 'purposes; the purposes are stated in Bylaws 1.2, which are not the articles of organization 26 CFR 1.501(c)(3)-1(b)(2) names' : d.fact}; no Articles of Amendment are on file` }),
  'irs-recognition': () => ({
    status: recognitionMatched > 0 ? 'discharged' : 'unobservable',
    due: `${iso(endOfMonthAfter(15))} (15 months, 26 CFR 1.508-1(a)(2)(i)); ${iso(endOfMonthAfter(27))} (27 months, Instructions for Form 1023 Part VIII)`,
    why: recognitionMatched > 0 ? `matched in ${searched('recognition')}` : `IRS recognition is not observable in IRS public data: ${searched('recognition')}; a pending application is not public`,
  }),
  'irs-filing': () => ({
    status: filingMatched > 0 ? 'discharged' : 'unobservable',
    due: 'the 15th day of the 5th month after the accounting period ends; the accounting period is not public',
    why: filingMatched > 0 ? `matched in ${searched('filing')}` : `no filing observable in IRS public data: ${searched('filing')}; the return the uor-990-return app names needs figures that are not public`,
  }),
  'ccsa-registration': () => {
    const c = need('ccsa-search');
    const found = c.queries.some((q) => q.found);
    return found ? { status: 'discharged', due: '', why: 'a registration is listed in the charities database' } : { status: 'undetermined', due: 'before soliciting in Colorado (C.R.S. 6-16-104(1)); annual report by the earlier of the 15th day of the 8th month after the fiscal year or the Form 990 due date (C.R.S. 6-16-104(5))', why: `the charities database lists no registration for ${c.queries.map((q) => `"${q.query}"`).join(' or ')} (control "${c.control.query}" found); whether the Foundation solicits in Colorado or qualifies for the C.R.S. 6-16-104(6)(c) exemption is not public` };
  },
  published: (d) => {
    const hits = policySearch(d.policy);
    return hits.published.length ? { status: 'discharged', due: '', why: `published at ${hits.published.join(', ')}` } : { status: 'unobservable', due: '', why: `no ${d.policy} policy is published in the pinned repositories${hits.mentions.length ? `; mentioned in ${hits.mentions.join(', ')}` : ''}` };
  },
  private: () => ({ status: 'unobservable', due: '', why: 'the evidence is the Foundation’s own records, which no public source holds' }),
};

// A policy is published when a file in a pinned tree is named for it, and mentioned when a file's text names it.
function policySearch(policy) {
  const words = policy.toLowerCase().split(/\s+/);
  const published = [];
  const mentions = [];
  for (const repo of sources.repositories) {
    const tree = git(repo, 'ls-tree', '-r', '--name-only', repo.commit).toString().trim().split('\n');
    for (const p of tree) if (words.every((w) => basename(p).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').includes(w))) published.push(`${repo.url}@${repo.commit}:${p}`);
    let out = '';
    try { out = git(repo, 'grep', '-l', '-i', '-F', policy, repo.commit, '--', '.', ':(exclude)*.generated.ts').toString(); } catch (e) { if (e.status !== 1) throw e; }
    for (const l of out.trim().split('\n').filter(Boolean)) mentions.push(`${repo.url}@${repo.commit}:${l.slice(repo.commit.length + 1)}`);
  }
  if (bylawsText.toLowerCase().includes(policy)) mentions.push(`${docs.bylaws.repo.url}@${docs.bylaws.repo.commit}:${docs.bylaws.path}`);
  return { published, mentions };
}

const obligations = [];
const citations = [];
for (const o of declared.obligations) {
  const { post, basis } = postOf(o.post);
  const cited = o.authorities.map(authority);
  const result = DISCHARGE[o.discharge.kind](o.discharge);
  const i = obligations.length;
  obligations.push({ name: o.name, authority: cited[0], post, basis, cadence: o.cadence, applicability: o.applicability, status: result.status, due: result.due, evidence: o.evidence, observed: result.why });
  for (const a of cited) citations.push({ obligation: i, authority: a });
  if (result.status !== 'discharged') claim('obligation', 'obligation', i, `obligation-${result.status}`, `${o.name}: ${result.why}`, o.evidence);
}

// ---- Form 990 Part VI: each line, what public evidence answers it, and the open claim when none does.
const f990 = need('f990');
const boardUnit = governance.units.findIndex((u) => u.name === 'Board of Directors');
const boardSeats = governance.holdings.filter((h) => governance.posts[h.post].unit === boardUnit).length;
const lines = f990.partVI.map((l) => {
  const policy = l.question.match(/written ([a-z ]+?) policy\?/)?.[1];
  let status = 'open';
  let evidence = '';
  let refusal = 'not-public';
  if (l.line === '1a') { status = 'evidenced'; evidence = `${boardSeats} Board positions held (governance/register.json holdings, from ${governance.sources.find((s) => s.document === 'board').repository}@${governance.sources.find((s) => s.document === 'board').commit})`; }
  else if (policy) { const hits = policySearch(policy); if (hits.published.length) { status = 'evidenced'; evidence = hits.published.join(', '); } else { refusal = 'policy-unpublished'; evidence = hits.mentions.length ? `mentioned in ${hits.mentions.join(', ')}` : 'no pinned source names it'; } }
  else if (['6', '7a', '7b'].includes(l.line)) { refusal = 'members-inconsistent'; evidence = `the Articles (document ${articlesDoc.document}) state "${articlesDoc.facts.voting}"; Bylaws Article III states the corporation shall not have voting members`; }
  else if (l.line === '19') { refusal = 'disclosure-partial'; evidence = `the Bylaws are public at ${docs.bylaws.repo.url}@${docs.bylaws.repo.commit}:${docs.bylaws.path}; no conflict of interest policy or financial statement is`; }
  else if (l.line === '17') { refusal = 'not-public'; evidence = 'the states that require a copy depend on charitable registrations; the Colorado charities database lists none'; }
  return { line: l.line, section: l.section, question: l.question, questionSha256: l.sha256, policy: policy ?? '', status, evidence, refusal: status === 'open' ? refusal : '' };
});
lines.forEach((l, i) => { if (l.status === 'open') claim('form990-part-vi', 'line', i, l.refusal, `Form 990 Part VI line ${l.line}: ${l.evidence || 'no public source answers it'}`, `an answer to line ${l.line} evidenced by a record the Foundation publishes`); });

// ---- Financial information needs: none is public.
const needs = declared.needs.map((n) => ({ name: n.name, part: authority(n.part), provision: authority(n.provision) }));
needs.forEach((n, i) => claim('finance', 'need', i, 'financial-figures-not-public', `${n.name} (${authorities[n.part].ref}; ${authorities[n.provision].ref})`, 'the Foundation’s accounting records, or a filed return that states the figure'));

// ---- The entity's status as the website states it, and as IRS public data shows it.
statements.forEach((s, i) => { if (s.consistency !== 'verified') claim('statement', 'statement', i, 'statement-unverified', `${s.path}:${s.line} states "${s.text}"; IRS recognition of 501(c)(3) status is not observable in IRS public data (${searched('recognition')})`, 'an IRS determination letter, or the Foundation in the Business Master File or the Publication 78 data'); });
if (recognitionMatched === 0) claim('entity', 'entity', 0, 'irs-recognition-unobserved', `IRS recognition of 501(c)(3) status is not observable in IRS public data. ${method} ${searched('recognition')}.`, 'an IRS determination letter, or the Foundation in the Business Master File or the Publication 78 data');
observations.forEach((o, i) => { if (o.matched === 0) claim('irs-data', 'observation', i, 'name-not-found', `${o.dataset}: 0 of ${o.rows} records match (${o.near} carry the token UOR); fetched ${o.fetchedAt}`, o.shows === 'recognition' ? 'the Foundation in this dataset' : 'a return of the Foundation in this dataset'); });

const entity = {
  types: ['schema:NGO', 'org:FormalOrganization'],
  legalName: sos.Name,
  identifier: [{ propertyID: 'US-CO Secretary of State entity ID', value: sos['ID number'] }],
  foundingDate: `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
  status: sos.Status,
  form: sos.Form,
  jurisdiction: sources.entity.jurisdiction,
  periodicReportMonth: sos['Periodic report month'],
  nonprofitStatusClaimed: 'Nonprofit501c3',
  recognitionObserved: recognitionMatched > 0,
  source: sourceIndex('sos-entity'),
  fieldsSha256: need('sos-entity').fieldsSha256,
};

const register = {
  spec: 'uor-community/nonprofit-register/1',
  standards: [
    'Schema.org NGO, nonprofitStatus Nonprofit501c3 (https://schema.org/NGO, https://schema.org/Nonprofit501c3)',
    'W3C ORG FormalOrganization, Post (https://www.w3.org/TR/vocab-org/)',
    'ISO 3166-2:US subdivision codes (US-CO)',
    'IRS Form 990 (2025) Part VI and its instructions (https://www.irs.gov/pub/irs-pdf/f990.pdf, https://www.irs.gov/pub/irs-pdf/i990.pdf)',
    'OMG DMN 1.5 decision table, hit policy FIRST (apps/uor-990-return.prompt.json)',
  ],
  tools: { pdftotext },
  search: { method, tokens: snapshot.search.tokens, near: snapshot.search.near },
  counts: { sources: sourceList.length, authorities: authorities.length, posts: posts.length, obligations: obligations.length, citations: citations.length, filings: filings.length, observations: observations.length, statements: statements.length, lines: lines.length, needs: needs.length, claims: claims.length },
  entity, sources: sourceList, authorities, posts, obligations, citations, filings, observations, statements, lines, needs, claims,
};
const out = `${JSON.stringify(register, null, 1)}\n`;
const target = join(here, 'register.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
    process.stderr.write('nonprofit/register.json is not the projection of the pinned sources\n');
    process.exit(1);
  }
} else writeFileSync(target, out);
process.stdout.write(Object.entries(register.counts).map(([k, v]) => `${v} ${k}`).join(', ') + '\n');
