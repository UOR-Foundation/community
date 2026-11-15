#!/usr/bin/env node
/**
 * Observe every repository of licensing/snapshot.json at its pinned default-branch
 * commit: the last 200 commits (author, co-authors and message), CHANGELOG.md,
 * the version of every package manifest supply/register.json names there, and
 * the commit date of every tag ecosystem/snapshot.json holds. Each observation
 * is run through the pinned oracles as it is read:
 *
 *   semver 7.8.5                          valid() on every candidate version, sort() of every tag series;
 *   conventional-commits-parser 7.1.3     with the conventional-changelog-conventionalcommits preset parser
 *                                         options that @commitlint/config-conventional names;
 *   @commitlint/lint 21.2.4 with @commitlint/config-conventional 21.2.4, unmodified, and with the Foundation's
 *                                         own profile (CONTRIBUTING.md "Commit Message Standard") over it;
 *   keep-a-changelog 3.2.0                parser() on every CHANGELOG.md.
 *
 * Repositories are fetched one at a time (git fetch --depth 200 --filter=blob:none, so only the blobs read are
 * downloaded) and removed after use. Nothing is written anywhere but conventions/scan.json.
 *
 *   ORACLES=<dir with node_modules from conventions/oracles> node conventions/scan.mjs <work-dir> <sources-dir> [--check]
 *
 * <sources-dir> holds dotgithub, semver.org, conventionalcommits.org and keep-a-changelog at the commits
 * conventions/sources.json pins. --check re-observes and compares; a moved head is stale, not wrong.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readNorms } from './norms.mjs';
import { ccMessage, classifyTag } from './grammar.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const [work, sourcesDir, flag] = process.argv.slice(2);
const oracleDir = process.env.ORACLES;
if (!work || !sourcesDir || !oracleDir) {
  process.stderr.write('usage: ORACLES=<dir> scan.mjs <work-dir> <sources-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const local = (p) => { const bytes = readFileSync(join(root, p)); return { path: p, sha256: sha256(bytes), json: JSON.parse(bytes.toString('utf8')) }; };
const pins = local(sources.inputs.repositories);
const eco = local(sources.inputs.tags);
const supply = local(sources.inputs.packages);
const agents = local(sources.inputs.agents);
const lock = local(sources.inputs.oracleLock);
const norms = readNorms(sourcesDir, sources);

// ---- The oracles, held to the lock: every installed package is the version and the lock entry it records.
const tools = [];
for (const [key, entry] of Object.entries(lock.json.packages)) {
  if (!key) continue;
  const installed = JSON.parse(readFileSync(join(oracleDir, key, 'package.json'), 'utf8'));
  if (installed.version !== entry.version) throw new Error(`${key} is ${installed.version}; the lock pins ${entry.version}`);
  if (!key.slice('node_modules/'.length).includes('node_modules/')) tools.push({ name: key.slice('node_modules/'.length), version: entry.version, integrity: entry.integrity });
}
const mod = (p) => import(pathToFileURL(join(oracleDir, 'node_modules', p)).href);
const semver = (await mod('semver/index.js')).default;
const { CommitParser } = await mod('conventional-commits-parser/dist/index.js');
const createPreset = (await mod('conventional-changelog-conventionalcommits/src/index.js')).default;
const lint = (await mod('@commitlint/lint/lib/lint.js')).default;
const isIgnored = (await mod('@commitlint/is-ignored/lib/is-ignored.js')).default;
const conventional = (await mod('@commitlint/config-conventional/lib/index.js')).default;
const { parser: kacOracle } = await mod('keep-a-changelog/mod.js');
const preset = createPreset();
const parser = new CommitParser(preset.parser);
const profileRules = { ...conventional.rules, ...norms.profile.rules };

// ---- PROV-O: a commit is attributed to a software agent when its author or a Co-authored-by trailer names one.
const agentByEmail = new Map(agents.json.agents.map((a) => [a.email.toLowerCase(), a.name]));
const agentOf = (name, email) => agentByEmail.get(email.toLowerCase()) ?? (/\[bot\]/.test(name) || /\[bot\]@users\.noreply\.github\.com$/i.test(email) ? name : '');

const git = (dir, args, opts = {}) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const lintResult = (r) => ({ valid: r.valid, errors: r.errors.map((e) => e.name).sort(), warnings: r.warnings.map((e) => e.name).sort() });

function readVersion(dir, commit, path, ecosystem) {
  const text = git(dir, ['show', `${commit}:${path}`]);
  if (ecosystem === 'npm') { const v = JSON.parse(text).version; return { version: v ?? '', from: v === undefined ? 'absent' : 'package.json version' }; }
  let table = '';
  let version = null;
  let workspace = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const header = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/);
    if (header) { table = header[1].replace(/["'\s]/g, ''); continue; }
    const want = ecosystem === 'cargo' ? ['package'] : ['project', 'tool.poetry'];
    if (!want.includes(table)) continue;
    const m = line.match(/^\s*version\s*=\s*"([^"]*)"/);
    if (m && version === null) version = m[1];
    if (/^\s*version(\.workspace\s*=\s*true|\s*=\s*\{\s*workspace\s*=\s*true\s*\})/.test(line)) workspace = true;
    if (ecosystem === 'pypi' && /^\s*dynamic\s*=.*"version"/.test(line) && version === null) version = '';
  }
  if (workspace) {
    // The Cargo Book, "The [workspace.package] table": version.workspace = true inherits the nearest workspace root's.
    for (let d = posix.dirname(posix.dirname(path) === '.' ? '' : posix.dirname(path)); ; d = posix.dirname(d)) {
      const candidate = d === '.' || d === '' ? 'Cargo.toml' : `${d}/Cargo.toml`;
      let t = '';
      try { t = git(dir, ['show', `${commit}:${candidate}`]); } catch { t = ''; }
      let tb = '';
      for (const line of t.split('\n')) {
        const h = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?/);
        if (h) { tb = h[1].replace(/["'\s]/g, ''); continue; }
        const m = tb === 'workspace.package' && line.match(/^\s*version\s*=\s*"([^"]*)"/);
        if (m) return { version: m[1], from: `${candidate} [workspace.package]` };
      }
      if (d === '.' || d === '') break;
    }
    return { version: '', from: 'version.workspace without a workspace version' };
  }
  if (version === null) return { version: '', from: 'absent' };
  return { version, from: version === '' ? 'dynamic' : `${ecosystem === 'cargo' ? '[package]' : '[project]'} version` };
}

const names = eco.json.repositories.map((r) => r.name);
if (pins.json.repositories.map((r) => r.repository).join() !== names.join()) throw new Error(`${pins.path} does not pin the ecosystem repositories in order`);
mkdirSync(work, { recursive: true });
const repositories = [];
for (const pin of pins.json.repositories) {
  const dir = join(work, pin.repository);
  rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['init', '-q', '--bare', dir]);
  git(dir, ['fetch', '-q', '--depth', String(sources.depth), '--filter=blob:none', pin.url, pin.commit]);
  // git log in commit-date order from the pinned head: the latest 200 commits reachable on the default branch.
  const raw = git(dir, ['log', '-n', String(sources.depth), '--format=%H%x1f%an%x1f%ae%x1f%B%x1e', pin.commit]);
  const commits = [];
  for (const rec of raw.split('\x1e').map((s) => s.replace(/^\n/, '')).filter(Boolean)) {
    const [sha, an, ae, message] = rec.split('\x1f');
    const coauthors = [...message.matchAll(/^Co-authored-by:\s*(.*?)\s*<([^>]+)>\s*$/gim)].map((m) => agentOf(m[1], m[2])).filter(Boolean);
    const agent = agentOf(an, ae) || coauthors[0] || '';
    const parsed = parser.parse(message);
    commits.push({
      sha,
      header: message.split('\n')[0],
      agent,
      body: { lines: message.replace(/\n+$/, '').split('\n').length, ...ccMessage(message) },
      parser: { type: parsed.type ?? '', scope: parsed.scope ?? '', subject: parsed.subject ?? '', breaking: parsed.notes.some((n) => /BREAKING/.test(n.title)) || /!:/.test(parsed.header ?? '') },
      conventional: lintResult(await lint(message, conventional.rules, { parserOpts: preset.parser, defaultIgnores: true })),
      ignored: isIgnored(message, { defaults: true }),
      profile: lintResult(await lint(message, profileRules, { parserOpts: preset.parser, defaultIgnores: true })),
    });
  }
  for (const c of commits) { c.violations = c.body.violations; c.description = c.body.description; c.type = c.body.type; c.scope = c.body.scope; c.breaking = c.body.breaking; c.lines = c.body.lines; delete c.body; }
  const files = git(dir, ['ls-tree', '-r', '--name-only', pin.commit]).split('\n').filter(Boolean);
  const changelogs = files.filter((f) => /(^|\/)CHANGELOG\.md$/.test(f)).sort();
  const nearMisses = files.filter((f) => !f.includes('/') && /^(changelog|changes|history|news|releases)(\.[a-z]+)?$/i.test(f) && f !== 'CHANGELOG.md').sort();
  let changelog = null;
  if (files.includes('CHANGELOG.md')) {
    const text = git(dir, ['show', `${pin.commit}:CHANGELOG.md`]);
    let oracle;
    try {
      const cl = kacOracle(text);
      oracle = { parsed: true, error: '', releases: cl.releases.map((r) => ({ version: r.version ? r.version.toString() : '', date: r.date ? r.date.toISOString().slice(0, 10) : '', yanked: Boolean(r.yanked), types: [...r.changes.entries()].filter(([, v]) => v.length).map(([k]) => k) })) };
    } catch (e) { oracle = { parsed: false, error: String(e.message).split('\n')[0], releases: [] }; }
    changelog = { sha256: sha256(Buffer.from(text, 'utf8')), text, oracle };
  }
  const manifests = [];
  for (const p of supply.json.packages.filter((x) => x.repository === pin.repository)) {
    const path = p.evidence.replace(/:\d+$/, '');
    const v = readVersion(dir, pin.commit, path, p.ecosystem);
    manifests.push({ package: p.name, ecosystem: p.ecosystem, path, private: p.private, ...v, oracle: v.version === '' ? null : semver.valid(v.version) });
  }
  const ecoTags = eco.json.repositories.find((r) => r.name === pin.repository).tags;
  const tagCommits = [...new Set(ecoTags.map((t) => t.commit))];
  const dates = new Map();
  if (tagCommits.length) {
    const tagDir = `${dir}-tags`;
    rmSync(tagDir, { recursive: true, force: true });
    execFileSync('git', ['init', '-q', '--bare', tagDir]);
    git(tagDir, ['fetch', '-q', '--depth', '1', '--filter=tree:0', pin.url, ...tagCommits]);
    for (const c of tagCommits) dates.set(c, git(tagDir, ['log', '-1', '--format=%cI', c]).trim());
    rmSync(tagDir, { recursive: true, force: true });
  }
  const tags = ecoTags.map((t) => {
    const suffixes = [];
    for (let i = t.name.indexOf('-'); i > 0; i = t.name.indexOf('-', i + 1)) suffixes.push(semver.valid(t.name.slice(i + 1)));
    return { name: t.name, commit: t.commit, date: dates.get(t.commit) ?? '', oracle: { tag: semver.valid(t.name), suffixes } };
  });
  repositories.push({ repository: pin.repository, url: pin.url, commit: pin.commit, commits, changelogs, nearMisses, changelog, manifests, tags });
  rmSync(dir, { recursive: true, force: true });
  process.stderr.write(`${pin.repository}: ${commits.length} commits, ${tags.length} tags, ${changelog ? 'CHANGELOG.md' : 'no CHANGELOG.md'}\n`);
}

// The oracle's own precedence of every set of versions the projector compares: each series of tags, and each
// changelog's release headings. Computed here so the projector needs no oracle to check its comparator.
const sorted = (versions) => [...versions].sort(semver.compare);
const scan = {
  spec: 'uor-community/conventions-scan/1',
  inputs: [pins, eco, supply, agents, lock].map(({ path, sha256: s }) => ({ path, sha256: s })),
  tools,
  depth: sources.depth,
  repositories: repositories.map((r) => ({ ...r, oracleOrder: { tags: sorted(r.tags.map((t) => classifyTag(norms.semver.regex, t.name).version).filter(Boolean)), changelog: r.changelog ? sorted(r.changelog.oracle.releases.map((x) => x.version).filter((v) => semver.valid(v) === v)) : [] } })),
};
const text = `${JSON.stringify(scan, null, 1)}\n`;
const target = join(here, 'scan.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write('conventions/scan.json is not what the pinned commits and oracles observe now\n'); process.exit(1); }
} else writeFileSync(target, text);
process.stdout.write(`${repositories.length} repositories observed\n`);
