#!/usr/bin/env node
/**
 * Project the Foundation's policy register, and the four drafts rendered from
 * it, from the pinned standard models and authorities.
 *
 * The drafts are the Articles of Amendment that give the Articles of
 * Incorporation a purpose clause and state that the Corporation has no voting
 * members, the Conflict of Interest Policy Bylaws 10.3 requires, the
 * Whistleblower Policy and the Document Retention and Destruction Policy that
 * Form 990 Part VI lines 13 and 14 ask about. Each is a list of clauses
 * (policies/clauses.json). A model clause is projected from a section of a
 * standard model in policies/snapshot.json, carrying its text verbatim except
 * for the named substitutions, and every section of every model is projected
 * exactly once. A carried clause carries excerpts of its authorities word for
 * word; a composed clause states their obligation in the Foundation's words.
 * Every clause cites an authority, every authority resolves to a pinned
 * source, and an authority nonprofit/register.json already resolves is reused
 * by its key.
 *
 * Nothing is adopted, filed or published here. Adopting each policy, filing
 * the amendment and publishing the policies are staged acts, each with its
 * preconditions and the Bylaws' vote rule, and each unexecuted; each is an
 * open claim, as is every requirement no clause covers, every post a policy
 * names that no one holds, and every record class no pinned authority states a
 * retention period for. The same inputs always project the same bytes.
 *
 *   node policies/project.mjs <checkouts-dir> [--check]
 *
 * <checkouts-dir> holds one clone per repository in sources.json, named by its
 * `name`.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const bytesOf = (p) => readFileSync(join(repoRoot, p));
const json = (p) => JSON.parse(bytesOf(p).toString('utf8'));
const sources = json('policies/sources.json');
const declared = json('policies/clauses.json');
const snapshot = json('policies/snapshot.json');
const governance = json(sources.governance);
const nonprofit = json(sources.nonprofit);
const npSnapshot = json(sources.nonprofitSnapshot);
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <checkouts-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const git = (repo, ...args) => execFileSync('git', ['-C', join(root, repo.name), ...args], { maxBuffer: 1 << 26 });
const web = new Map(snapshot.sources.map((s) => [s.key, s]));
const need = (key) => { if (!web.has(key)) throw new Error(`the policies snapshot has no source ${key}`); return web.get(key); };

// ---- Sources: the git documents, the in-repository inputs, every policies snapshot fetch, and each nonprofit source an authority is reused from.
const sourceList = [];
const sourceAt = new Map();
const addSource = (s) => {
  if (sourceAt.has(s.key)) {
    if (sourceList[sourceAt.get(s.key)].digest !== s.digest) throw new Error(`source ${s.key} was read twice with different bytes; re-snapshot nonprofit/ and policies/`);
    return sourceAt.get(s.key);
  }
  sourceAt.set(s.key, sourceList.length);
  sourceList.push({ key: s.key, url: s.url, fetchedAt: s.fetchedAt ?? '', digest: s.digest });
  return sourceList.length - 1;
};
const docs = {};
for (const repo of sources.repositories) {
  const at = git(repo, 'rev-parse', `${repo.commit}^{commit}`).toString().trim();
  if (at !== repo.commit) throw new Error(`${repo.name} does not hold the pinned ${repo.commit}`);
  for (const [key, path] of Object.entries(repo.documents)) {
    const bytes = git(repo, 'show', `${repo.commit}:${path}`);
    docs[key] = { repo, path, bytes };
    addSource({ key, url: `${repo.url}/blob/${repo.commit}/${path}`, digest: `sha256:${sha256(bytes)}` });
  }
}
for (const path of [sources.governance, sources.nonprofit, sources.nonprofitSnapshot, 'policies/clauses.json', 'policies/snapshot.json']) addSource({ key: path, url: path, digest: `sha256:${sha256(bytesOf(path))}` });
for (const s of snapshot.sources) addSource({ key: s.key, url: s.url, fetchedAt: s.fetchedAt, digest: `sha256:${s.sha256}` });
const npSource = (i) => addSource(nonprofit.sources[i]);

// The Bylaws read here are the bytes governance/register.json projected.
const govBylaws = governance.sources.find((s) => s.document === 'bylaws');
if (docs.bylaws.repo.commit !== govBylaws.commit || sha256(docs.bylaws.bytes) !== govBylaws.sha256) throw new Error('the Bylaws pinned here are not the ones governance/register.json projects');
const scratch = mkdtempSync(join(tmpdir(), 'policies-'));
writeFileSync(join(scratch, 'b.pdf'), docs.bylaws.bytes);
execFileSync('pdftotext', ['-layout', join(scratch, 'b.pdf'), join(scratch, 'b.txt')]);
// The e-signature service stamps its document id on every page; it is not a word of the Bylaws.
const bylawsText = squash(readFileSync(join(scratch, 'b.txt'), 'utf8').replace(/^\s*OpenSign™ DocumentId: \S+\s*$/gm, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
rmSync(scratch, { recursive: true });
const pdftotext = execFileSync('sh', ['-c', 'pdftotext -v 2>&1'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)[0];

// Each Bylaws provision's text runs from its heading to the next provision's heading.
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];
const bylawsProvisions = governance.provisions.map((p, i) => ({ ...p, i })).filter((p) => p.document === 'bylaws' && p.key.startsWith('bylaws:') && p.ref.trim());
const headingOf = (p) => (p.ref.startsWith('Article ') ? `ARTICLE ${ROMAN[Number(p.ref.slice(8))]} ${p.title}` : `${p.ref} ${p.title}.`);
const starts = bylawsProvisions.map((p) => { const at = bylawsText.indexOf(headingOf(p)); if (at < 0) throw new Error(`the Bylaws text has no heading "${headingOf(p)}"`); return at; });
const bylawsQuote = (key) => {
  const k = bylawsProvisions.findIndex((p) => p.key === key);
  if (k < 0) throw new Error(`governance/register.json has no Bylaws provision ${key}`);
  const next = Math.min(...starts.filter((s) => s > starts[k]), bylawsText.length);
  return squash(bylawsText.slice(starts[k], next));
};

// ---- The Corporation's filed facts: the Secretary of State's record and the Articles of Incorporation, as nonprofit/snapshot.json read them.
const npWeb = new Map(npSnapshot.sources.map((s) => [s.key, s]));
const sos = npWeb.get('sos-entity').fields;
const articlesDoc = npWeb.get('sos-history').documents.find((d) => d.facts.title === 'Articles of Incorporation for a Nonprofit Corporation');
if (!articlesDoc) throw new Error('nonprofit/snapshot.json holds no Articles of Incorporation');
for (const f of ['voting', 'dissolution']) if (!articlesDoc.facts[f]) throw new Error(`the Articles state no ${f} provision`);

// ---- Authorities.
const authorities = [];
const authorityIndex = new Map();
const npAuthority = new Map(nonprofit.authorities.map((a) => [a.key, a]));
const quoteOf = new Map();
const authority = (key) => {
  if (authorityIndex.has(key)) return authorityIndex.get(key);
  const src = key.slice(0, key.indexOf(':'));
  const ref = key.slice(key.indexOf(':') + 1);
  let a;
  if (src === 'bylaws' || src === 'governance') {
    const p = governance.provisions.findIndex((x) => x.key === key);
    if (p < 0) throw new Error(`governance/register.json has no provision ${key}`);
    const prov = governance.provisions[p];
    const doc = governance.sources.find((s) => s.document === prov.document);
    const source = src === 'bylaws' ? sourceAt.get('bylaws') : addSource({ key: prov.document, url: `${doc.repository}/blob/${doc.commit}/${doc.path}`, digest: `sha256:${doc.sha256}` });
    a = { key, instrument: src === 'bylaws' ? 'bylaws' : 'governance', ref: src === 'bylaws' ? `Bylaws ${prov.ref}` : `GitHub Governance Framework ${prov.ref}`, title: prov.title, jurisdiction: 'US-CO', source, quote: src === 'bylaws' ? bylawsQuote(key) : prov.title, textSha256: prov.sha256 };
    const np = npAuthority.get(key);
    if (np && np.textSha256 !== a.textSha256) throw new Error(`${key} differs from the provision nonprofit/register.json cites`);
  } else if (src === 'f990-line') {
    const l = nonprofit.lines.find((x) => x.line === ref);
    if (!l) throw new Error(`nonprofit/register.json has no Form 990 Part VI line ${ref}`);
    const f990 = nonprofit.sources.findIndex((s) => s.key === 'f990');
    a = { key, instrument: 'form', ref: `Form 990 Part VI line ${ref}`, title: l.question.slice(0, 120), jurisdiction: 'US', source: npSource(f990), quote: l.question, textSha256: l.questionSha256 };
  } else if (src === 'articles') {
    const fact = articlesDoc.facts[ref];
    if (typeof fact !== 'string') throw new Error(`the Articles state no ${ref}`);
    const at = nonprofit.sources.findIndex((s) => s.key === `sos-history:${articlesDoc.document}`);
    a = { key, instrument: 'filedRecord', ref: `Articles of Incorporation, Colorado Secretary of State document ${articlesDoc.document}`, title: fact.slice(0, 120), jurisdiction: 'US-CO', source: npSource(at), quote: fact, textSha256: sha256(fact) };
  } else if (src === 'model') {
    const s = need(ref);
    const cite = sources.web.find((w) => w.key === ref).cites;
    a = { key, instrument: 'model', ref: typeof cite === 'string' ? cite : `${ref} standard model`, title: s.model?.heading ?? s.model?.form ?? ref, jurisdiction: 'US', source: sourceAt.get(ref), quote: JSON.stringify(s.model ?? {}), textSha256: sha256(JSON.stringify(s.model ?? {})) };
    if (ref === 'sos-amd-npc') a.jurisdiction = 'US-CO';
    if (ref === 'p557') a = { ...a, ref: 'IRS Publication 557, Sample Articles of Organization', title: need('p557').edition, quote: need('p557').edition, textSha256: sha256(need('p557').edition) };
  } else if (src === 'crs') {
    const s = need('crs-title-7').sections[ref];
    if (!s) throw new Error(`the policies snapshot holds no C.R.S. ${ref}`);
    const np = npAuthority.get(key);
    if (np && np.textSha256 !== s.sha256) throw new Error(`C.R.S. ${ref} differs from the text nonprofit/register.json cites`);
    a = { key, instrument: 'statute', ref: `C.R.S. ${ref}`, title: s.title, jurisdiction: 'US-CO', source: sourceAt.get('crs-title-7'), quote: s.text, textSha256: s.sha256 };
  } else if (web.get(src)?.quotes?.[ref]) {
    const q = web.get(src).quotes[ref];
    const kind = /^usc-/.test(src) ? 'statute' : /^cfr-/.test(src) ? 'regulation' : /^sos-/.test(src) ? 'agencyGuidance' : /^p\d/.test(src) ? 'publication' : 'instructions';
    const cite = sources.web.find((w) => w.key === src).cites?.[ref];
    if (!cite) throw new Error(`sources.json gives no citation for ${key}`);
    a = { key, instrument: kind, ref: cite, title: q.slice(0, 120), jurisdiction: /^sos-/.test(src) ? 'US-CO' : 'US', source: sourceAt.get(src), quote: q, textSha256: sha256(q) };
    const np = npAuthority.get(key);
    if (np && np.textSha256 !== a.textSha256) throw new Error(`${key} differs from the quotation nonprofit/register.json cites`);
  } else if (npAuthority.has(key)) {
    // Reused by key: the authority nonprofit/register.json resolved, from the source it read it from.
    const np = npAuthority.get(key);
    a = { key, instrument: np.instrument, ref: np.ref, title: np.title, jurisdiction: np.jurisdiction, source: npSource(np.source), quote: np.quote, textSha256: np.textSha256 };
  } else throw new Error(`no pinned source resolves the authority ${key}`);
  authorityIndex.set(key, authorities.length);
  authorities.push(a);
  quoteOf.set(key, a.quote);
  return authorities.length - 1;
};

// ---- Standard models and their sections.
const models = [];
const sections = [];
const sectionText = new Map();
const coi = need('i1023').model;
models.push({ key: 'i1023', title: coi.heading, source: sourceAt.get('i1023'), revision: 'Instructions for Form 1023 (Rev. December 2024)', authority: authority('model:i1023') });
for (const a of coi.articles) {
  // An article the text layer does not number is accepted only when the sample's own text refers to it by that number.
  if (!a.numberStated && !coi.articles.some((b) => [b.text, ...b.sections.map((s) => s.text)].some((t) => t.includes(`Article ${a.number}`)))) throw new Error(`the sample does not number its article "${a.title}" and no cross-reference names Article ${a.number}`);
  const units = a.sections.length ? a.sections.map((s) => ({ number: `${a.number}.${s.number}`, title: s.title, text: s.text, digest: s.sha256 })) : [{ number: a.number, title: a.title, text: a.text, digest: a.sha256 }];
  for (const u of units) {
    sectionText.set(`i1023:${u.number}`, { ...u, article: a });
    sections.push({ model: 0, number: u.number, title: u.title, numberStated: a.numberStated, textSha256: u.digest });
  }
}
const form = need('sos-amd-npc').model;
models.push({ key: 'sos-amd-npc', title: `${form.form}, Articles of Amendment`, source: sourceAt.get('sos-amd-npc'), revision: `Revised ${form.revised}`, authority: authority('model:sos-amd-npc') });
for (const s of form.sections) {
  sectionText.set(`sos-amd-npc:Section ${s.number}`, { number: `Section ${s.number}`, title: s.title, text: '' });
  sections.push({ model: 1, number: `Section ${s.number}`, title: s.title, numberStated: true, textSha256: s.sha256 });
}

// ---- Substitutions: each named, with its basis; applied in the order declared.
const committees = governance.units.filter((u) => u.provision === governance.provisions.findIndex((p) => p.key === 'bylaws:6.1') && u.classification === 'OrganizationalUnit').map((u) => `the ${u.name}`);
if (committees.length < 2) throw new Error('governance/register.json names no Bylaws 6.1 committees');
const committeeList = `${committees.slice(0, -1).join(', ')} or ${committees.at(-1)}`;
const substitutions = declared.substitutions.map((s) => ({ ...s, to: s.to.replace('{committees}', committeeList), applied: 0 }));
const substitute = (text, ids) => {
  const applied = [];
  let out = text;
  for (const id of ids) {
    const s = substitutions.find((x) => x.id === id);
    if (!s) throw new Error(`no substitution ${id}`);
    const re = s.pattern ? new RegExp(s.pattern, 'g') : new RegExp(s.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const n = (out.match(re) ?? []).length;
    if (n) { out = out.replace(re, s.to); s.applied += n; applied.push(`${id}×${n}`); }
  }
  return { text: out, applied };
};

// ---- Clauses.
const policies = declared.policies.map((p) => ({ key: p.key, title: p.title, draft: p.draft, standard: p.standard, clauses: 0, draftSha256: '' }));
const policyOf = (key) => { const i = policies.findIndex((p) => p.key === key); if (i < 0) throw new Error(`no policy ${key}`); return i; };
const facts = { coloradoId: sos['ID number'], legalName: sos.Name, voting: articlesDoc.facts.voting, dissolution: articlesDoc.facts.dissolution };
const expand = (t) => t.replace(/\{([a-z0-9-]+:[A-Za-z0-9]+|[a-zA-Z]+)\}/g, (_, k) => {
  if (k in facts) return facts[k];
  authority(k);
  return quoteOf.get(k);
});
if (sos['ID number'] !== '20251193974' || sos.Name !== 'The UOR Foundation') throw new Error('the Secretary of State record is not the Foundation');
const clauses = [];
const derivations = [];
const citations = [];
const carries = [];
const clauseIndex = new Map();
const coiRules = substitutions.filter((s) => s.id.startsWith('coi-')).map((s) => s.id);
for (const c of declared.clauses) {
  const policy = policyOf(c.policy);
  let raw;
  let heading = c.heading ?? '';
  let ids = c.substitutions ?? [];
  if (c.kind === 'model') {
    const sec = c.model.source === 'i1023' ? `i1023:${c.model.article}${c.model.section ? `.${c.model.section}` : ''}` : `sos-amd-npc:Section ${c.model.section}`;
    const u = sectionText.get(sec);
    if (!u) throw new Error(`the model has no section ${sec}`);
    heading = u.title;
    raw = c.model.source === 'i1023' ? u.text : expand(c.text);
    if (c.model.source === 'i1023') ids = coiRules;
    derivations.push({ clause: clauses.length, section: sections.findIndex((s, i) => `${models[s.model].key}:${s.number}` === sec && i >= 0) });
  } else raw = expand(c.text);
  if (c.strip) raw = raw.replace(`"${c.strip}`, '"');
  for (const k of c.carries ?? []) {
    const excerpt = expand(k.excerpt);
    authority(k.authority);
    if (!raw.includes(excerpt)) throw new Error(`${c.policy} ${c.number} does not carry its excerpt of ${k.authority} word for word`);
    if (!quoteOf.get(k.authority).includes(excerpt)) throw new Error(`${k.authority} does not say "${excerpt}"`);
    carries.push({ clause: clauses.length, authority: authorityIndex.get(k.authority), excerpt, excerptSha256: sha256(excerpt) });
  }
  if (c.kind === 'carried' && !(c.carries ?? []).length) throw new Error(`${c.policy} ${c.number} is carried but carries no excerpt`);
  const { text, applied } = substitute(raw, ids);
  if (!c.authorities.length) throw new Error(`${c.policy} ${c.number} cites no authority`);
  for (const k of c.authorities) citations.push({ clause: clauses.length, authority: authority(k) });
  clauseIndex.set(`${c.policy}:${c.number}`, clauses.length);
  clauses.push({ policy, number: c.number, group: c.group, heading, kind: c.kind, text: squash(text), textSha256: sha256(squash(text)), substitutions: applied.join(', '), posts: c.posts ?? [] });
  policies[policy].clauses += 1;
}
for (const s of substitutions) if (!s.applied) throw new Error(`the substitution ${s.id} is never applied`);
for (const s of substitutions) for (const b of s.basis) authority(b);

// ---- Requirements and what covers them.
const requirements = [];
const coverages = [];
for (const r of declared.requirements) {
  const i = requirements.length;
  requirements.push({ key: r.key, policy: policyOf(r.policy), label: r.label, authority: authority(r.authority), mandatory: r.mandatory, refusal: r.refusal ?? '', closes: r.closes ?? '' });
  for (const c of r.covers) { if (!clauseIndex.has(c)) throw new Error(`requirement ${r.key} names no clause ${c}`); coverages.push({ requirement: i, clause: clauseIndex.get(c) }); }
}

// ---- Posts the policies name, read from governance/register.json.
const posts = declared.posts.map((p) => {
  const g = governance.posts.findIndex((x) => x.name === p.name && governance.units[x.unit].name === p.unit);
  if (g < 0) throw new Error(`governance/register.json has no post ${p.name} of the ${p.unit}`);
  const holders = governance.holdings.filter((h) => h.post === g).length;
  const refusal = governance.refusals.find((r) => r.kind === 'post' && r.subject === p.name && r.detail.startsWith(`${p.unit}:`))
    ?? governance.refusals.find((r) => r.kind === 'unit' && r.subject === p.unit);
  return { name: p.name, unit: p.unit, governanceIndex: g, held: holders > 0, basis: authority(p.basis), detail: holders > 0 ? `${holders} holder in governance/register.json` : refusal?.detail ?? 'no pinned source names who holds it' };
});
for (const c of clauses) for (const p of c.posts) if (!posts.some((x) => x.name === p)) throw new Error(`clause ${c.number} names the undeclared post ${p}`);

// ---- The retention schedule: each class keeps the longest period its authorities state.
const RANK = { unstated: 0, current: 1, years: 2, permanent: 3 };
const recordClasses = [];
const bases = [];
for (const rc of declared.recordClasses) {
  const i = recordClasses.length;
  let best = { period: 'unstated', years: 0 };
  for (const b of rc.bases) {
    if (!(b.period in RANK) || b.period === 'unstated') throw new Error(`${rc.name}: ${b.period} is not a stated period`);
    bases.push({ recordClass: i, authority: authority(b.authority), period: b.period, years: b.years, at: b.at });
    if (RANK[b.period] > RANK[best.period] || (RANK[b.period] === RANK[best.period] && b.years > best.years)) best = { period: b.period, years: b.years };
  }
  recordClasses.push({ name: rc.name, period: best.period, years: best.years, condition: rc.condition ?? '' });
}

// ---- Staged acts: never executed here.
const voteRuleText = (v) => { const r = governance.voteRules[v]; return `${governance.units[r.body].name} ${r.kind}: ${r.strict ? 'more than' : 'at least'} ${r.num}/${r.den} of the directors ${r.base} (${governance.provisions[r.provision].ref})`; };
const acts = declared.acts.map((a) => {
  if (a.voteRule !== null && !governance.voteRules[a.voteRule]) throw new Error(`${a.key}: governance/register.json has no vote rule ${a.voteRule}`);
  for (const k of a.authorities) authority(k);
  return { key: a.key, policy: a.policy, kind: a.kind, name: a.name, voteRuleApplies: a.voteRule !== null, voteRule: a.voteRule ?? 0, voteRuleText: a.voteRule !== null ? voteRuleText(a.voteRule) : '', threshold: a.threshold, authority: authority(a.authority), executed: false, preconditions: a.preconditions.join(' '), steps: a.steps.join(' ') };
});
const boardSeats = governance.holdings.filter((h) => governance.units[governance.posts[h.post].unit].name === 'Board of Directors').length;

// ---- Open claims.
const claims = [];
const claim = (area, subjectKind, subject, refusal, detail, closes) => claims.push({ area, subjectKind, subject, refusal, detail, closes });
requirements.forEach((r, i) => { if (!coverages.some((c) => c.requirement === i)) claim('requirement', 'requirement', i, r.refusal || 'requirement-uncovered', `${r.label}: no clause covers it`, r.closes || 'a clause that covers it'); });
posts.forEach((p, i) => { if (!p.held) claim('post', 'post', i, 'post-unheld', `${p.name} (${p.unit}), named by ${clauses.filter((c) => c.posts.includes(p.name)).map((c) => `${policies[c.policy].title} ${c.number}`).join(', ')}: ${p.detail}`, `a Board resolution that establishes the ${p.unit} and appoints its chair (Bylaws 6.1, 6.3), recorded in a pinned source`); });
recordClasses.forEach((r, i) => { if (r.period === 'unstated') claim('retention', 'recordClass', i, 'retention-period-unstated', `${r.name}: no pinned authority states a retention period`, 'a pinned authority that states the period, or a period the Board adopts'); });
acts.forEach((a, i) => claim('act', 'act', i, 'act-unexecuted', `${a.name}: staged, not executed. Preconditions: ${a.preconditions}`, `the act done and its record pinned: ${a.steps}`));

// ---- Drafts, rendered from the register.
const cite = (i) => authorities[citations[i].authority].ref;
const periodText = (r) => (r.period === 'permanent' ? 'Permanently' : r.period === 'years' ? `${r.years} years` : r.period === 'current' ? 'While current' : 'No period stated: kept until the Board adopts one');
const render = (p) => {
  const policy = policies[p];
  const out = [`# ${policy.title}`, '', '**DRAFT, not adopted.** This draft is generated by policies/project.mjs from policies/register.json. It has no effect until the Board of Directors adopts it as the staged act below states; nothing here has been adopted, filed, posted or sent. It is not legal advice.', '', `Standard models and authorities: ${policy.standard}.`, ''];
  let group = '';
  clauses.forEach((c, i) => {
    if (c.policy !== p) return;
    if (c.group !== group) { group = c.group; out.push(`## ${group}`, ''); }
    const label = policy.key === 'coi' ? (c.number.includes('.') ? `${c.number.split('.')[1]}. ${c.heading}` : '') : policy.key === 'articles' ? `${c.number}: ${c.heading}` : `${c.number}. ${c.heading}`;
    out.push(label ? `**${label}.** ${c.text}` : c.text, '');
    if (c.kind === 'schedule') {
      out.push('| Record | Retained | Basis |', '| --- | --- | --- |');
      recordClasses.forEach((r, j) => {
        const why = bases.filter((b) => b.recordClass === j).map((b) => `${authorities[b.authority].ref} (${b.at})`).join('; ') || 'none pinned (open claim)';
        out.push(`| ${r.name} | ${periodText(r)}${r.condition ? `; ${r.condition}` : ''} | ${why} |`);
      });
      out.push('');
    }
    const cited = citations.map((x, k) => (x.clause === i ? cite(k) : null)).filter(Boolean);
    const from = derivations.find((d) => d.clause === i);
    const note = [from ? `From ${models[sections[from.section].model].title}, ${sections[from.section].number}` : c.kind === 'carried' ? 'Carries its authorities verbatim' : c.kind === 'composed' ? 'Composed from its authorities' : 'Schedule', c.substitutions ? `substitutions: ${c.substitutions}` : ''].filter(Boolean).join('; ');
    out.push(`> ${note}. Authority: ${cited.join('; ')}.`, '');
  });
  out.push('## Staged acts (not executed)', '');
  for (const a of acts.filter((x) => x.policy === policy.key || (x.policy === '' && policy.key !== 'articles'))) {
    out.push(`- **${a.name}** (executed: false). ${a.threshold ? `Vote: ${a.threshold}. ` : ''}Preconditions: ${a.preconditions} Steps: ${a.steps}`);
  }
  out.push('');
  return out.join('\n');
};
const drafts = policies.map((p, i) => [p.draft, render(i)]);
drafts.forEach(([, text], i) => { policies[i].draftSha256 = sha256(text); });

const register = {
  spec: 'uor-community/policies-register/1',
  standards: [
    'IRS Sample Conflict of Interest Policy, Instructions for Form 1023 (Rev. December 2024) Appendix A (https://www.irs.gov/pub/irs-pdf/i1023.pdf)',
    'Colorado Secretary of State form AMD_NPC, Articles of Amendment (Nonprofit Corporation) (https://www.coloradosos.gov/pubs/business/sampleForms/AMD_NPC.pdf)',
    'IRS Publication 557, Sample Articles of Organization, Draft A (https://www.irs.gov/pub/irs-pdf/p557.pdf)',
    'IRS Form 990 (2025) Part VI lines 12a to 14 and their instructions (https://www.irs.gov/pub/irs-pdf/i990.pdf)',
    'IRS Publication 4221-PC, Compliance Guide for 501(c)(3) Public Charities (https://www.irs.gov/pub/irs-pdf/p4221pc.pdf)',
    'W3C ORG Post (https://www.w3.org/TR/vocab-org/), Schema.org ActionStatusType PotentialActionStatus for a staged act',
    'ISO 3166-2:US subdivision codes (US-CO)',
  ],
  tools: { pdftotext, pdftohtml: snapshot.tools.pdftohtml },
  entity: { legalName: sos.Name, coloradoId: sos['ID number'], jurisdiction: 'US-CO', boardSeats },
  counts: { sources: sourceList.length, authorities: authorities.length, models: models.length, sections: sections.length, policies: policies.length, clauses: clauses.length, derivations: derivations.length, citations: citations.length, carries: carries.length, substitutions: substitutions.length, requirements: requirements.length, coverages: coverages.length, posts: posts.length, recordClasses: recordClasses.length, bases: bases.length, acts: acts.length, claims: claims.length },
  sources: sourceList, authorities, models, sections, policies, clauses, derivations, citations, carries,
  substitutions: substitutions.map((s) => ({ id: s.id, from: s.from ?? `/${s.pattern}/`, to: s.to, basis: authorityIndex.get(s.basis[0]), why: s.why, applied: s.applied })),
  requirements, coverages, posts, recordClasses, bases, acts, claims,
};
const outputs = [['policies/register.json', `${JSON.stringify(register, null, 1)}\n`], ...drafts];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(repoRoot, path);
  if (flag === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`${path} is not the projection of the pinned sources\n`); stale = true; }
  } else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); }
}
if (stale) process.exit(1);
process.stdout.write(Object.entries(register.counts).map(([k, v]) => `${v} ${k}`).join(', ') + '\n');
