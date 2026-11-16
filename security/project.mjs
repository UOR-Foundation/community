#!/usr/bin/env node
/**
 * Project Foundation.Security.V1 into security/register.json from the authored
 * assessment (security/model.json), the telemetry (security/telemetry.json and
 * the observation corpus) and the standards security/sources.json pins:
 *
 * - NIST CSF 2.0: every function, category and subcategory not withdrawn, from
 *   NIST's own export; every subcategory is achieved by a control or is a gap.
 * - NIST SP 800-30 Rev. 1: the Table D-2 threat-source taxonomy and the Table
 *   G-5 and I-2 matrices, read from the publication with pdftotext; overall
 *   likelihood and risk are computed from them, never stated.
 * - MITRE ATT&CK 20.1 and ATLAS 2026.10: every technique a threat names must
 *   exist and be neither revoked nor deprecated.
 * - STRIDE per element (Microsoft SDL) and LINDDUN: every category an element is
 *   open to is answered by a threat or stated open, never both.
 * - OpenSSF Scorecard v5.6.0: every check a control cites must be a check.
 *
 *   node security/project.mjs <sources-dir> [--check]
 *
 * <sources-dir> holds each pinned file under its name and each pinned
 * repository checked out under its name (oracles/reproject.mjs fetches both).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const [dir, flag] = process.argv.slice(2);
if (!dir) { process.stderr.write('usage: project.mjs <sources-dir> [--check]\n'); process.exit(64); }
const fail = (m) => { throw new Error(m); };
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const visibleText = (b) => b.toString('utf8').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pins = json(join(here, 'sources.json'));
const model = json(join(here, 'model.json'));
const telemetry = json(join(here, 'telemetry.json'));

const file = (name) => {
  const pin = pins.files.find((f) => f.name === name) ?? fail(`no pinned source ${name}`);
  const bytes = readFileSync(join(dir, name));
  // form "text": the page carries per-request nonces, so its visible text (scripts, styles and tags dropped) is pinned.
  const pinned = pin.form === 'text' ? visibleText(bytes) : bytes;
  if (sha256(pinned) !== pin.sha256) fail(`${name} is not the pinned ${pin.form ?? 'bytes'} (sha256 ${sha256(pinned)})`);
  return bytes;
};
for (const r of pins.repositories) {
  const at = execFileSync('git', ['-C', join(dir, r.name), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (at !== r.commit) fail(`${r.name} is at ${at}, not the pinned ${r.commit}`);
}

const LEVELS = ['VL', 'L', 'M', 'H', 'VH'];
const LEVEL_NAMES = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
const level = (x, where) => { const i = LEVELS.indexOf(x); if (i < 0) fail(`${where}: ${x} is not an SP 800-30 level`); return i; };

// NIST CSF 2.0. An element NIST withdrew carries a withdraw_reason element named WR-<id>.
const csfDoc = JSON.parse(file('csf-2.0.json').toString('utf8')).response.elements;
const csfIds = new Set(csfDoc.elements.map((e) => e.element_identifier));
const active = (t) => csfDoc.elements.filter((e) => e.element_type === t && !csfIds.has(`WR-${e.element_identifier}`));
const functions = active('function').map((e) => ({ id: e.element_identifier, name: e.title, text: e.text }));
const categories = active('category').map((e) => ({ id: e.element_identifier, name: e.title, function: functions.findIndex((f) => f.id === e.element_identifier.split('.')[0]) }));
const subcategories = active('subcategory').map((e) => ({ id: e.element_identifier, text: e.text, category: categories.findIndex((c) => c.id === e.element_identifier.split('-')[0]) }));
// CSF 2.0 orders functions GV, ID, PR, DE, RS, RC; NIST's sort elements give that order.
const sortKey = new Map(csfDoc.elements.filter((e) => e.element_type === 'sort').map((e) => [e.element_identifier.slice(2), e.title]));
const bySort = (a, b) => (sortKey.get(a.id) ?? fail(`no sort key for ${a.id}`)).localeCompare(sortKey.get(b.id));
functions.sort(bySort); categories.sort(bySort); subcategories.sort(bySort);
for (const c of categories) c.function = functions.findIndex((f) => f.id === c.id.split('.')[0]);
for (const s of subcategories) s.category = categories.findIndex((c) => c.id === s.id.split('-')[0]);
if ([functions.length, categories.length, subcategories.length].join() !== '6,22,106') fail(`CSF 2.0 has 6 functions, 22 categories and 106 subcategories, not ${functions.length}, ${categories.length}, ${subcategories.length}`);

// NIST SP 800-30 Rev. 1, read from the publication.
// pdftotext prints its version on stderr.
const pdftotext = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).stderr.trim();
const sp = execFileSync('pdftotext', ['-layout', join(dir, 'sp800-30r1.pdf'), '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
file('sp800-30r1.pdf');
const section = (title) => { const at = sp.indexOf(title); if (at < 0) fail(`SP 800-30 has no ${title}`); return sp.slice(at, at + 4000); };
const matrix = (title) => {
  const rows = [];
  const cell = new RegExp(LEVEL_NAMES.slice().reverse().join('|'), 'g');
  for (const line of section(title).split('\n')) {
    const found = line.match(cell);
    if (found && found.length === 6) rows.push(found);
    if (rows.length === 5) break;
  }
  if (rows.length !== 5) fail(`${title} is not a 5 by 5 table`);
  const cells = [];
  for (const r of rows) {
    const row = LEVEL_NAMES.indexOf(r[0]);
    r.slice(1).forEach((v, column) => cells.push({ row, column, level: LEVEL_NAMES.indexOf(v) }));
  }
  cells.sort((a, b) => a.row - b.row || a.column - b.column);
  if (cells.some((c, i) => c.row * 5 + c.column !== i)) fail(`${title} does not give every row`);
  return cells;
};
const G5 = matrix('TABLE G-5: ASSESSMENT SCALE – OVERALL LIKELIHOOD');
const I2 = matrix('TABLE I-2: ASSESSMENT SCALE – LEVEL OF RISK');
// Table D-2: the left column's taxonomy, as "Parent - Child" for nested types.
const taxonomy = new Map();
{
  let kind = null; let parent = null;
  const text = section('TABLE D-2: TAXONOMY OF THREAT SOURCES').split('TABLE D-3')[0];
  for (const line of text.split('\n')) {
    const left = line.slice(0, 44);
    const top = left.match(/^ (ADVERSARIAL|ACCIDENTAL|STRUCTURAL|ENVIRONMENTAL)\b/);
    if (top) { kind = top[1].toLowerCase(); continue; }
    const one = left.match(/^ - (\S.*?)\s*$/); const two = left.match(/^ {3}- (\S.*?)\s*$/);
    if (one && kind) { parent = one[1]; taxonomy.set(parent, kind); }
    else if (two && kind && parent) taxonomy.set(`${parent} - ${two[1]}`, kind);
  }
  if (taxonomy.get('Individual - Outsider') !== 'adversarial' || taxonomy.get('Infrastructure Failure/Outage') !== 'environmental') fail('Table D-2 was not read');
}

// MITRE ATT&CK and ATLAS.
const techniques = new Map();
for (const o of JSON.parse(file('enterprise-attack-20.1.json').toString('utf8')).objects) {
  if (o.type !== 'attack-pattern') continue;
  const id = (o.external_references ?? []).find((r) => r.source_name === 'mitre-attack')?.external_id;
  if (id) techniques.set(id, { catalog: 'attack', name: o.name, revoked: !!o.revoked, deprecated: !!o.x_mitre_deprecated });
}
{
  // ATLAS's techniques are the two-space keys of its top-level `techniques:` map, each with a `name:`.
  const lines = file('ATLAS-2026.10.yaml').toString('utf8').split('\n');
  let inside = false; let id = null;
  for (const line of lines) {
    if (/^\S/.test(line)) { inside = line === 'techniques:'; id = null; continue; }
    if (!inside) continue;
    const key = line.match(/^ {2}(AML\.T\d{4}(?:\.\d{3})?):\s*$/);
    if (key) { id = key[1]; continue; }
    const name = line.match(/^ {4}name: (.*)$/);
    if (id && name && !techniques.has(id)) techniques.set(id, { catalog: 'atlas', name: name[1].replace(/^'(.*)'$/, '$1'), revoked: false, deprecated: false });
  }
  if (!techniques.get('AML.T0051.001')) fail('ATLAS techniques were not read');
}

// OpenSSF Scorecard checks: the two-space keys of `checks:`, each with a `risk:`.
const scorecard = [];
{
  let inside = false;
  for (const line of file('scorecard-checks.yaml').toString('utf8').split('\n')) {
    if (/^\S/.test(line)) { inside = line === 'checks:'; continue; }
    const key = inside && line.match(/^ {2}([A-Za-z-]+):\s*$/);
    if (key) scorecard.push({ name: key[1], risk: '' });
    const risk = inside && line.match(/^ {4}risk: (\w+)/);
    if (risk) scorecard[scorecard.length - 1].risk = risk[1];
  }
  if (scorecard.length !== 20) fail(`Scorecard v5.6.0 defines 20 checks, not ${scorecard.length}`);
}

// LINDDUN's seven categories, in the order its framework page names them.
const linddunText = file('linddun.html').toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const LINDDUN = ['Linking', 'Identifying', 'Non-repudiation', 'Detecting', 'Data Disclosure', 'Unawareness', 'Non-compliance'];
if (!linddunText.includes(`${LINDDUN.join(', ')}.`)) fail('the LINDDUN page does not name its seven categories');
const LINDDUN_KEYS = ['L', 'I', 'Nr', 'De', 'Dd', 'U', 'Nc'];
const STRIDE = ['Spoofing', 'Tampering', 'Repudiation', 'Information disclosure', 'Denial of service', 'Elevation of privilege'];
const STRIDE_KEYS = ['S', 'T', 'R', 'I', 'D', 'E'];
// STRIDE per element, as Microsoft's SDL threat modeling assigns it (Shostack, Threat Modeling, 2014, table 3-9).
const KINDS = ['externalEntity', 'process', 'dataStore', 'dataFlow'];
const strideApplies = (kind, c) => ({ externalEntity: [0, 2], process: [0, 1, 2, 3, 4, 5], dataStore: [1, 2, 3, 4], dataFlow: [1, 3, 4] })[kind].includes(c);

// The authored assessment.
const sourceIx = new Map(model.sources.map((s, i) => [s.id, i]));
const threatIx = new Map(model.threats.map((t, i) => [t.id, i]));
const controlIx = new Map(model.controls.map((c, i) => [c.id, i]));
const subIx = new Map(subcategories.map((s, i) => [s.id, i]));
const sources = model.sources.map((s) => {
  const kind = taxonomy.get(s.type) ?? fail(`${s.id}: ${s.type} is not a Table D-2 threat source`);
  if (kind !== s.kind) fail(`${s.id}: Table D-2 places ${s.type} under ${kind}, not ${s.kind}`);
  const rated = kind === 'adversarial';
  return { id: s.id, name: s.name, type: s.type, kind, rated, capability: rated ? level(s.capability, s.id) : 0, intent: rated ? level(s.intent, s.id) : 0, targeting: rated ? level(s.targeting, s.id) : 0, text: s.text };
});
const usedTechniques = [...new Set(model.threats.flatMap((t) => t.attack))].sort();
const techniqueList = usedTechniques.map((id) => {
  const t = techniques.get(id) ?? fail(`${id} is not an ATT&CK 20.1 or ATLAS 2026.10 technique`);
  if (t.revoked || t.deprecated) fail(`${id} (${t.name}) is ${t.revoked ? 'revoked' : 'deprecated'} in ${t.catalog === 'attack' ? 'ATT&CK 20.1' : 'ATLAS 2026.10'}`);
  return { id, ...t };
});
const techIx = new Map(techniqueList.map((t, i) => [t.id, i]));
const threats = model.threats.map((t) => {
  const source = sourceIx.get(t.source) ?? fail(`${t.id}: no source ${t.source}`);
  const initiation = level(t.initiation, t.id); const adverse = level(t.adverse, t.id); const impact = level(t.impact, t.id);
  const overall = G5[initiation * 5 + adverse].level;
  const risk = I2[overall * 5 + impact].level;
  if (!['mitigate', 'accept', 'avoid', 'share', 'transfer'].includes(t.response)) fail(`${t.id}: ${t.response} is not an SP 800-39 risk response`);
  if (t.response === 'mitigate' && !t.controls.length) fail(`${t.id} is mitigated by no control`);
  if (t.response === 'accept' && (!t.rationale || t.controls.length)) fail(`${t.id} is accepted without a rationale, or with controls`);
  return { id: t.id, name: t.name, text: t.text, source, initiation, adverse, impact, overall, risk, response: t.response, rationale: t.rationale ?? '', controls: t.controls.map((c) => controlIx.get(c) ?? fail(`${t.id}: no control ${c}`)), techniques: t.attack.map((a) => techIx.get(a)) };
});

const evidenceOf = (ref, where) => {
  const [kind, ...rest] = ref.split(':'); const path = rest.join(':');
  if (kind === 'scorecard') { if (!scorecard.some((c) => c.name === path)) fail(`${where}: ${path} is not a Scorecard v5.6.0 check`); return { kind, reference: path }; }
  const base = kind === 'community' ? root : pins.repositories.some((r) => r.name === kind) ? join(dir, kind) : fail(`${where}: unknown evidence ${ref}`);
  if (!existsSync(join(base, path))) fail(`${where}: ${ref} does not exist`);
  return { kind: kind === 'community' ? 'path' : 'pinned', reference: kind === 'community' ? path : `${kind}@${pins.repositories.find((r) => r.name === kind).commit}:${path}` };
};
const STATUSES = ['implemented', 'partial', 'planned', 'alternative', 'not-applicable'];
const controls = model.controls.map((c) => {
  if (!STATUSES.includes(c.status)) fail(`${c.id}: ${c.status} is not an OSCAL implementation-status`);
  const evidence = c.evidence.map((e) => evidenceOf(e, c.id));
  if (['implemented', 'partial'].includes(c.status) && !evidence.length) fail(`${c.id} is ${c.status} with no evidence`);
  return { id: c.id, name: c.name, text: c.text, status: c.status, evidence, outcomes: c.csf.map((s) => subIx.get(s) ?? fail(`${c.id}: ${s} is not a CSF 2.0 subcategory`)) };
});
const gaps = Object.entries(model.gaps).map(([id, why]) => {
  const [status, ...rest] = why.split(': ');
  if (!['planned', 'not-applicable'].includes(status)) fail(`gap ${id}: ${status}`);
  return { subcategory: subIx.get(id) ?? fail(`gap ${id} is not a CSF 2.0 subcategory`), status, rationale: rest.join(': ') };
}).sort((a, b) => a.subcategory - b.subcategory);
const outcomes = controls.flatMap((c, control) => c.outcomes.map((subcategory) => ({ control, subcategory }))).sort((a, b) => a.subcategory - b.subcategory || a.control - b.control);
for (const [i, s] of subcategories.entries()) {
  const mapped = outcomes.some((o) => o.subcategory === i); const gap = gaps.some((g) => g.subcategory === i);
  if (mapped === gap) fail(`${s.id} is ${mapped ? 'both achieved by a control and a gap' : 'neither achieved by a control nor a gap'}`);
}

const elements = model.elements.map((e) => ({ id: e.id, name: e.name, text: e.text, kind: e.kind, personal: !!e.personal }));
const slots = (keys, applies, field) => model.elements.flatMap((e, element) => keys.map((key, category) => {
  const answer = (e[field] ?? {})[key];
  const open = applies(e, category);
  if (!open && answer !== undefined) fail(`${e.id} is not open to ${field} ${key}, so nothing may answer or state it`);
  if (open && answer === undefined) fail(`${e.id} is open to ${field} ${key}, which is neither answered nor stated open`);
  if (!open) return { element, category, state: 'notApplicable', threat: 0, rationale: '' };
  if (answer.startsWith('open: ')) return { element, category, state: 'stated', threat: 0, rationale: answer.slice(6) };
  return { element, category, state: 'answered', threat: threatIx.get(answer) ?? fail(`${e.id} ${key}: no threat ${answer}`), rationale: '' };
}));
if (model.elements.some((e) => !KINDS.includes(e.kind))) fail('an element is not a DFD element kind');
const strideSlots = slots(STRIDE_KEYS, (e, c) => strideApplies(e.kind, c), 'stride');
const linddunSlots = slots(LINDDUN_KEYS, (e) => !!e.personal, 'linddun');
for (const t of model.threats) {
  if (![...strideSlots, ...linddunSlots].some((s) => s.state === 'answered' && s.threat === threatIx.get(t.id))) fail(`${t.id} answers no element's category`);
}

// Indicators: what the telemetry shows, each read against the threat it is consistent with and never attributed.
const indicators = [];
for (const r of telemetry.repositories.filter((x) => x.traffic === 'read')) {
  const unexplained = r.clones.reduce((a, d) => a + Math.max(0, d.uniques - d.ownCheckoutJobs), 0);
  const uniques = r.clones.reduce((a, d) => a + d.uniques, 0); const own = r.clones.reduce((a, d) => a + d.ownCheckoutJobs, 0);
  indicators.push({ id: `IN-CLONES-${r.repository.split('/')[1].replace(/^\./, '')}`, threat: threatIx.get('T23'), source: `security/telemetry.json ${telemetry.collected}`, measure: 'unique cloners per day beyond the Foundation\'s own checkout jobs, summed over GitHub\'s 14-day window', value: unexplained, text: `${r.repository}: ${uniques} daily unique cloners against ${own} own checkout jobs; ${unexplained} are not explained by the Foundation's CI (agent sessions, Lovable and mirrors also clone; OC-CLONES).` });
}
const corpus = json(join(root, 'observations', 'corpus.json'));
const discordFile = corpus.files.find((f) => f.source === 'discord');
const discordBytes = readFileSync(join(root, 'observations', 'corpus', discordFile.path));
if (sha256(gunzipSync(discordBytes)) !== discordFile.sha256) fail('the Discord corpus is not the bytes corpus.json pins');
const messages = gunzipSync(discordBytes).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
// ISO 7870-2 c chart of weekly member joins (Discord message type 7): limits c-bar +/- 3 sqrt(c-bar).
const monday = (t) => { const d = new Date(t.slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const joins = messages.filter((m) => m.rich.message_type === 7).map((m) => monday(m.rich.grimoire_creation_date));
const weeks = []; for (let d = new Date(joins.slice().sort()[0] + 'T00:00:00Z'), end = monday(corpus.cut); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 7)) weeks.push(d.toISOString().slice(0, 10));
const perWeek = weeks.map((w) => joins.filter((j) => j === w).length);
const cbar = joins.length / weeks.length; const ucl = cbar + 3 * Math.sqrt(cbar);
const above = weeks.filter((w, i) => perWeek[i] > ucl);
indicators.push({ id: 'IN-JOINS', threat: threatIx.get('T16'), source: `observations/corpus.json ${corpus.cut}`, measure: 'weeks whose member joins exceed the c chart upper limit (ISO 7870-2, c-bar + 3 sqrt(c-bar))', value: above.length, text: `${joins.length} joins over ${weeks.length} weeks, c-bar ${cbar.toFixed(2)}, upper limit ${ucl.toFixed(2)}; weeks above it: ${above.join(', ') || 'none'}. A burst is consistent with a raid or with an announcement; the corpus holds no message text to tell them apart.` });
const posters = new Set(messages.filter((m) => [0, 19].includes(m.rich.message_type)).map((m) => m.author.identity));
const joiners = new Set(messages.filter((m) => m.rich.message_type === 7).map((m) => m.author.identity));
indicators.push({ id: 'IN-SILENT', threat: threatIx.get('T16'), source: `observations/corpus.json ${corpus.cut}`, measure: 'members who joined and never posted', value: [...joiners].filter((j) => !posters.has(j)).length, text: `${[...joiners].filter((j) => !posters.has(j)).length} of ${joiners.size} joining members never posted. Silent members are usual in any community; this is no sign of sockpuppets on its own.` });
indicators.push({ id: 'IN-AUTOMOD', threat: threatIx.get('T07'), source: `observations/corpus.json ${corpus.cut}`, measure: 'AutoMod action messages (Discord message type 24) in the readable channels', value: messages.filter((m) => m.rich.message_type === 24).length, text: 'AutoMod posts an action message where an alert channel is set; none appears, so either no rule fired or no alert channel is readable (OC-DISCORDMOD).' });
const issues = corpus.files.filter((f) => f.source === 'github').flatMap((f) => gunzipSync(readFileSync(join(root, 'observations', 'corpus', f.path))).toString('utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const byIdentity = new Map(); for (const i of issues) byIdentity.set(i.author.identity, (byIdentity.get(i.author.identity) ?? 0) + 1);
indicators.push({ id: 'IN-OUTSIDERS', threat: threatIx.get('T21'), source: `observations/corpus.json ${corpus.cut}`, measure: 'identities with a single issue or pull request across the ecosystem', value: [...byIdentity.values()].filter((n) => n === 1).length, text: `${issues.length} issues and pull requests come from ${byIdentity.size} identities; ${[...byIdentity.values()].filter((n) => n === 1).length} appear once. Outside contribution is rare, so a malicious contribution would stand out, and so would the review load it needs.` });

const register = {
  spec: 'uor-community/security-register/1',
  about: 'Foundation.Security.V1, projected by security/project.mjs from security/model.json, security/telemetry.json, the observation corpus and the standards security/sources.json pins. Never edited by hand.',
  assessed: model.assessed,
  mission: model.mission,
  standards: pins.files.map(({ name, standard, url, sha256: digest }) => ({ name, standard, url, sha256: digest })),
  repositories: pins.repositories,
  tools: { pdftotext: pdftotext.split('\n')[0] },
  csf: { functions, categories, subcategories },
  tables: { G5, I2 },
  stride: STRIDE, linddun: LINDDUN, scorecard,
  techniques: techniqueList,
  sources, elements, threats, controls, gaps, outcomes,
  strideSlots, linddunSlots, indicators,
  openClaims: model.openClaims,
};
const text = JSON.stringify(register, null, 1) + '\n';
const target = join(here, 'register.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write('security/register.json is not the projection of its sources\n'); process.exit(1); }
} else writeFileSync(target, text);
const risks = threats.reduce((a, t) => { a[LEVELS[t.risk]] = (a[LEVELS[t.risk]] ?? 0) + 1; return a; }, {});
process.stdout.write(`${threats.length} threats (risk ${LEVELS.map((l) => `${l} ${risks[l] ?? 0}`).join(', ')}), ${controls.length} controls, ${subcategories.length - gaps.length}/${subcategories.length} CSF outcomes with a control, ${strideSlots.filter((s) => s.state !== 'notApplicable').length} STRIDE and ${linddunSlots.filter((s) => s.state !== 'notApplicable').length} LINDDUN pairs, ${indicators.length} indicators\n`);
