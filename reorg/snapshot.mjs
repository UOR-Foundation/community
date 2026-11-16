#!/usr/bin/env node
/**
 * Snapshot the evidence the reorganization decides from into reorg/snapshot.json.
 *
 * The repository set is ecosystem/snapshot.json (its archival flag and primary
 * language are read from there). Each repository is cloned anonymously and read
 * from git at its default-branch head: the README's purpose statement (its first
 * paragraph), the last commit date, the commits in the window before the
 * snapshot time, the top-level layout, the package names its manifests declare,
 * every reference to another Foundation repository, and every supersession or
 * deprecation statement in its README. A reference is {from, to, kind, evidence}
 * with evidence {file, line, text, occurrences}, the schema the supply-chain
 * graph uses, so the two can be reconciled. Kinds: git-url (a URL in any tracked
 * file other than a README), readme-link, submodule, workflow (a `uses:` of
 * another Foundation repository), crate / npm / pypi (a dependency on a package
 * whose manifest is in another Foundation repository).
 *
 *   node reorg/snapshot.mjs <clones-dir>          fetch the heads and write the snapshot
 *   node reorg/snapshot.mjs <clones-dir> --check  re-derive at the recorded commits and time
 *
 * Only public repositories are read, and nothing is written to any of them.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: snapshot.mjs <clones-dir> [--check]\n');
  process.exit(64);
}
const target = join(here, 'snapshot.json');
const setBytes = readFileSync(join(here, '..', sources.repositories.set));
const set = JSON.parse(setBytes.toString('utf8')).repositories;
const previous = flag === '--check' ? JSON.parse(readFileSync(target, 'utf8')) : null;
// Anonymous: no credential helper, no prompt, so only what the public may read is read.
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
const gitIn = (dir, ...args) =>
  execFileSync('git', ['-c', 'credential.helper=', '-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, env });
const gitOk = (dir, ...args) => {
  try { return gitIn(dir, ...args); } catch (e) { if (e.status === 1) return ''; throw e; }
};
const url = (name) => sources.repositories.url.replace('{name}', name);
const asOf = previous ? previous.asOf : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const since = Math.floor(Date.parse(asOf) / 1000) - sources.window.days * 86400;
const until = Math.floor(Date.parse(asOf) / 1000);
const lower = new Map(set.map((r) => [r.name.toLowerCase(), r.name]));
const clip = (s) => (s.length > 240 ? `${s.slice(0, 237)}...` : s);
const README = /^readme(\.(md|markdown|rst|txt|org|adoc))?$/i;

mkdirSync(root, { recursive: true });
const checkouts = set.map((r) => {
  const dir = join(root, r.name);
  let commit;
  let branch;
  if (previous) {
    const p = previous.repositories.find((x) => x.name === r.name);
    if (!p) throw new Error(`${r.name} is not in the recorded snapshot`);
    ({ commit, defaultBranch: branch } = p);
  } else {
    const head = gitIn(root, 'ls-remote', '--symref', url(r.name), 'HEAD');
    branch = head.match(/^ref: refs\/heads\/(\S+)\tHEAD$/m)[1];
    commit = head.match(/^([0-9a-f]{40})\tHEAD$/m)[1];
  }
  if (!existsSync(join(dir, '.git'))) gitIn(root, 'clone', '-q', '--filter=blob:none', '--no-checkout', url(r.name), dir);
  if (!gitOk(dir, 'cat-file', '-t', commit).trim()) gitIn(dir, 'fetch', '-q', 'origin', commit);
  // A full checkout fetches the head's blobs in one batch; everything after reads git objects at the commit, so
  // the working tree is then reduced to nothing, one repository at a time, to keep the clones small.
  gitIn(dir, 'sparse-checkout', 'disable');
  gitIn(dir, 'checkout', '-q', '--detach', commit);
  gitIn(dir, 'sparse-checkout', 'set', '--no-cone', '/.gitmodules');
  return { r, dir, commit, branch };
});

const show = (c, path) => gitIn(c.dir, 'show', `${c.commit}:${path}`);
const lines = (text) => text.replace(/\r\n/g, '\n').split('\n');

// The README as paragraphs: runs of non-blank lines outside code fences, each with the line it starts on.
function paragraphs(c, file) {
  const all = lines(show(c, file));
  const out = [];
  let i = all[0] === '---' ? all.indexOf('---', 1) + 1 : 0;
  let fence = false;
  let run = null;
  for (; i <= all.length; i++) {
    const t = i < all.length ? all[i].trim() : '';
    if (t.startsWith('```')) { fence = !fence; if (run) { out.push(run); run = null; } continue; }
    if (fence) continue;
    if (!t) { if (run) out.push(run); run = null; continue; }
    if (!run) run = { line: i + 1, lines: [] };
    run.lines.push(t);
  }
  return out;
}
const prose = (s) => s
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
  .replace(/[*_`]/g, '')
  .replace(/\s+/g, ' ').trim();

// The purpose statement: the README's first paragraph of prose, so not a heading, badge, image, HTML block,
// rule, table or link definition. A block quote is prose with its markers removed. A README with no prose has
// no purpose statement, and its first heading is kept as its title.
function purpose(c, file) {
  if (!file) return { file: '', line: 0, text: '', source: '', title: '' };
  const ps = paragraphs(c, file);
  const heading = ps.flatMap((p) => p.lines).find((l) => /^#/.test(l));
  const title = heading ? prose(heading.replace(/^#+\s*/, '')) : '';
  for (const p of ps) {
    const lead = p.lines.findIndex((l) => !/^#/.test(l));
    if (lead < 0) continue;
    const first = p.lines[lead];
    if (/^(=+$|-+$|\*{3,}$|_{3,}$|\||<|!\[|\[!\[|\.\. |:)/.test(first) || /^\[[^\]]+\]:/.test(first)) continue;
    const body = p.lines.slice(lead).filter((l) => !/^#/.test(l)).map((l) => l.replace(/^>\s?/, '')).join(' ');
    const text = prose(body);
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length > 0) {
      const source = p.lines.slice(lead).join('\n');
      return { file, line: p.line + lead, text: text.length > 600 ? `${text.slice(0, 597)}...` : text, source: source.length > 1200 ? `${source.slice(0, 1197)}...` : source, title };
    }
  }
  return { file, line: 0, text: '', source: '', title };
}

// Manifest package names and their dependencies, by ecosystem.
// Build output and installed dependencies are not the repository's own manifests; a vendored copy is, and its
// declared `repository` names where it came from.
const SKIP = /(^|\/)(node_modules|target|dist|\.lake)\//;
function manifests(c, files) {
  const packages = [];
  const deps = [];
  const workspaceRepo = new Map();
  for (const file of files) {
    if (SKIP.test(file)) continue;
    const base = posix.basename(file);
    if (base === 'Cargo.toml') {
      let table = '';
      lines(show(c, file)).forEach((l, n) => {
        const h = l.match(/^\s*\[([^\]]+)\]\s*$/);
        if (h) {
          table = h[1].trim();
          const dt = table.match(/^(?:target\..+\.)?(?:workspace\.)?(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)$/);
          if (dt) deps.push({ ecosystem: 'crate', name: dt[1], file, line: n + 1, text: l.trim() });
          return;
        }
        if (table === 'package') {
          const m = l.match(/^\s*name\s*=\s*"([^"]+)"/);
          if (m) packages.push({ ecosystem: 'crate', name: m[1], file, line: n + 1, declared: '', inherit: false });
          const r = l.match(/^\s*repository\s*=\s*"([^"]+)"/);
          const pkg = packages.findLast((x) => x.file === file);
          if (r && pkg) pkg.declared = r[1];
          if (/^\s*repository\.workspace\s*=\s*true/.test(l) && pkg) pkg.inherit = true;
        } else if (table === 'workspace.package') {
          const r = l.match(/^\s*repository\s*=\s*"([^"]+)"/);
          if (r) workspaceRepo.set(posix.dirname(file), r[1]);
        } else if (/^(?:target\..+\.)?(?:workspace\.)?(?:dev-|build-)?dependencies$/.test(table)) {
          const m = l.match(/^\s*([A-Za-z0-9_-]+)(?:\.workspace)?\s*=\s*(.*)$/);
          if (m) {
            const renamed = m[2].match(/package\s*=\s*"([^"]+)"/);
            deps.push({ ecosystem: 'crate', name: renamed ? renamed[1] : m[1], file, line: n + 1, text: l.trim() });
          }
        }
      });
    } else if (base === 'package.json') {
      const text = show(c, file);
      let json;
      try { json = JSON.parse(text); } catch { continue; }
      const ls = lines(text);
      const lineOf = (key) => ls.findIndex((l) => l.includes(`"${key}"`)) + 1;
      const declared = typeof json.repository === 'string' ? json.repository : (json.repository?.url ?? '');
      if (typeof json.name === 'string') packages.push({ ecosystem: 'npm', name: json.name, file, line: lineOf('name'), declared, inherit: false });
      for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(json[k] ?? {})) deps.push({ ecosystem: 'npm', name, file, line: lineOf(name), text: `"${name}": "${json[k][name]}"` });
      }
    } else if (base === 'pyproject.toml') {
      let table = '';
      let inDeps = false;
      lines(show(c, file)).forEach((l, n) => {
        const h = l.match(/^\s*\[([^\]]+)\]\s*$/);
        if (h) { table = h[1].trim(); inDeps = false; return; }
        if (table === 'project' || table === 'tool.poetry') {
          const m = l.match(/^\s*name\s*=\s*"([^"]+)"/);
          if (m) packages.push({ ecosystem: 'pypi', name: m[1], file, line: n + 1, declared: '', inherit: false });
        }
        if (table === 'project.urls') {
          const r = l.match(/^\s*"?(?:Repository|Source|source|repository)"?\s*=\s*"([^"]+)"/);
          const pkg = packages.findLast((x) => x.file === file);
          if (r && pkg) pkg.declared = r[1];
        }
        if (table === 'project' && /^\s*dependencies\s*=\s*\[/.test(l)) inDeps = true;
        if (inDeps) {
          for (const m of l.matchAll(/"([A-Za-z0-9._-]+)/g)) deps.push({ ecosystem: 'pypi', name: m[1], file, line: n + 1, text: l.trim() });
          if (l.includes(']')) inDeps = false;
        }
        if (table === 'tool.poetry.dependencies') {
          const m = l.match(/^\s*([A-Za-z0-9._-]+)\s*=/);
          if (m && m[1] !== 'python') deps.push({ ecosystem: 'pypi', name: m[1], file, line: n + 1, text: l.trim() });
        }
      });
    } else if (base === 'lakefile.lean' || base === 'lakefile.toml') {
      lines(show(c, file)).forEach((l, n) => {
        const m = base === 'lakefile.lean' ? l.match(/^\s*package\s+«?([A-Za-z0-9_.-]+)»?/) : l.match(/^\s*name\s*=\s*"([^"]+)"/);
        if (m && !packages.some((p) => p.file === file)) packages.push({ ecosystem: 'lake', name: m[1], file, line: n + 1, declared: '', inherit: false });
      });
    }
  }
  // `repository.workspace = true` takes the nearest enclosing workspace's `[workspace.package] repository`.
  for (const p of packages.filter((x) => x.inherit)) {
    for (let dir = posix.dirname(p.file); ; dir = posix.dirname(dir)) {
      if (workspaceRepo.has(dir)) { p.declared = workspaceRepo.get(dir); break; }
      if (dir === '.' || dir === '/') break;
    }
  }
  return { packages, deps };
}

