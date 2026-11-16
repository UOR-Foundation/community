#!/usr/bin/env node
/**
 * Project the licensing register from licensing/scan.json, the pinned SPDX
 * License List and the Foundation's own licensing policy, and write the REUSE
 * remediation draft of every repository (data only: nothing is applied).
 *
 * Every declared identifier is resolved against the pinned list and carries
 * the list's OSI-approved, FSF-libre and deprecated flags; one that is not on
 * it, an expression that does not parse, a LICENSE text the matching
 * guidelines cannot identify, declarations that disagree, a repository the
 * REUSE tool does not find compliant, and a declaration the policy does not
 * allow are typed refusals carried as open claims. The policy is read, never
 * assumed: GOVERNANCE.md 13 (the default and its named exceptions), 6.1 (a
 * LICENSE at every tier), CONTRIBUTING.md "License" (inbound terms) and the
 * website's statements, resolved to SPDX identifiers by the site's own
 * spdxWords mapping. The same inputs always write the same bytes.
 *
 *   node licensing/project.mjs <sources-dir> [--check]
 *
 * <sources-dir> holds dotgithub, website and spdx-license-list at the commits sources.json pins.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExpression, leaves } from './spdx.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <sources-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const local = (p) => { const bytes = readFileSync(join(here, '..', p)); return { path: p, sha256: sha256(bytes), json: JSON.parse(bytes.toString('utf8')) }; };
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const snapshot = local('licensing/snapshot.json');
const scan = local('licensing/scan.json');
const eco = local(sources.ecosystem.snapshot);
if (snapshot.json.ecosystemSnapshot.sha256 !== eco.sha256) throw new Error('licensing/snapshot.json pins another ecosystem snapshot');
if (scan.json.snapshot.sha256 !== snapshot.sha256) throw new Error('licensing/scan.json observed another snapshot');
if (scan.json.tool.reuse !== sources.reuse.version || scan.json.spdx.commit !== sources.spdx.commit) throw new Error('licensing/scan.json was observed with another tool or list');
const names = eco.json.repositories.map((r) => r.name);
if (scan.json.repositories.map((r) => r.repository).join() !== names.join()) throw new Error('licensing/scan.json does not hold the snapshot repositories in order');

function pinned(source) {
  const dir = join(root, source.name);
  const at = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (at !== source.commit) throw new Error(`${source.name} is at ${at}, not the pinned ${source.commit}`);
  return (path) => {
    const bytes = readFileSync(join(dir, path));
    return { path, ref: `${source.url}@${source.commit}:${path}`, sha256: sha256(bytes), text: bytes.toString('utf8').replace(/\r\n/g, '\n') };
  };
}
const spdx = pinned(sources.spdx);
const policy = pinned(sources.policy);
const site = pinned(sources.website);
const licensesFile = spdx(sources.spdx.licenses);
const exceptionsFile = spdx(sources.spdx.exceptions);
const listJson = JSON.parse(licensesFile.text);
const excJson = JSON.parse(exceptionsFile.text);
if (`v${listJson.licenseListVersion}` !== sources.spdx.tag) throw new Error(`the list is ${listJson.licenseListVersion}, not ${sources.spdx.tag}`);
const byId = new Map(listJson.licenses.map((l) => [l.licenseId.toLowerCase(), l]));
const excById = new Map(excJson.exceptions.map((e) => [e.licenseExceptionId.toLowerCase(), e]));

// ---- The policy, read from its sources.
const governance = policy(sources.policy.governance);
const contributing = policy(sources.policy.contributing);
const standards = policy(sources.policy.standards);
const section = (doc, heading) => {
  const at = doc.text.indexOf(`\n## ${heading}\n`);
  if (at < 0) throw new Error(`${doc.path} has no "## ${heading}" section`);
  const rest = doc.text.slice(at + heading.length + 5);
  const end = rest.search(/\n## |\n---/);
  return end < 0 ? rest : rest.slice(0, end);
};
const listed = (id) => byId.get(id.toLowerCase());
let defaultLicense = '';
const exceptions = [];
let exceptionRule = '';
for (const line of section(governance, '13. Intellectual Property & Licensing').split('\n').map((l) => l.trim()).filter(Boolean)) {
  let m;
  if ((m = line.match(/^- Default license policy is ([A-Za-z0-9.-]+) across foundation repos\.$/))) defaultLicense = m[1];
  else if (line === '- Exceptions require owner approval and clear documentation.') exceptionRule = line.slice(2);
  else if ((m = line.match(/^- Current known exceptions?: (.+)\.$/))) {
    for (const e of m[1].matchAll(/\[([^\]]+)\]\([^)]*\) uses ([A-Za-z0-9.-]+)/g)) exceptions.push({ repository: e[1], license: e[2] });
  } else throw new Error(`GOVERNANCE.md 13 says "${line}", which the projector does not read`);
}
if (!defaultLicense || !exceptionRule || exceptions.length === 0) throw new Error('GOVERNANCE.md 13 no longer states a default, the exception rule and its exceptions');
const requiredRow = section(governance, '6. Repository Standards').split('\n').find((l) => l.startsWith('| `LICENSE` |'));
if (!requiredRow) throw new Error('GOVERNANCE.md 6.1 has no LICENSE row');
const licenseRequired = requiredRow.split('|').slice(2, -1).map((c) => c.trim());
if (!licenseRequired.every((c) => c === 'Req')) throw new Error(`GOVERNANCE.md 6.1 requires LICENSE only at some tiers: ${licenseRequired}`);
const inboundText = section(contributing, 'License').trim();
const inbound = inboundText.match(/under the repository's license \(([A-Za-z0-9.-]+) by default\)/);
if (!inbound) throw new Error('CONTRIBUTING.md "License" no longer names a default');
const DCO = /\b(DCO|Developer Certificate of Origin|Signed-off-by)\b/i;
const CLA = /\b(CLA|Contributor License Agreement)\b/;
const dcoRule = [governance, contributing, standards].some((d) => DCO.test(d.text));
const claRule = [governance, contributing, standards].some((d) => CLA.test(d.text));

// The website's statements, resolved by its own spdxWords mapping (src/docs/content.ts).
const wordsFile = site(sources.website.words.path);
if (!new RegExp(sources.website.words.pattern).test(wordsFile.text)) throw new Error('src/docs/content.ts no longer defines spdxWords as pinned');
const spdxWords = (id) => id.replace(/ OR /g, ' or ').replace(/ AND /g, ' and ').replace(/-(\d)/g, ' $1');
const fromWords = (words) => words.split(/( or | and )/).map((part) => {
  if (part === ' or ') return ' OR ';
  if (part === ' and ') return ' AND ';
  const ids = listJson.licenses.filter((l) => !l.isDeprecatedLicenseId && spdxWords(l.licenseId) === part).map((l) => l.licenseId);
  if (ids.length !== 1) throw new Error(`"${part}" is spdxWords of ${ids.length} listed licenses`);
  return ids[0];
}).join('');
const statements = sources.website.statements.map((s) => {
  const file = site(s.path);
  const m = file.text.match(new RegExp(s.pattern));
  if (!m) throw new Error(`${s.path} no longer states the ${s.kind} license`);
  return s.kind === 'crate' ? { ...s, file, crate: m[1], license: fromWords(m[2]), words: m[2], sentence: m[0] } : { ...s, file, license: fromWords(m[1]), words: m[1], sentence: m[0] };
});
const crateStatement = statements.find((s) => s.kind === 'crate');
const codeStatement = statements.find((s) => s.kind === 'code');
const codeIds = leaves(parseExpression(codeStatement.license)).map((l) => l.id);

// ---- Rules: each a statement of a pinned source.
const rules = [];
const rule = (doc, sectionName, statement, subject, licenses) => { rules.push({ index: rules.length, document: `${doc.ref}#sha256:${doc.sha256}`, section: sectionName, statement, subject, licenses }); return rules.length - 1; };
const defaultRule = rule(governance, '13', `Default license policy is ${defaultLicense} across foundation repos.`, '*', defaultLicense);
const exceptionRules = new Map(exceptions.map((e) => [e.repository, rule(governance, '13', `Current known exception: ${e.repository} uses ${e.license}. ${exceptionRule}`, e.repository, e.license)]));
const requiredRule = rule(governance, '6.1', 'LICENSE is required at Tier 1, Tier 2, Tier 3 and Tier 4.', '*', '');
rule(contributing, 'License', inboundText.replace(/\s+/g, ' '), '*', inbound[1]);
const crateRule = rule(crateStatement.file, crateStatement.path, crateStatement.sentence, `crate ${crateStatement.crate}`, crateStatement.license);
const codeRule = rule(codeStatement.file, codeStatement.path, codeStatement.sentence, '*', codeStatement.license);

const policyClaims = [];
if (inbound[1] !== defaultLicense) policyClaims.push({ refusal: 'policy-mismatch', detail: `CONTRIBUTING.md names ${inbound[1]} as the default; GOVERNANCE.md 13 names ${defaultLicense}` });
for (const id of [defaultLicense, ...exceptions.map((e) => e.license), inbound[1], ...codeIds]) {
  if (!listed(id)) policyClaims.push({ refusal: 'identifier-unlisted', detail: `the policy names ${id}, which SPDX License List ${listJson.licenseListVersion} does not list` });
}

// ---- Licenses: every listed identifier the register refers to, with the list's flags.
const licenses = [];
const licenseAt = new Map();
const license = (raw, exception = false) => {
  const entry = exception ? excById.get(raw.toLowerCase()) : listed(raw);
  if (!entry) return -1;
  const id = exception ? entry.licenseExceptionId : entry.licenseId;
  if (!licenseAt.has(id)) {
    licenseAt.set(id, licenses.length);
    licenses.push({ index: licenses.length, id, name: entry.name, exception, osiApproved: Boolean(entry.isOsiApproved), fsfLibre: Boolean(entry.isFsfLibre), deprecated: Boolean(exception ? entry.isDeprecatedLicenseId : entry.isDeprecatedLicenseId) });
  }
  return licenseAt.get(id);
};
license(defaultLicense);
for (const e of exceptions) license(e.license);

// ---- Repositories.
const declarations = [];
const declaredIds = [];
const refusals = [];
const claim = (repository, refusal, detail) => {
  if (!refusals.some((c) => c.repository === repository && c.refusal === refusal && c.detail === detail)) refusals.push({ repository, refusal, detail });
};
const cite = (r) => `${rules[r].document} (${rules[r].section})`;
const canonical = (tree) => {
  if (tree.and || tree.or) {
    const parts = (tree.and ?? tree.or).map((t) => ((t.and || t.or) ? `(${canonical(t)})` : canonical(t)));
    return parts.join(tree.and ? ' AND ' : ' OR ');
  }
  if (tree.ref) return tree.ref;
  const id = listed(tree.id)?.licenseId ?? tree.id;
  const exc = tree.exception ? ` WITH ${excById.get(tree.exception.toLowerCase())?.licenseExceptionId ?? tree.exception}` : '';
  return `${id}${tree.orLater ? '+' : ''}${exc}`;
};
const drafts = [];
const crateHolders = [];

const repositories = scan.json.repositories.map((s, index) => {
  const ru = s.reuse;
  const exceptionRuleAt = exceptionRules.get(s.repository);
  const governing = exceptionRuleAt ?? defaultRule;
  const expectedId = rules[governing].licenses;
  const expected = license(expectedId);
  const declared = [];
  const declare = (kind, source, expression, packageName = '') => {
    let tree;
    try { tree = parseExpression(expression); } catch (e) {
      claim(index, 'expression-invalid', `${s.repository}:${source} declares "${expression}", ${e.message.replace(/^.*?: /, '')} (SPDX 2.3.1 Annex D)`);
      return;
    }
    const ids = leaves(tree);
    const resolved = [];
    for (const l of ids) {
      if (l.ref) { claim(index, 'identifier-unlisted', `${s.repository}:${source} declares ${l.ref}, a LicenseRef no SPDX License List entry defines`); return; }
      const at = license(l.id);
      if (at < 0) { claim(index, 'identifier-unlisted', `${s.repository}:${source} declares ${l.id}, which SPDX License List ${listJson.licenseListVersion} does not list`); return; }
      if (l.exception && license(l.exception, true) < 0) { claim(index, 'identifier-unlisted', `${s.repository}:${source} declares the exception ${l.exception}, which SPDX License List ${listJson.licenseListVersion} does not list`); return; }
      resolved.push({ license: at, orLater: l.orLater, exception: l.exception ? license(l.exception, true) : -1 });
    }
    const text = canonical(tree);
    const conformsPolicy = text === listed(expectedId)?.licenseId;
    const conformsWebsite = ids.every((l) => codeIds.includes(listed(l.id).licenseId) && !l.exception && !l.orLater);
    const d = { index: declarations.length, repository: index, kind, source, expression: text, conformsPolicy, conformsWebsite, package: packageName };
    declarations.push(d);
    declared.push(d);
    for (const r of resolved) {
      declaredIds.push({ index: declaredIds.length, declaration: d.index, license: r.license, orLater: r.orLater });
      if (r.exception >= 0) declaredIds.push({ index: declaredIds.length, declaration: d.index, license: r.exception, orLater: false });
    }
    if (!conformsPolicy) claim(index, 'policy-mismatch', `${s.repository}:${source} declares ${text}; ${cite(governing)} sets ${expectedId}`);
    if (!conformsWebsite) claim(index, 'website-mismatch', `${s.repository}:${source} declares ${text}; ${cite(codeRule)} states the code is ${codeStatement.license}`);
  };
  for (const m of s.manifests) {
    if (m.unreadable) claim(index, 'expression-invalid', `${s.repository}:${m.path} is not readable as its format`);
    // A manifest with no license field declares nothing; the LICENSE files and REUSE information still govern.
    if (m.license) declare(m.kind, m.path, m.license, m.package);
    if (m.workspaceLicense) declare('cargo-workspace', `${m.path} [workspace.package]`, m.workspaceLicense);
    // A manifest under a directory named for another snapshotted repository is that repository's copy, not a
    // second publisher of its crate.
    const copy = m.path.split('/').slice(0, -1).some((seg) => seg !== s.repository && names.includes(seg));
    if (m.kind === 'cargo' && !copy && m.package && m.package.replace(/[-_]/g, ' ') === crateStatement.crate) crateHolders.push({ repository: index, manifest: m });
  }
  for (const f of s.licenseFiles) {
    if (f.id) declare('license-file', f.path, f.id);
    else if (f.identifiers.length) for (const e of f.identifiers) declare('spdx-identifier', f.path, e);
    else claim(index, 'license-text-unidentified', `${s.repository}:${f.path} (sha256:${f.sha256}) matches ${f.matched.length ? f.matched.join(', ') : 'no listed template'} by SPDX 2.3.1 Annex B; nearest ${f.candidates.join(', ') || 'none'}`);
  }
  if (s.licenseFiles.length === 0) claim(index, 'license-file-missing', `${s.repository} has no LICENSE, LICENCE or COPYING file at its root; ${cite(requiredRule)}`);
  if (declared.length === 0) claim(index, 'license-undeclared', `${s.repository} declares no license in any manifest or identified LICENSE text`);
  // The manifests state an expression; the LICENSE files only which texts are present. They agree when the
  // manifests state one expression whose licenses are exactly the identified texts.
  const stated = [...new Set(declared.filter((d) => d.kind !== 'license-file').map((d) => d.expression))].sort();
  const texts = [...new Set(declared.filter((d) => d.kind === 'license-file').map((d) => d.expression))].sort();
  const statedIds = [...new Set(stated.flatMap((e) => leaves(parseExpression(e)).map((l) => listed(l.id).licenseId)))].sort();
  // A stated license whose text is missing is a disagreement only when no LICENSE file is left unidentified,
  // since an unidentified file (claimed above) may be that text.
  const unidentified = s.licenseFiles.some((f) => !f.id && !f.identifiers.length);
  const disagree = stated.length === 1 && texts.length > 0
    && (texts.some((t) => !statedIds.includes(t)) || (!unidentified && statedIds.some((t) => !texts.includes(t))));
  if (stated.length > 1) claim(index, 'declarations-disagree', `${s.repository}: the manifests declare ${stated.join('; ')}`);
  else if (disagree) claim(index, 'declarations-disagree', `${s.repository}: the manifests declare ${stated[0]}; the LICENSE texts are ${texts.join(', ')}`);
  const expression = stated.length === 1 && !disagree ? stated[0] : stated.length === 0 && texts.length === 1 ? texts[0] : '';
  if (!ru.compliant) {
    claim(index, 'reuse-noncompliant', `${s.repository}@${s.commit}: reuse ${sources.reuse.version} finds ${ru.filesTotal - ru.filesWithCopyright} of ${ru.filesTotal} files without a copyright notice and ${ru.filesTotal - ru.filesWithLicense} without licensing information; ${ru.missingLicenses.length} missing, ${ru.badLicenses.length} bad, ${ru.deprecatedLicenses.length} deprecated, ${ru.unusedLicenses.length} unused licenses, ${ru.licensesWithoutExtension.length} without extension, ${ru.readErrors.length} read errors, ${ru.invalidExpressions.length} files with invalid expressions (REUSE 3.3)`);
  }
  drafts.push({ s, expression, governing, expectedId });
  return {
    index, name: s.repository, commit: s.commit,
    filesTotal: ru.filesTotal, filesWithCopyright: ru.filesWithCopyright, filesWithLicense: ru.filesWithLicense,
    missingLicenses: ru.missingLicenses.length, badLicenses: ru.badLicenses.length, deprecatedLicenses: ru.deprecatedLicenses.length,
    unusedLicenses: ru.unusedLicenses.length, licensesWithoutExtension: ru.licensesWithoutExtension.length, readErrors: ru.readErrors.length,
    invalidExpressions: ru.invalidExpressions.length, compliant: ru.compliant,
    licenseFiles: s.licenseFiles.length, identifiedFiles: s.licenseFiles.filter((f) => f.id || f.identifiers.length).length,
    expected, rule: governing, expression,
  };
});

// The website names one crate; the repository whose manifest publishes it must declare the license it states.
if (crateHolders.length !== 1) policyClaims.push({ refusal: 'website-mismatch', detail: `${cite(crateRule)} names the crate ${crateStatement.crate}; ${crateHolders.length} snapshotted Cargo manifests publish a package by that name` });
else {
  const { repository, manifest } = crateHolders[0];
  const d = declarations.find((x) => x.repository === repository && x.source === manifest.path);
  const name = scan.json.repositories[repository].repository;
  const inherited = manifest.inherits ? declarations.find((x) => x.repository === repository && x.kind === 'cargo-workspace') : null;
  const got = (d ?? inherited)?.expression ?? '';
  if (got !== crateStatement.license) claim(repository, 'website-mismatch', `${name}:${manifest.path} publishes ${manifest.package} under ${got || 'no declared license'}; ${cite(crateRule)} states ${crateStatement.license}`);
}
refusals.sort((a, b) => a.repository - b.repository || (a.refusal < b.refusal ? -1 : a.refusal > b.refusal ? 1 : 0) || (a.detail < b.detail ? -1 : 1));

// ---- Drafts: the REUSE remediation of each repository, as data.
const q = (s) => (/^[A-Za-z0-9_./@%+=:,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const NOTICE = /^(?:copyright|\(c\)|©)(?:\s*(?:\(c\)|©))?\s*(\d{4}(?:\s*[-,]\s*\d{4})*)?\s*,?\s*(.*?)\.?\s*$/i;
function draft({ s, expression, governing, expectedId }) {
  const ru = s.reuse;
  const lines = [`# REUSE remediation draft: ${s.repository}`, '',
    'Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.', '',
    `- Repository: https://github.com/UOR-Foundation/${s.repository} at \`${s.commit}\``,
    `- Oracle: reuse ${sources.reuse.version} (REUSE Specification ${sources.reuse.specVersion}), SPDX License List ${listJson.licenseListVersion}`,
    `- Observed: ${ru.filesTotal} files, ${ru.filesWithCopyright} with copyright, ${ru.filesWithLicense} with licensing information; compliant: ${ru.compliant}`,
    ''];
  if (ru.compliant) { lines.push('The repository is REUSE compliant. No change is needed.', ''); return lines.join('\n'); }
  const open = [];
  const holders = [...new Map(s.licenseFiles.flatMap((f) => f.notices).map((n) => n.match(NOTICE)).filter((m) => m && m[2] && !/[<[]/.test(m[2])).map((m) => [m[2].replace(/\.?\s*All rights reserved\.?$/i, ''), m[1] ?? ''])).entries()];
  const expr = expression || '<EXPRESSION>';
  if (!expression) open.push('The license expression is not determined by the repository: its manifests and LICENSE texts are absent, unidentified or disagree (see the open claims in licensing/register.json). `<EXPRESSION>` stands for it until it is decided.');
  const copyright = holders.length ? holders.map(([h, y]) => `--copyright=${q(h)}${y ? ` --year=${q(y.replace(/\s+/g, ''))}` : ''}`) : ['--copyright=\'<COPYRIGHT HOLDER>\''];
  if (!holders.length) open.push('No LICENSE file names a copyright holder. `<COPYRIGHT HOLDER>` stands for the holder until the Foundation names it.');
  if (holders.length > 1) open.push('The LICENSE files name more than one holder; each is passed, and `reuse annotate` takes one year for all of them.');
  lines.push('## License expression', '', expression ? `\`${expression}\`, as the repository declares it.` : 'Undetermined.', '');
  if (expression && expression !== listed(expectedId)?.licenseId) lines.push(`The policy (${rules[governing].document}, section ${rules[governing].section}) sets \`${expectedId}\`. REUSE compliance is drafted for the license the repository declares; changing that license is a separate decision of the owners.`, '');
  lines.push('## LICENSES/', '');
  const present = new Set(s.licensesDir.map((p) => p.replace(/^LICENSES\//, '').replace(/\.[^.]+$/, '')));
  const needed = expression ? leaves(parseExpression(expression)).flatMap((l) => [l.id, ...(l.exception ? [l.exception] : [])]) : [];
  const download = [...new Set([...needed, ...ru.missingLicenses])].filter((id) => !present.has(id)).sort();
  const remove = ru.unusedLicenses.filter((id) => !needed.includes(id) && !ru.usedLicenses.includes(id));
  const steps = [];
  for (const id of download) steps.push(`reuse download ${q(id)}`);
  for (const id of remove) steps.push(`git rm ${q(s.licensesDir.find((p) => p.replace(/^LICENSES\//, '').replace(/\.[^.]+$/, '') === id) ?? `LICENSES/${id}.txt`)}`);
  for (const id of ru.licensesWithoutExtension) steps.push(`git mv ${q(`LICENSES/${id}`)} ${q(`LICENSES/${id}.txt`)}`);
  lines.push(steps.length ? ['```sh', ...steps, '```'].join('\n') : 'No change.', '');
  for (const id of ru.badLicenses) open.push(`\`${id}\` is a bad license (neither on the SPDX License List nor a LicenseRef-); its file or header must be renamed to an SPDX identifier or LicenseRef- by hand.`);
  for (const id of ru.deprecatedLicenses) open.push(`\`${id}\` is a deprecated SPDX identifier; replace it with its current identifier in LICENSES/ and in every header.`);
  for (const p of ru.readErrors) open.push(`\`${p}\` could not be read by the tool.`);
  for (const p of ru.invalidExpressions) open.push(`\`${p}\` carries an invalid SPDX License Expression that must be corrected by hand.`);
  lines.push('## Annotations', '', 'Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.', '');
  if (ru.missingBoth) {
    // --recursive reaches the same Covered Files lint does (Project.all_files), and --skip-existing passes over
    // every file that already carries any REUSE information, so this reaches exactly the files with neither.
    lines.push(`### ${ru.missingBoth} files without a copyright notice or licensing information`, '', '```sh',
      `reuse annotate ${[...copyright, `--license=${q(expr)}`].join(' ')} --fallback-dot-license --skip-existing --skip-global --recursive .`, '```', '');
  }
  const groups = [
    ['with a copyright notice but no licensing information', ru.missingLicensingOnly, [`--license=${q(expr)}`]],
    ['with licensing information but no copyright notice', ru.missingCopyrightOnly, copyright],
  ];
  for (const [what, files, flags] of groups) {
    if (!files.length) continue;
    lines.push(`### ${files.length} files ${what}`, '', '```sh');
    for (let i = 0; i < files.length; i += 25) lines.push(`reuse annotate ${flags.join(' ')} --fallback-dot-license -- ${files.slice(i, i + 25).map(q).join(' ')}`);
    lines.push('```', '');
  }
  lines.push('## Check', '', '```sh', 'reuse lint', '```', '');
  if (open.length) lines.push('## Open', '', ...open.map((o) => `- ${o}`), '');
  return lines.join('\n');
}

const register = {
  spec: 'uor-community/licensing-register/1',
  standards: [
    `REUSE Specification ${sources.reuseSpec.version} (${sources.reuseSpec.url}, sha256:${sources.reuseSpec.sha256})`,
    `SPDX License List ${listJson.licenseListVersion} (${sources.spdx.url}@${sources.spdx.commit})`,
    `SPDX Specification 2.3.1 Annex B, license matching guidelines (${sources.matching.url}, sha256:${sources.matching.sha256})`,
    `SPDX Specification 2.3.1 Annex D, license expressions (${sources.expressions.url})`,
  ],
  tools: { reuse: { version: sources.reuse.version, wheel: sources.reuse.wheel, sha256: sources.reuse.sha256, lint: sources.reuse.lintVersion, spec: sources.reuse.specVersion } },
  spdx: { version: listJson.licenseListVersion, tag: sources.spdx.tag, commit: sources.spdx.commit, licensesSha256: licensesFile.sha256, exceptionsSha256: exceptionsFile.sha256 },
  inputs: [snapshot, scan, eco].map(({ path, sha256: d }) => ({ path, sha256: d })),
  sources: [governance, contributing, standards, wordsFile, ...statements.map((s) => s.file)].map(({ ref, sha256: d }) => ({ ref, sha256: d })),
  policy: { default: defaultLicense, exceptions, inbound: inbound[1], licenseRequired: true, dcoRule, claRule, crate: { name: crateStatement.crate, license: crateStatement.license }, code: codeStatement.license },
  rules,
  licenses,
  repositories,
  declarations,
  declaredIds,
  refusals,
  policyClaims,
};
const outputs = [[join(here, 'register.json'), `${JSON.stringify(register, null, 1)}\n`]];
for (const d of drafts) outputs.push([join(here, 'drafts', `${d.s.repository}.md`), draft(d)]);
const draftNames = new Set(drafts.map((d) => `${d.s.repository}.md`));
let stale = false;
if (flag === '--check') {
  for (const [target, text] of outputs) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`${target} is not the projection of its pinned sources\n`); stale = true; }
  }
  for (const f of existsSync(join(here, 'drafts')) ? readdirSync(join(here, 'drafts')) : []) if (!draftNames.has(f)) { process.stderr.write(`licensing/drafts/${f} is no repository's draft\n`); stale = true; }
} else {
  mkdirSync(join(here, 'drafts'), { recursive: true });
  for (const f of readdirSync(join(here, 'drafts'))) if (!draftNames.has(f)) rmSync(join(here, 'drafts', f));
  for (const [target, text] of outputs) writeFileSync(target, text);
}
if (stale) process.exit(1);
process.stdout.write(`${repositories.length} repositories, ${repositories.filter((r) => r.compliant).length} REUSE compliant, ${declarations.length} declarations, ${refusals.length + policyClaims.length} open claims\n`);
