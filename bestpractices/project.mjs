#!/usr/bin/env node
/**
 * Project the Best Practices register, Foundation.BestPractices.V1: every
 * criterion of the OpenSSF Best Practices badge (passing, silver and gold, as
 * bestpractices/criteria.json reads them from the badge project at the pinned
 * commit) against every public Foundation repository, with exactly one
 * outcome each: Met, Unmet, N/A or unknown.
 *
 * An outcome other than unknown is given only by the badge application's own
 * detectives (bestpractices/detectives.mjs), applied to what they read of the
 * repository (bestpractices/snapshot.json) and merged as Chief.merge_changeset
 * merges them; each cites the detective file and line it rests on, found in
 * the pinned checkout. Every other criterion is unknown: Met, Unmet and N/A
 * there are answered by a person in the badge application, not here. A MUST
 * criterion Unmet or unknown is an open claim; N/A is recorded only where the
 * criterion allows it. A criterion of the badge's Security group is owned by
 * the security facet, and its outcome is recorded beside the owner's register.
 *
 * A fact the detectives would read but the snapshot cannot attest at the
 * pinned commit is a typed refusal: the license GitHub states for a default
 * branch that has moved past the pinned commit, response headers the snapshot
 * could not read, and a file in which the project declares its own answers.
 *
 * <sources-dir> holds best-practices-badge and community-security checked out
 * at the commits bestpractices/sources.json pins (oracles/reproject.mjs fetches
 * them there).
 *
 *   node bestpractices/project.mjs <sources-dir> [--check]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATTERNS, ANCHORS, SELF_DECLARED_ANCHORS, osiLicenses, detect, merge } from './detectives.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const [dir, flag] = process.argv.slice(2);
if (!dir) {
  process.stderr.write('usage: project.mjs <sources-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const bytesOf = (p) => readFileSync(join(root, p));
const json = (p) => JSON.parse(bytesOf(p).toString('utf8'));
const sources = json('bestpractices/sources.json');
const badge = sources.badge;
const checkout = join(dir, badge.name);
const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== badge.commit) throw new Error(`the badge checkout is at ${head}, not the pinned ${badge.commit}`);
const pinned = (path) => {
  const bytes = readFileSync(join(checkout, path));
  return { path, sha256: sha256(bytes), text: bytes.toString('utf8') };
};
const criteriaDoc = json('bestpractices/criteria.json');
for (const f of criteriaDoc.source.files) {
  if (pinned(f.path).sha256 !== f.sha256) throw new Error(`bestpractices/criteria.json was read from another ${f.path}; re-run criteria.py`);
}
const snapshot = json('bestpractices/snapshot.json');
const licensing = json('licensing/register.json');
const ecosystem = json('ecosystem/register.json');

// ---- The detectives at the pinned commit: every excerpt a rule rests on, found and cited by line.
const files = new Map([badge.chief, ...badge.detectives].map((p) => [p, pinned(p)]));
const cite = (file, excerpt) => {
  const f = files.get(file);
  if (!f) throw new Error(`${file} is not a pinned detective file`);
  const at = f.text.indexOf(excerpt);
  if (at < 0) throw new Error(`${file}@${badge.commit} no longer contains ${JSON.stringify(excerpt)}`);
  return `${file}:${f.text.slice(0, at).split('\n').length}`;
};
for (const p of Object.values(PATTERNS)) cite(p.file, p.source);
for (const [file, excerpt] of [...ANCHORS, ...SELF_DECLARED_ANCHORS]) cite(file, excerpt);
const osi = osiLicenses(files.get('app/lib/floss_license_detective.rb').text);
// The line each detective's result for a field is set on.
const RESULT_LINES = {
  github_basic: (field) => ['app/lib/github_basic_detective.rb', `results[:${field}_status] = {`],
  floss_license: (field, value) => ['app/lib/floss_license_detective.rb', value === 'Unmet' ? 'elsif license.match?(/\A[^(]/)' : field === 'floss_license_osi' ? 'floss_license_osi_status:' : '        floss_license_status:'],
  repo_files_examine: (field) => ['app/lib/repo_files_examine_detective.rb', `:${field}_status,`],
  build: (field) => ['app/lib/build_detective.rb', field === 'build' ? ':build_status,' : '@results[:build_common_tools_status] = @results[:build_status]'],
  subdir_file_contents: () => ['app/lib/subdir_file_contents_detective.rb', 'repo_files, :documentation_basics_status, DOCS_BASICS,'],
  project_sites_https: (field, value) => ['app/lib/project_sites_https_detective.rb', value === 'Met' ? 'def set_https_results' : 'def set_http_results'],
  hardened_sites: () => ['app/lib/hardened_sites_detective.rb', 'results[:hardened_site_status] ='],
};
const DETECTIVES = Object.keys(RESULT_LINES);

// ---- The security facet's register at its pinned commit: a criterion it names by id is decided there.
const securityDir = join(dir, sources.security.name);
const securityAt = execFileSync('git', ['-C', securityDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (securityAt !== sources.security.commit) throw new Error(`${securityDir} is at ${securityAt}, not the pinned ${sources.security.commit}`);
const securityText = readFileSync(join(securityDir, sources.security.register), 'utf8');

// ---- Criteria, in the order criteria.yml lists them.
const criteria = criteriaDoc.criteria.map((c, index) => ({
  index,
  id: c.id,
  level: c.level,
  major: c.major,
  minor: c.minor,
  category: c.category,
  naAllowed: c.na_allowed,
  metUrlRequired: c.met_url_required,
  future: c.future,
  obsolete: c.obsolete,
  owner: c.major === sources.security.major ? 'security' : 'bestpractices',
  securityDecides: c.major === sources.security.major && new RegExp(`"${c.id}"`).test(securityText),
  descriptionSha256: c.descriptionSha256,
}));

// ---- Repositories: the detectives' results, merged, and the refusals.
const licensingByName = new Map(licensing.repositories.map((r) => [r.name, r]));
const ecosystemByName = new Map(ecosystem.repositories.map((r) => [r.name, r]));
const refusals = [];
const outcomes = [];
const repositories = snapshot.repositories.map((facts, index) => {
  const lic = licensingByName.get(facts.name);
  if (!lic || lic.commit !== facts.commit) throw new Error(`${facts.name}: the snapshot is not at the licensing register's commit`);
  const licenseCurrent = facts.headNow === facts.commit;
  const usable = { ...facts };
  if (!licenseCurrent) {
    usable.licenseSpdx = '';
    refusals.push({ repository: index, refusal: 'licenseAtLaterHead', detail: `${facts.name}: GitHub states the license of the default branch at ${facts.headNow}, not of the pinned ${facts.commit}; floss_license and floss_license_osi stay unknown` });
  }
  const unreadable = facts.headers.filter((h) => h.status !== 200);
  if (unreadable.length) refusals.push({ repository: index, refusal: 'headersUnreadable', detail: `${facts.name}: ${unreadable.map((h) => `${h.url} answered HTTP ${h.status}`).join('; ')}; hardened_site stays unknown` });
  if (facts.selfDeclared.length) refusals.push({ repository: index, refusal: 'selfDeclaredFile', detail: `${facts.name}: ${facts.selfDeclared.join(', ')} declares the project's own answers, which the register does not restate` });
  const results = detect(usable, osi).filter((r) => !(r.field === 'hardened_site' && unreadable.length));
  const merged = merge(results);
  const counts = { met: 0, unmet: 0, na: 0, unknown: 0, open: 0, openPassing: 0, openSilver: 0, openGold: 0 };
  for (const c of criteria) {
    const r = merged.get(c.id);
    const status = r ? (r.value === 'Met' ? 'met' : 'unmet') : 'unknown';
    const open = c.category === 'MUST' && (status === 'unmet' || status === 'unknown');
    counts[status] += 1;
    if (open) {
      counts.open += 1;
      counts[`open${c.level[0].toUpperCase()}${c.level.slice(1)}`] += 1;
    }
    const [file, excerpt] = r ? RESULT_LINES[r.detective](r.field, r.value) : [];
    let evidence = r ? r.evidence : '';
    if (r && c.id === 'floss_license' && lic.expression && lic.expression !== usable.licenseSpdx) evidence += `; the licensing register identifies ${lic.expression} at ${facts.commit}`;
    if (r && c.id === 'release_notes') evidence += `; ${ecosystemByName.get(facts.name)?.tags ?? 0} release tags in the ecosystem register`;
    outcomes.push({
      index: outcomes.length,
      repository: index,
      criterion: c.index,
      status,
      detective: r ? r.detective : 'none',
      cite: r ? `${badge.url}@${badge.commit}:${cite(file, excerpt)}` : '',
      confidence: r ? r.confidence : 0,
      forced: r ? r.confidence >= 4 : false,
      open,
      evidence,
    });
  }
  return {
    index,
    name: facts.name,
    commit: facts.commit,
    licenseSpdx: facts.licenseSpdx,
    licenseCurrent,
    licensingExpression: lic.expression,
    homepage: facts.homepage,
    ...counts,
  };
});

// ---- The badge search: an entry found for any repository would be the badge application's own answer.
const badgeQueries = snapshot.badgeSearch.map((q, index) => ({ index, query: q.query, status: q.status, found: q.projects.length }));

const levels = ['passing', 'silver', 'gold'];
const counts = {
  criteria: criteria.length,
  byLevel: Object.fromEntries(levels.map((l) => [l, Object.fromEntries(['MUST', 'SHOULD', 'SUGGESTED'].map((k) => [k, criteria.filter((c) => c.level === l && c.category === k).length]))])),
  repositories: repositories.length,
  outcomes: outcomes.length,
  byStatus: Object.fromEntries(['met', 'unmet', 'na', 'unknown'].map((s) => [s, outcomes.filter((o) => o.status === s).length])),
  open: outcomes.filter((o) => o.open).length,
  // A level is MUST-clear for a repository when every MUST criterion of it is Met or N/A; the badge also needs
  // every SHOULD and SUGGESTED answered, which only the badge application records.
  mustClear: Object.fromEntries(levels.map((l) => [l, repositories.filter((r) => r[`open${l[0].toUpperCase()}${l.slice(1)}`] === 0).length])),
  metByLevel: Object.fromEntries(levels.map((l) => [l, outcomes.filter((o) => o.status === 'met' && criteria[o.criterion].level === l).length])),
  badgeEntries: badgeQueries.reduce((n, q) => n + q.found, 0),
  refusals: refusals.length,
};
const register = {
  spec: 'uor-community/bestpractices-register/1',
  about: 'The OpenSSF Best Practices badge criteria (passing, silver, gold) against every public UOR Foundation repository, projected by bestpractices/project.mjs. Every criterion has exactly one outcome per repository; an outcome other than unknown is the badge application\'s own detective result at the pinned commit, cited by file and line; a MUST criterion Unmet or unknown is an open claim.',
  standard: `OpenSSF Best Practices badge criteria, passing, silver and gold (${badge.url}@${badge.commit}:${badge.criteria})`,
  standards: [`OpenSSF Best Practices Badge criteria (${badge.url}@${badge.commit}:${badge.criteria}, sha256:${criteriaDoc.source.files[0].sha256})`],
  tools: { PyYAML: { version: criteriaDoc.parser.version, loader: criteriaDoc.parser.loader, wheel: 'pyyaml-6.0.3-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl', sha256: '0f29edc409a6392443abf94b9cf89ce99889a1dd5376d94316ae5145dfedd5d6' } },
  badge: {
    repository: badge.url,
    commit: badge.commit,
    files: [...criteriaDoc.source.files, ...[...files.values()].map(({ path, sha256: digest }) => ({ path, sha256: digest }))],
    osiLicenses: osi.length,
  },
  security: { register: sources.security.register, branch: sources.security.branch, commit: sources.security.commit, sha256: sha256(securityText), owns: `the criteria of the badge's ${sources.security.major} group` },
  inputs: ['bestpractices/criteria.json', 'bestpractices/snapshot.json', 'bestpractices/sources.json', 'licensing/register.json', 'ecosystem/register.json'].map((path) => ({ path, sha256: sha256(bytesOf(path)) })),
  detectives: DETECTIVES,
  counts,
  criteria,
  repositories,
  outcomes,
  badgeQueries,
  refusals,
};
const text = `${JSON.stringify(register, null, 1)}\n`;
const target = join(here, 'register.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
    process.stderr.write('bestpractices/register.json is not the projection of its pinned sources\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
process.stdout.write(`${counts.criteria} criteria x ${counts.repositories} repositories = ${counts.outcomes} outcomes: ${JSON.stringify(counts.byStatus)}, ${counts.open} open MUST, MUST-clear ${JSON.stringify(counts.mustClear)}, ${counts.badgeEntries} badge entries, ${counts.refusals} refusals\n`);