// A statement about the repository itself, read per sentence of its README. Supersession and deprecation need
// the repository as subject ("this repository", "this project", or its own name); a relocation is a sentence that
// names another Foundation repository as where part of this one's content lives or belongs.
const SUBJECT = (name) => `(?:this (?:repository|repo|project|package|crate)|${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`;
const CLASSES = [
  ['supersession', (n) => new RegExp(`${SUBJECT(n)}[^.]*?\\b(?:(?:is|has been|was|are|have been) )?(?:superseded by|replaced by|merged into|folded into|deprecated in favou?r of|moved to|has moved to|now lives (?:in|at))`, 'i')],
  ['deprecation', (n) => new RegExp(`${SUBJECT(n)}[^.]*?\\b(?:is|has been|was) (?:now )?(?:deprecated|no longer maintained|unmaintained|archived|retired|obsolete)`, 'i')],
  ['relocation', () => /\b(?:moved (?:out of|to|into)|belongs? (?:in|to)|lives in|is maintained in|owns the|without duplicating)\b/i],
];
const URL = /github\.com[/:]+UOR-Foundation\/([A-Za-z0-9._-]+)/gi;
const USES = /uses:\s*['"]?UOR-Foundation\/([A-Za-z0-9._-]+)/gi;
const resolve = (raw) => lower.get(raw.replace(/\.git$/i, '').replace(/[.)]+$/, '').toLowerCase());

