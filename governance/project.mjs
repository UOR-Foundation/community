#!/usr/bin/env node
/**
 * Project the UOR Foundation governance register from its pinned sources.
 *
 * Every document is read from git at the commit sources.json pins, never from
 * a working tree, and the Bylaws PDF is read through pdftotext, whose version
 * the register records. The register follows the standards that define each
 * thing it holds: W3C ORG (FormalOrganization, OrganizationalUnit,
 * subOrganizationOf, Post, Role, holds) for the Foundation's structure,
 * Schema.org Person and SoftwareApplication for actors, and W3C PROV-O
 * actedOnBehalfOf for an agent working for a person. Vote and quorum rules are
 * read from the Bylaws' own words; a body without one inherits the default its
 * article states, and the register cites that article.
 *
 * Nothing is defaulted beyond what a source says. A post, role or committee no
 * source fills, a reference that resolves to nothing, an agent with no person
 * behind it, and every Bylaws notice is a typed refusal, carried into the
 * register as an open claim. The same commits always project the same bytes.
 *
 *   node governance/project.mjs <checkouts-dir> [--check]
 *
 * <checkouts-dir> holds one clone per repository in sources.json, named by its
 * `name`.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'));
const sources = read('sources.json');
const agentTable = read('agents.json').agents;
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <checkouts-dir> [--check]\n');
  process.exit(64);
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const git = (repo, ...args) => execFileSync('git', ['-C', join(root, repo.name), ...args], { maxBuffer: 1 << 26 });
const blob = (repo, path) => git(repo, 'show', `${repo.commit}:${path}`);
// GitHub's heading anchor: lower case, punctuation other than '-' and '_' dropped, each space a '-'.
const anchor = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

const refusals = [];
const refuse = (kind, subject, refusal, detail = '') => refusals.push({ kind, subject, refusal, detail });

// ---- Sources: every document at its pinned commit, with its digest.
const docs = {};
const sourceList = [];
for (const repo of sources.repositories) {
  const at = git(repo, 'rev-parse', `${repo.commit}^{commit}`).toString().trim();
  if (at !== repo.commit) throw new Error(`${repo.name} does not hold the pinned ${repo.commit}`);
  for (const [key, path] of Object.entries(repo.documents)) {
    const bytes = blob(repo, path);
    docs[key] = { key, repo, path, bytes, sha256: sha256(bytes) };
    sourceList.push({ document: key, repository: repo.url, commit: repo.commit, path, sha256: docs[key].sha256 });
  }
}
const dotgithub = sources.repositories.find((r) => r.name === 'dotgithub');
const treePaths = new Set(git(dotgithub, 'ls-tree', '-r', '--name-only', dotgithub.commit).toString().trim().split('\n'));

// ---- The Bylaws, as text.
const pdftotextVersion = (execFileSync('pdftotext', ['-v'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }) || '')
  .concat('')
  .match(/\d+\.\d+\.\d+/)?.[0] ?? execFileSync('sh', ['-c', 'pdftotext -v 2>&1'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)[0];
const scratch = mkdtempSync(join(tmpdir(), 'bylaws-'));
writeFileSync(join(scratch, 'b.pdf'), docs.bylaws.bytes);
execFileSync('pdftotext', ['-layout', join(scratch, 'b.pdf'), join(scratch, 'b.txt')]);
const bylawsText = readFileSync(join(scratch, 'b.txt'), 'utf8');
rmSync(scratch, { recursive: true });
const bylawLines = bylawsText.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").split('\n').filter((l) => !/OpenSign/.test(l)).map((l) => l.trim());

// Articles and sections. A section is "<article>.<n> <Title>. <text>"; an article with no sections is one provision.
const provisions = [];
const provisionIndex = new Map();
const provision = (key, doc, ref, title, text = '') => {
  if (provisionIndex.has(key)) return provisionIndex.get(key);
  provisionIndex.set(key, provisions.length);
  provisions.push({ key, document: doc, ref, title, text });
  return provisions.length - 1;
};
const roman = (r) => [...r].reduce((n, c, i, a) => { const v = { I: 1, V: 5, X: 10, L: 50 }[c]; const w = { I: 1, V: 5, X: 10, L: 50 }[a[i + 1]] ?? 0; return n + (v < w ? -v : v); }, 0);
const bylaws = [];
{
  let article = null;
  let current = null;
  for (const line of bylawLines) {
    const a = line.match(/^ARTICLE ([IVXL]+) (.+)$/);
    const s = line.match(/^(\d+)\.(\d+) (.+?)\.{1,2} (.*)$/);
    if (a) {
      article = { number: roman(a[1]), title: a[2].trim(), sections: [], text: [] };
      bylaws.push(article);
      current = null;
    } else if (s && article && Number(s[1]) === article.number) {
      current = { ref: `${s[1]}.${s[2]}`, title: s[3].trim(), text: [s[4]] };
      article.sections.push(current);
    } else if (article) (current ? current.text : article.text).push(line);
  }
}
const sectionText = new Map();
for (const art of bylaws) {
  const artText = art.text.join(' ').replace(/\s+/g, ' ').trim();
  provision(`bylaws:Art.${art.number}`, 'bylaws', `Article ${art.number}`, art.title, artText);
  for (const s of art.sections) {
    const text = s.text.join(' ').replace(/\s+/g, ' ').trim();
    sectionText.set(s.ref, text);
    provision(`bylaws:${s.ref}`, 'bylaws', s.ref, s.title, text);
  }
  if (/Notice:/.test(artText)) refuse('bylaws', `Article ${art.number}`, 'bylaws-notice', artText.slice(artText.indexOf('Notice:'), artText.indexOf('.', artText.indexOf('Notice:') + 120) + 1));
}
const sec = (ref) => {
  if (!sectionText.has(ref)) throw new Error(`the Bylaws have no section ${ref}`);
  return sectionText.get(ref);
};
const P = (ref) => provisionIndex.get(`bylaws:${ref}`);
const paren = (text, re) => { const m = text.match(re); if (!m) throw new Error(`no match for ${re}`); return Number(m[1]); };

// ---- Markdown documents: headings as provisions, tables by section.
const md = {};
for (const key of ['governance', 'changelog', 'toc', 'standards', 'conduct', 'security', 'contributing', 'readme']) {
  const text = docs[key].bytes.toString('utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const headings = [];
  let head = null;
  lines.forEach((l, i) => {
    const h = l.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (h) { head = provision(`${key}:${anchor(h[2])}`, key, h[2], h[2].replace(/^[\d.]+\s+/, '')); headings.push({ line: i, title: h[2], provision: head }); }
  });
  headings.forEach((h, n) => { provisions[h.provision].text = lines.slice(h.line + 1, headings[n + 1]?.line ?? lines.length).join('\n').trim(); });
  const under = (i) => [...headings].reverse().find((h) => h.line <= i)?.provision ?? provision(`${key}:`, key, '', docs[key].path);
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|/.test(lines[i]) || !/^\|[\s:|-]+\|$/.test(lines[i + 1] ?? '')) continue;
    const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => clean(c));
    const header = cells(lines[i]);
    const rows = [];
    let j = i + 2;
    for (; /^\|/.test(lines[j] ?? ''); j++) rows.push(Object.fromEntries(cells(lines[j]).map((c, k) => [header[k], c])));
    tables.push({ header, rows, provision: under(i), heading: provisions[under(i)].ref });
    i = j;
  }
  md[key] = { text, lines, headings, tables, under };
}
const table = (key, headingRe) => {
  const t = md[key].tables.find((x) => headingRe.test(x.heading));
  if (!t) throw new Error(`${key} has no table under ${headingRe}`);
  return t;
};

// ---- W3C ORG: the Foundation, its Board and its committees.
const units = [];
const unitIndex = new Map();
const unit = (name, classification, purpose, prov) => {
  if (!unitIndex.has(name)) { unitIndex.set(name, units.length); units.push({ name, classification, purpose, provision: prov }); }
  return unitIndex.get(name);
};
const subOrganizations = [];
const corpName = sec('1.1').match(/known as (.+?) \(the/)[1];
const foundation = unit(corpName, 'FormalOrganization', sec('1.2').split('. ')[0] + '.', P('1.1'));
const board = unit('Board of Directors', 'OrganizationalUnit', sec('4.1').split('. ')[0] + '.', P('4.1'));
subOrganizations.push({ unit: board, parent: foundation, provision: P('4.1') });
// 6.1 names the standing committees the Board may appoint, each with the responsibility the Bylaws give it.
const standing = sec('6.1').split(/Standing committees may include, without limitation: /)[1];
for (const part of standing.split(/; (?:and )?/)) {
  const m = part.match(/^an? (.+? Committee)(?: responsible for (.+?))?\.?$/);
  if (!m) throw new Error(`6.1 names a committee this projector cannot read: ${part}`);
  const c = unit(m[1], 'OrganizationalUnit', m[2] ? `Responsible for ${m[2].replace(/\.$/, '')}.` : '', P('6.1'));
  subOrganizations.push({ unit: c, parent: board, provision: P('6.1') });
}
const advisors = sec('6.7').match(/"([^"]+)"\)/)[1];
subOrganizations.push({ unit: unit(advisors, 'OrganizationalUnit', 'Serves in an advisory capacity only, with no right to vote on Board decisions.', P('6.7')), parent: board, provision: P('6.7') });
const committees = units.map((u, i) => i).filter((i) => / Committee$/.test(units[i].name));

// The TOC README is the evidence that the Technical Oversight Committee is established; no source establishes the others.
const tocTitle = md.toc.text.match(/^# UOR (.+?) \(TOC\)/m)[1];
if (!unitIndex.has(tocTitle)) refuse('unit', tocTitle, 'unit-not-in-bylaws', 'toc/README.md');
const toc = unitIndex.get(tocTitle);
for (const c of committees) if (c !== toc) refuse('unit', units[c].name, 'committee-establishment-unsourced', 'Bylaws 6.1 permits it; no Board resolution in the pinned sources establishes it');
for (const c of committees) refuse('unit', units[c].name, 'committee-members-unsourced', 'Bylaws 6.1 and 6.3: the Board appoints the members and chair; no pinned source names them');

// ---- W3C ORG Posts: the Board positions (4.3), the Officers (5.1) and each committee's chair (6.3).
const posts = [];
const post = (name, u, mandatory, prov) => { posts.push({ name, unit: u, mandatory, provision: prov }); return posts.length - 1; };
for (const m of sec('4.3').matchAll(/\((?:i|ii|iii|iv|v|vi|vii|viii|ix)\) ([A-Z][A-Za-z ]+?): /g)) post(m[1], board, true, P('4.3'));
const boardPosts = posts.map((p, i) => i);
const officers = sec('5.1');
for (const m of officers.matchAll(/one \(1\) ([A-Z]\w+)/g)) post(m[1], foundation, true, P('5.1'));
for (const m of officers.match(/including (.+?), and such Officers/)[1].split(/ and /)) post(m.replace(/^an? /, ''), foundation, false, P('5.1'));
for (const c of committees) post(`Chair of the ${units[c].name}`, c, true, P('6.3'));

// ---- W3C ORG Roles: the Director (4.2), the GitHub roles (GOVERNANCE 4.1), and the conduct roles the Code of Conduct names.
const roles = [];
const role = (name, u, prov, duty) => { roles.push({ name, unit: u, provision: prov, duty }); return roles.length - 1; };
role('Director', board, P('4.2'), 'One vote each, equal voting privileges.');
for (const r of table('governance', /^4\.1 Roles/).rows) role(r.Role, foundation, md.governance.tables.find((t) => /^4\.1/.test(t.heading)).provision, r['Core responsibility']);
for (const name of new Set([...md.conduct.text.matchAll(/\bCommunity (Moderators|Managers)\b/g)].map((m) => `Community ${m[1].replace(/s$/, '')}`))) {
  const at = md.conduct.lines.findIndex((l) => l.includes(name));
  role(name, foundation, md.conduct.under(at), 'Named by the Code of Conduct in its enforcement process.');
}

// ---- Vote and quorum rules, read from the Bylaws' words.
// The fractions are the Bylaws' own: "a majority" is more than one half, "2/3" is at least two thirds.
// The base is whom the fraction counts: the Directors serving, those present, or the whole committee.
const voteRules = [];
const rule = (r) => { voteRules.push(r); return voteRules.length - 1; };
const majority = { num: 1, den: 2, strict: true };
const PHRASES = [
  { re: /majority of Directors serving the Corporation at the time notice of a meeting of Directors is given shall constitute a quorum/, kind: 'quorum', base: 'serving' },
  { re: /act of a majority of Directors present at a meeting at which a quorum is present shall be the act of the Board/, kind: 'act', base: 'present' },
  { re: /removed, with or without cause, by a majority vote of the Directors present at a meeting at which a quorum is present, excluding the Director in question/, kind: 'removal', base: 'present', excludesSubject: true },
  { re: /vacancy shall be filled by a majority vote of the Directors present at a meeting at which a quorum is present/, kind: 'vacancy', base: 'present' },
  { re: /signed by the number of directors that would be required to take the same action at a meeting of the Board at which all directors were present/, kind: 'writtenAction', base: 'serving' },
  { re: /a majority of the whole committee shall constitute a quorum/, kind: 'quorum', base: 'whole' },
  { re: /act of a majority of the members present at a meeting at which a quorum is present shall be the act of the committee/, kind: 'act', base: 'present' },
];
const ruleOf = new Map();
for (const art of bylaws) for (const s of art.sections) {
  const text = sectionText.get(s.ref);
  for (const ph of PHRASES) {
    if (!ph.re.test(text)) continue;
    const bodies = art.number === 4 ? [board] : art.number === 6 ? committees : [];
    for (const b of bodies) {
      const i = rule({ body: b, kind: ph.kind, ...majority, base: ph.base, excludesSubject: !!ph.excludesSubject, provision: P(s.ref), basis: P(s.ref) });
      ruleOf.set(`${b}:${ph.kind}`, i);
    }
  }
}
for (const re of PHRASES) if (![...sectionText.values()].some((t) => re.re.test(t))) throw new Error(`the Bylaws no longer say ${re.re}`);
// Article IX: the Board amends the Bylaws at a meeting with notice under 4.9, so by the Board's act under 4.10.
if (/may be altered, amended or repealed .* by the Directors at any regular or special meeting/.test(provisions[provisionIndex.get('bylaws:Art.9')].text))
  rule({ ...voteRules[ruleOf.get(`${board}:act`)], kind: 'bylawAmendment', provision: provisionIndex.get('bylaws:Art.9') });
// 5.3: the Board removes an Officer by its act.
if (/may be removed by the Board of Directors/.test(sec('5.3'))) rule({ ...voteRules[ruleOf.get(`${board}:act`)], kind: 'officerRemoval', provision: P('5.3') });

// ---- The TOC lifecycle: each stage's decision, as a vote of the Technical Oversight Committee under Bylaws 6.5.
const DECISIONS = [
  { re: /^TOC approval$/, threshold: null },
  { re: /^TOC vote \(simple majority\)$/, threshold: majority },
  { re: /^TOC vote \(2\/3\)$/, threshold: { num: 2, den: 3, strict: false } },
];
const stageTable = table('toc', /^Project Stages$/);
const stages = [];
for (const r of stageTable.rows) {
  const d = DECISIONS.find((x) => x.re.test(r.Decision));
  if (!d) { refuse('stage', r.Stage, 'decision-unread', r.Decision); continue; }
  const act = voteRules[ruleOf.get(`${toc}:act`)];
  const v = d.threshold ? rule({ ...act, ...d.threshold, kind: 'stageDecision', provision: stageTable.provision }) : rule({ ...act, kind: 'stageDecision', provision: stageTable.provision });
  stages.push({ name: r.Stage, signal: r['Primary Signal'], evidence: r['Typical Evidence'], decision: r.Decision, voteRule: v, provision: stageTable.provision });
}

// ---- Fixed numbers the Bylaws set.
const constants = [
  { name: 'boardMinimum', value: paren(sec('4.2'), /no less than \w+ \((\d+)\)/), provision: P('4.2') },
  { name: 'boardMaximum', value: paren(sec('4.2'), /no more than \w+ \((\d+)\)/), provision: P('4.2') },
  { name: 'boardInitial', value: paren(sec('4.2'), /comprised of \w+ \((\d+)\) Directors/), provision: P('4.2') },
  { name: 'directorTermYears', value: paren(sec('4.4'), /term of \w+ \((\d+)\) years/), provision: P('4.4') },
  { name: 'noticeDaysByMail', value: paren(sec('4.9'), /at least \w+ \((\d+)\) days prior thereto by the mailing/), provision: P('4.9') },
  { name: 'noticeDaysByWire', value: paren(sec('4.9'), /at least \w+ \((\d+)\) days prior thereto by telephone/), provision: P('4.9') },
];

// ---- Service levels: the TOC timelines and the security response targets.
const serviceLevels = [];
for (const r of table('toc', /^Timelines$/).rows) serviceLevels.push({ action: r.Action, target: r['Target Timeline'], provision: table('toc', /^Timelines$/).provision });
const secTable = table('security', /^Response Timelines$/);
for (const r of secTable.rows) for (const col of secTable.header.slice(1)) serviceLevels.push({ action: `${col}: ${r.Severity}`, target: r[col], provision: secTable.provision });

// ---- Repository tiers and topic tags (GOVERNANCE 5 and 6, STANDARDS).
const tiers = table('governance', /^5\. Repository Classification$/).rows.map((r) => ({ name: r.Tier, useCase: r['Use case'], expectation: r['Minimum expectation'] }));
const tags = [];
for (const r of table('standards', /^Topic Tags$/).rows) for (const t of r['Required Tags'].split(',').map((x) => x.trim())) tags.push({ category: r.Category, tag: t, when: r.When });

// ---- The Code of Conduct enforcement ladder.
const ladderAt = md.conduct.lines.findIndex((l) => /^## Addressing and Repairing Harm/.test(l));
const rungs = [];
for (let i = ladderAt; i < md.conduct.lines.length && !/^## /.test(md.conduct.lines[i + 1] ?? '## '); i++) {
  const m = md.conduct.lines[i].match(/^(\d+)\. (.+)$/);
  if (!m) continue;
  const field = (f) => clean(md.conduct.lines.slice(i + 1, i + 4).find((l) => l.includes(`**${f}:**`)) ?? '').replace(`${f}:`, '').replace(/^- /, '').trim();
  rungs.push({ rank: Number(m[1]), name: m[2], event: field('Event'), consequence: field('Consequence'), provision: md.conduct.under(i) });
}

// ---- Escalation paths (GOVERNANCE 4.2): a path that sends a situation to a document needs a section there for it.
const escalation = table('governance', /^4\.2 Escalation$/);
for (const r of escalation.rows) {
  const target = r.Path.match(/([A-Z_]+\.md)/)?.[1];
  if (!target) continue;
  const key = Object.keys(md).find((k) => docs[k].path === target);
  const noun = r.Situation.split(' ')[0].toLowerCase();
  if (!md[key].headings.some((h) => h.title.toLowerCase().includes(noun))) refuse('escalation', r.Situation, 'escalation-target-lacks-section', `${r.Path} (${target} has no section on ${noun})`);
}

// ---- References: every link from one governance document to another, and every "Section N.M" it cites, resolves.
const references = [];
for (const key of Object.keys(md)) {
  const dir = posix.dirname(docs[key].path);
  md[key].lines.forEach((l, i) => {
    for (const m of l.matchAll(/\]\(([^)\s]+)\)/g)) {
      let target = m[1];
      const gh = target.match(/^https:\/\/github\.com\/UOR-Foundation\/\.github\/blob\/main\/(.+)$/);
      if (gh) target = gh[1];
      else if (/^[a-z]+:/.test(target)) continue;
      else target = posix.normalize(posix.join(dir, target));
      const [path, frag] = target.split('#');
      const toKey = Object.keys(docs).find((k) => docs[k].path === path);
      const from = md[key].under(i);
      if (!treePaths.has(path)) { refuse('reference', `${docs[key].path}: ${m[1]}`, 'reference-unresolved', `${path} is not in the pinned tree`); continue; }
      if (!toKey || !md[toKey]) { references.push({ from, to: toKey ? provision(`${toKey}:`, toKey, '', path) : provision(`file:${path}`, 'file', path, path), provision: from }); continue; }
      if (!frag) { references.push({ from, to: provision(`${toKey}:`, toKey, '', path), provision: from }); continue; }
      const hit = md[toKey].headings.find((h) => anchor(h.title) === frag);
      if (hit) references.push({ from, to: hit.provision, provision: from });
      else refuse('reference', `${docs[key].path}: ${m[1]}`, 'reference-unresolved', `${path} has no heading #${frag}`);
    }
  });
}

// ---- People and agents: Schema.org Person and SoftwareApplication, joined by PROV-O actedOnBehalfOf.
const people = [];
const personIndex = new Map();
const actor = (id, fields) => { if (!personIndex.has(id)) { personIndex.set(id, people.length); people.push({ id, ...fields }); } return personIndex.get(id); };
// The board, as the website publishes it; each member holds the Board position the Bylaws name for their role.
const boardSrc = docs.board.bytes.toString('utf8');
const boardBlock = boardSrc.slice(boardSrc.indexOf('export const BOARD'));
const holdings = [];
for (const m of boardBlock.matchAll(/\{ name: "([^"]+)", role: "([^"]+)", bio: "[^"]*", href: "([^"]+)"/g)) {
  const p = actor(`board:${m[1]}`, { type: 'Person', name: m[1], identifier: '', sameAs: m[3] });
  const at = boardPosts.find((i) => posts[i].name.replace(/ of the Board$/, '') === m[2]);
  if (at === undefined) refuse('holding', m[1], 'role-names-no-post', m[2]);
  else holdings.push({ person: p, post: at, source: 'board' });
}
for (const i of posts.keys()) if (posts[i].mandatory && !holdings.some((h) => h.post === i)) refuse('post', posts[i].name, 'post-holder-unsourced', `${units[posts[i].unit].name}: no pinned source names who holds it`);

// Commit history: each commit is a prov:Activity. Its author is the person responsible; a co-author that is software acted on their behalf.
const software = (name, email) => /\[bot\]$/.test(name) ? { name, applicationCategory: 'GitHub App', url: `https://github.com/apps/${name.replace(/\[bot\]$/, '')}` } : agentTable.find((a) => a.email === email);
const who = (name, email) => {
  const login = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/)?.[1] ?? '';
  const s = software(name, email);
  return s ? actor(`app:${s.name}`, { type: 'SoftwareApplication', name: s.name, identifier: login, sameAs: s.url, applicationCategory: s.applicationCategory }) : actor(`gh:${login || email}`, { type: 'Person', name, identifier: login, sameAs: login ? `https://github.com/${login}` : '' });
};
const delegationIndex = new Map();
const delegations = [];
for (const repo of sources.repositories) {
  const paths = repo.name === 'website' ? ['--', ...Object.values(repo.documents)] : [];
  const log = git(repo, 'log', repo.commit, '--format=%H%x1f%an%x1f%ae%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1e)%x1d', ...paths).toString();
  for (const rec of log.split('\x1d').map((x) => x.trim()).filter(Boolean)) {
    const [sha, an, ae, co] = rec.split('\x1f');
    const author = who(an, ae);
    const coauthors = (co ?? '').split('\x1e').map((x) => x.trim()).filter(Boolean).map((c) => { const m = c.match(/^(.+?) <(.+)>$/); return who(m[1], m[2]); });
    const all = [author, ...coauthors];
    const humans = all.filter((i) => people[i].type === 'Person');
    for (const a of all.filter((i) => people[i].type === 'SoftwareApplication')) {
      if (humans.length !== 1) { refuse('delegation', `${repo.name}@${sha}`, humans.length ? 'agent-principal-ambiguous' : 'agent-principal-unsourced', people[a].name); continue; }
      const k = `${a}:${humans[0]}:${repo.name}`;
      if (!delegationIndex.has(k)) { delegationIndex.set(k, delegations.length); delegations.push({ agent: a, onBehalfOf: humans[0], repository: repo.url, activities: 0 }); }
      delegations[delegationIndex.get(k)].activities += 1;
    }
  }
}

// W3C ORG Membership: a person who authored a commit in a governed repository holds the Contributor role
// (GOVERNANCE 4.1, "Proposes and ships improvements through PRs"); software never holds a role, it acts for a person.
const contributor = roles.findIndex((r) => r.name === 'Contributor');
const memberships = [];
for (const [i, p] of people.entries()) if (p.type === 'Person' && p.id.startsWith('gh:')) memberships.push({ person: i, role: contributor });
for (const [i, r] of roles.entries()) if (r.name !== 'Director' && !memberships.some((m) => m.role === i)) refuse('role', r.name, 'role-holders-unsourced', 'no pinned source names who holds this role');

// ---- The register.
const register = {
  spec: 'uor-community/governance-register/1',
  standards: ['W3C ORG (https://www.w3.org/TR/vocab-org/)', 'Schema.org Person, SoftwareApplication (https://schema.org/)', 'W3C PROV-O actedOnBehalfOf (https://www.w3.org/TR/prov-o/)'],
  tools: { pdftotext: pdftotextVersion },
  sources: sourceList,
  counts: { provisions: provisions.length, units: units.length, posts: posts.length, roles: roles.length, voteRules: voteRules.length, stages: stages.length, people: people.length, holdings: holdings.length, memberships: memberships.length, delegations: delegations.length, references: references.length, refusals: refusals.length },
  provisions: provisions.map(({ text, ...p }) => ({ ...p, sha256: sha256(text) })),
  units, subOrganizations, posts, roles, voteRules, stages, constants, serviceLevels, tiers, tags, rungs,
  people, holdings, memberships, delegations, references, refusals,
};
const out = JSON.stringify(register, null, 1) + '\n';
const target = join(here, 'register.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
    process.stderr.write('governance/register.json is not the projection of the pinned sources\n');
    process.exit(1);
  }
} else writeFileSync(target, out);
process.stdout.write(Object.entries(register.counts).map(([k, v]) => `${v} ${k}`).join(', ') + '\n');