const evidence = checkouts.map((c) => {
  const files = gitIn(c.dir, 'ls-tree', '-r', '--name-only', '-z', c.commit).split('\0').filter(Boolean);
  const readme = files.filter((f) => !f.includes('/') && README.test(f)).sort((a, b) => (/\.md$/i.test(b) ? 1 : 0) - (/\.md$/i.test(a) ? 1 : 0) || (a < b ? -1 : 1))[0] ?? '';
  const top = gitIn(c.dir, 'ls-tree', '-z', c.commit).split('\0').filter(Boolean)
    .map((l) => { const [meta, name] = l.split('\t'); return meta.split(' ')[1] === 'tree' ? `${name}/` : name; }).sort();
  const epoch = Number(gitIn(c.dir, 'show', '-s', '--format=%ct', c.commit).trim());
  const recent = Number(gitIn(c.dir, 'rev-list', '--count', `--since=${since}`, `--until=${until}`, c.commit).trim());
  const { packages, deps } = manifests(c, files);
  const grep = (pattern, ...paths) =>
    gitOk(c.dir, 'grep', '-n', '-I', '-i', '-E', pattern, c.commit, '--', ...paths).split('\n').filter(Boolean).map((l) => {
      const rest = l.slice(c.commit.length + 1);
      const m = rest.match(/^(.*?):(\d+):(.*)$/);
      return { file: m[1], line: Number(m[2]), text: m[3] };
    });
  const urls = grep('github\\.com[/:]+UOR-Foundation/');
  const uses = grep('uses:\\s*[\'"]?UOR-Foundation/', '.github/workflows/');
  const statements = [];
  if (readme) {
    for (const p of paragraphs(c, readme)) {
      if (/^(#|\||<)/.test(p.lines[0])) continue;
      // Each sentence keeps the README line it starts on.
      const starts = [];
      let joined = '';
      p.lines.forEach((l, k) => { starts.push([joined.length, p.line + k]); joined += `${l} `; });
      for (const m of joined.matchAll(/[^.!?]+(?:[.!?](?=\s|$)|$)/g)) {
        const sentence = prose(m[0]);
        const kind = CLASSES.find(([, re]) => re(c.r.name).test(sentence));
        if (!kind) continue;
        const line = starts.filter(([at]) => at <= m.index + (m[0].length - m[0].trimStart().length)).at(-1)[1];
        statements.push({ kind: kind[0], file: readme, line, text: sentence });
      }
    }
  }
  return { c, files, readme, top, epoch, recent, packages, deps, urls, uses, statements };
});

// A package is published from the Foundation repository its manifest declares as `repository` (Cargo
// `package.repository`, npm `repository`, PEP 621 `project.urls`), and otherwise from the repository it is in.
// A manifest that declares another Foundation repository is a vendored copy of that repository's package.
const declaredIn = (p) => { const m = [...String(p.declared).matchAll(URL)][0]; return m ? resolve(m[1]) : undefined; };
const publishers = new Map();
for (const e of evidence) for (const p of e.packages) {
  const key = `${p.ecosystem}:${p.name.toLowerCase()}`;
  if (!publishers.has(key)) publishers.set(key, new Set());
  publishers.get(key).add(declaredIn(p) ?? e.c.r.name);
}

const repositories = evidence.map((e) => {
  const from = e.c.r.name;
  const refs = new Map();
  const add = (to, kind, ev) => {
    if (!to || to === from) return;
    const key = `${to}\0${kind}\0${ev.file}`;
    const had = refs.get(key);
    if (had) had.evidence.occurrences += 1;
    else refs.set(key, { from, to, kind, evidence: { file: ev.file, line: ev.line, text: clip(ev.text.trim()), occurrences: 1 } });
  };
  for (const u of e.urls) for (const m of u.text.matchAll(URL)) add(resolve(m[1]), README.test(posix.basename(u.file)) ? 'readme-link' : 'git-url', u);
  for (const u of e.uses) for (const m of u.text.matchAll(USES)) add(resolve(m[1]), 'workflow', u);
  if (e.files.includes('.gitmodules')) {
    lines(show(e.c, '.gitmodules')).forEach((t, n) => {
      for (const m of t.matchAll(URL)) add(resolve(m[1]), 'submodule', { file: '.gitmodules', line: n + 1, text: t });
    });
  }
  for (const p of e.packages) {
    const origin = declaredIn(p);
    if (origin) add(origin, 'vendored', { file: p.file, line: p.line, text: `${p.name}: repository ${p.declared}` });
  }
  const own = new Set(e.packages.filter((p) => !declaredIn(p) || declaredIn(p) === from).map((p) => `${p.ecosystem}:${p.name.toLowerCase()}`));
  for (const d of e.deps) {
    const key = `${d.ecosystem}:${d.name.toLowerCase()}`;
    if (own.has(key)) continue;
    const by = [...(publishers.get(key) ?? [])].filter((n) => n !== from);
    // A name more than one other repository publishes names no single source; it is not resolved.
    if (by.length === 1) add(by[0], d.ecosystem, d);
  }
  const statements = e.statements.map((s) => {
    const named = [...new Set([
      ...[...s.text.matchAll(URL)].map((m) => resolve(m[1])),
      ...set.map((r) => r.name).filter((n) => n !== from && new RegExp(`(^|[^A-Za-z0-9_.-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`, 'i').test(s.text)),
    ].filter((n) => n && n !== from))].sort();
    return { kind: s.kind, file: s.file, line: s.line, text: clip(s.text), names: named };
  }).filter((s) => s.kind !== 'relocation' || s.names.length > 0);
  return {
    name: from,
    url: url(from),
    defaultBranch: e.c.branch,
    commit: e.c.commit,
    archived: e.c.r.archived,
    language: e.c.r.language,
    lastCommit: new Date(e.epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    recentCommits: e.recent,
    purpose: purpose(e.c, e.readme),
    layout: e.top,
    packages: e.packages.map((p) => ({ ecosystem: p.ecosystem, name: p.name, file: p.file, line: p.line }))
      .sort((a, b) => (`${a.ecosystem}:${a.name}:${a.file}` < `${b.ecosystem}:${b.name}:${b.file}` ? -1 : 1)),
    statements,
    references: [...refs.values()].sort((a, b) => (`${a.to}\0${a.kind}\0${a.evidence.file}` < `${b.to}\0${b.kind}\0${b.evidence.file}` ? -1 : 1)),
  };
});

const text = `${JSON.stringify({
  spec: 'uor-community/reorg-snapshot/1',
  asOf,
  window: { days: sources.window.days, since: new Date(since * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') },
  set: { path: sources.repositories.set, sha256: createHash('sha256').update(setBytes).digest('hex') },
  repositories,
}, null, 2)}\n`;
if (flag === '--check') {
  if (readFileSync(target, 'utf8') !== text) {
    process.stderr.write('reorg/snapshot.json is not what its recorded commits give\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
const refs = repositories.reduce((n, r) => n + r.references.length, 0);
process.stdout.write(`${repositories.length} repositories, ${refs} references, ${repositories.reduce((n, r) => n + r.statements.length, 0)} statements\n`);
