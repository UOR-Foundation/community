/**
 * Read the dependency declarations of one repository checkout: the packages it
 * declares (with the repository each manifest names as its own), the packages
 * it depends on, and every reference it makes to a UOR-Foundation repository
 * or container image. Each finding carries the file and line it was read from.
 *
 * Only files git tracks are read, so a full fetch and a partial clone of the
 * same commit read the same bytes. The file kinds and the fields read from
 * each are the ones their own specifications define:
 *
 *   Cargo.toml, Cargo.lock      The Cargo Book, "The Manifest Format" and "Specifying Dependencies"
 *   package.json, package-lock  npm Docs, "package.json" and "package-lock.json"
 *   pyproject.toml              PyPA "pyproject.toml specification", PEP 508 names, PEP 503 normalization
 *   .gitmodules                 git-scm "gitmodules"
 *   .github/workflows/*.y(a)ml  GitHub Docs, "Workflow syntax" (`uses:`, `repository:`, `image:`)
 *   Dockerfile*                 Docker "Dockerfile reference" (`FROM`)
 *   prismpm.lock                the PrismPM SDK lock (`sdk_image`), schema prismpm/sdk-lock
 *
 * TOML is read line by line: the manifests in scope put each dependency on one
 * line or in its own table, and a declaration this reader cannot place is not
 * guessed at.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, basename, posix } from 'node:path';

// A GitHub owner/repository reference to the Foundation, in any of the URL forms git, npm and pip accept.
const REPO = /(?:github\.com[/:]|raw\.githubusercontent\.com\/|github:)UOR-Foundation\/([A-Za-z0-9._-]+?)(?:\.git)?(?=$|[/#@"'\s?)\],;:`])/gi;
// An image of the Foundation's GHCR namespace, by the OCI distribution-spec repository-name grammar. A name
// followed by a template or glob character is not a literal reference.
const IMAGE = /ghcr\.io\/uor-foundation\/([a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)(?::([A-Za-z0-9_][A-Za-z0-9._-]{0,127}))?(?:@(sha256:[0-9a-f]{64}))?(?![A-Za-z0-9$*{_-])/g;
// `uses: UOR-Foundation/<repo>[/<path>]@<ref>`, GitHub Docs "jobs.<job_id>.steps[*].uses".
const USES = /^\s*-?\s*uses:\s*['"]?UOR-Foundation\/([A-Za-z0-9._-]+)(?:\/[^@\s'"]*)?@([^\s'"#]+)/i;
const CHECKOUT_REPO = /^\s*repository:\s*['"]?UOR-Foundation\/([A-Za-z0-9._-]+)['"]?\s*(?:#.*)?$/i;

/** PEP 503 normalization of a Python distribution name. */
export const pep503 = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');
/** The key a package name is compared by within its ecosystem. */
export const keyOf = (ecosystem, name) => (ecosystem === 'pypi' ? pep503(name) : ecosystem === 'cargo' ? name.replace(/_/g, '-') : name);

/** The Foundation repository a URL names, or ''. */
export function foundationRepo(url) {
  REPO.lastIndex = 0;
  const m = REPO.exec(String(url ?? ''));
  return m ? m[1] : '';
}

const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');
const lines = (text) => text.replace(/\r\n/g, '\n').split('\n');

function cargoManifest(path, text, out, workspaceRepository) {
  let table = '';
  let pkg = null;
  let depTable = null;
  const ls = lines(text);
  ls.forEach((line, i) => {
    const at = `${path}:${i + 1}`;
    const code = line.replace(/\s+#.*$/, '');
    const header = code.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
    if (header) {
      table = header[1].replace(/["'\s]/g, '');
      depTable = null;
      const dep = table.match(/(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies)\.([^.]+)$/);
      if (dep) {
        depTable = { ecosystem: 'cargo', name: dep[1], evidence: at };
        out.dependencies.push(depTable);
      }
      if (table === 'package') pkg = { ecosystem: 'cargo', name: '', evidence: at, private: false, repository: '' };
      return;
    }
    const kv = code.match(/^\s*("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!kv) return;
    const key = unquote(kv[1]);
    const value = kv[2];
    if (table === 'package' && pkg) {
      if (key === 'name') { pkg.name = unquote(value); pkg.evidence = at; }
      if (key === 'publish' && /^false\b|^\[\s*\]/.test(value.trim())) pkg.private = true;
      if (key === 'repository') pkg.repository = unquote(value);
      if (key === 'repository.workspace' || (key === 'repository' && /workspace\s*=\s*true/.test(value))) pkg.repository = workspaceRepository;
    }
    if (/(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies)$/.test(table)) {
      const renamed = value.match(/\bpackage\s*=\s*"([^"]+)"/);
      out.dependencies.push({ ecosystem: 'cargo', name: renamed ? renamed[1] : key, evidence: at });
      const git = value.match(/\bgit\s*=\s*"([^"]+)"/);
      if (git) out.references.push({ kind: 'git', repo: foundationRepo(git[1]), url: git[1], evidence: at });
    } else if (depTable) {
      if (key === 'package') depTable.name = unquote(value);
      if (key === 'git') out.references.push({ kind: 'git', repo: foundationRepo(value), url: unquote(value), evidence: at });
    }
  });
  if (pkg && pkg.name) out.packages.push(pkg);
}

function cargoLock(path, text, out) {
  let name = null;
  lines(text).forEach((line, i) => {
    const at = `${path}:${i + 1}`;
    if (/^\[\[package\]\]/.test(line)) name = null;
    const n = line.match(/^name\s*=\s*"([^"]+)"/);
    if (n) name = { name: n[1], at };
    const s = line.match(/^source\s*=\s*"([^"]+)"/);
    if (s && name) {
      // A package without a source is a path package of this workspace; it is already declared by its manifest.
      out.dependencies.push({ ecosystem: 'cargo', name: name.name, evidence: name.at });
      if (s[1].startsWith('git+')) out.references.push({ kind: 'git', repo: foundationRepo(s[1]), url: s[1], evidence: at });
    }
  });
}

const npmSections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
function lineOf(ls, pattern, from = 0) {
  for (let i = from; i < ls.length; i++) if (pattern.test(ls[i])) return i;
  return -1;
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function packageJson(path, text, out) {
  let json;
  try { json = JSON.parse(text); } catch { out.unreadable.push(`${path}: not JSON`); return; }
  if (!json || typeof json !== 'object') return;
  const ls = lines(text);
  if (typeof json.name === 'string') {
    const repo = typeof json.repository === 'string' ? json.repository : json.repository?.url;
    const n = lineOf(ls, /^\s*"name"\s*:/);
    out.packages.push({ ecosystem: 'npm', name: json.name, evidence: `${path}:${n + 1}`, private: json.private === true, repository: repo ?? '' });
  }
  for (const section of npmSections) {
    const deps = json[section];
    if (!deps || typeof deps !== 'object') continue;
    const start = lineOf(ls, new RegExp(`^\\s*"${section}"\\s*:`));
    for (const [name, spec] of Object.entries(deps)) {
      const i = lineOf(ls, new RegExp(`^\\s*"${escape(name)}"\\s*:`), Math.max(start, 0));
      const at = `${path}:${i + 1}`;
      const alias = typeof spec === 'string' && spec.match(/^npm:((?:@[^/@]+\/)?[^@]+)/);
      out.dependencies.push({ ecosystem: 'npm', name: alias ? alias[1] : name, evidence: at });
      // npm reads a bare "owner/repo" as a GitHub repository.
      const shorthand = typeof spec === 'string' && spec.match(/^UOR-Foundation\/([A-Za-z0-9._-]+)/i);
      const repo = shorthand ? shorthand[1] : foundationRepo(spec);
      if (repo) out.references.push({ kind: 'git', repo, url: String(spec), evidence: at });
    }
  }
}

function packageLock(path, text, out) {
  let json;
  try { json = JSON.parse(text); } catch { out.unreadable.push(`${path}: not JSON`); return; }
  const ls = lines(text);
  for (const [key, entry] of Object.entries(json.packages ?? {})) {
    if (!key || entry.link) continue;
    const name = entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const i = lineOf(ls, new RegExp(`^\\s*"${escape(key)}"\\s*:`));
    const at = `${path}:${i + 1}`;
    out.dependencies.push({ ecosystem: 'npm', name, evidence: at });
    const repo = foundationRepo(entry.resolved);
    if (repo) out.references.push({ kind: 'git', repo, url: entry.resolved, evidence: at });
  }
}

// The PEP 508 name at the start of a requirement string, and a direct reference after `@`.
function requirement(spec, at, out) {
  const name = spec.match(/^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/);
  if (name) out.dependencies.push({ ecosystem: 'pypi', name: name[1], evidence: at });
  const repo = foundationRepo(spec);
  if (repo) out.references.push({ kind: 'git', repo, url: spec, evidence: at });
}
function pyproject(path, text, out) {
  let table = '';
  let inArray = false;
  let pkg = null;
  const urls = [];
  lines(text).forEach((line, i) => {
    const at = `${path}:${i + 1}`;
    const code = line.replace(/\s+#.*$/, '');
    const header = code.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
    if (header && !inArray) {
      table = header[1].replace(/["'\s]/g, '');
      if (table === 'project' || table === 'tool.poetry') pkg ??= { ecosystem: 'pypi', name: '', evidence: at, private: false, repository: '' };
      return;
    }
    const strings = () => [...code.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
    const isDepArray = (key) =>
      (table === 'project' && key === 'dependencies') || table === 'project.optional-dependencies' || table === 'dependency-groups' ||
      (table === 'build-system' && key === 'requires');
    if (inArray) {
      for (const s of strings()) if (inArray === 'deps') requirement(s, at, out); else if (inArray === 'classifiers' && s === 'Private :: Do Not Upload' && pkg) pkg.private = true;
      if (/\]/.test(code.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ''))) inArray = false;
      return;
    }
    const kv = code.match(/^\s*("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!kv) return;
    const key = unquote(kv[1]);
    const rest = kv[2];
    if ((table === 'project' || table === 'tool.poetry') && key === 'name' && pkg) { pkg.name = unquote(rest); pkg.evidence = at; }
    if (table === 'project.urls' || (table === 'tool.poetry' && (key === 'repository' || key === 'homepage'))) urls.push(unquote(rest));
    if (/^tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies$/.test(table) && key !== 'python') {
      out.dependencies.push({ ecosystem: 'pypi', name: key, evidence: at });
      const repo = foundationRepo(rest);
      if (repo) out.references.push({ kind: 'git', repo, url: rest, evidence: at });
    }
    const array = rest.trim().startsWith('[');
    const kind = isDepArray(key) ? 'deps' : table === 'project' && key === 'classifiers' ? 'classifiers' : '';
    if (array && kind) {
      for (const s of strings()) if (kind === 'deps') requirement(s, at, out); else if (s === 'Private :: Do Not Upload' && pkg) pkg.private = true;
      if (!/\]/.test(rest.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ''))) inArray = kind;
    }
  });
  if (pkg && pkg.name) {
    pkg.repository = urls.find((u) => foundationRepo(u)) ?? urls[0] ?? '';
    out.packages.push(pkg);
  }
}

function gitmodules(path, text, out) {
  lines(text).forEach((line, i) => {
    const m = line.match(/^\s*url\s*=\s*(\S+)/);
    if (m) out.references.push({ kind: 'submodule', repo: foundationRepo(m[1]), url: m[1], evidence: `${path}:${i + 1}` });
  });
}

function images(line, at, out) {
  IMAGE.lastIndex = 0;
  for (const m of line.matchAll(IMAGE)) out.images.push({ image: m[1], tag: m[2] ?? '', digest: m[3] ?? '', evidence: at });
}

function workflow(path, text, out) {
  lines(text).forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const at = `${path}:${i + 1}`;
    const uses = line.match(USES);
    if (uses) { out.references.push({ kind: 'action', repo: uses[1], url: line.trim(), evidence: at }); return; }
    const checkout = line.match(CHECKOUT_REPO);
    if (checkout) { out.references.push({ kind: 'git', repo: checkout[1], url: line.trim(), evidence: at }); return; }
    images(line, at, out);
    REPO.lastIndex = 0;
    for (const m of line.matchAll(REPO)) out.references.push({ kind: 'git', repo: m[1], url: line.trim(), evidence: at });
  });
}

function dockerfile(path, text, out) {
  lines(text).forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const at = `${path}:${i + 1}`;
    images(line, at, out);
    REPO.lastIndex = 0;
    for (const m of line.matchAll(REPO)) out.references.push({ kind: 'git', repo: m[1], url: line.trim(), evidence: at });
  });
}

function prismpmLock(path, text, out) {
  let json;
  try { json = JSON.parse(text); } catch { out.unreadable.push(`${path}: not JSON`); return; }
  // The lock is one line; the SDK image it pins is its dependency.
  const image = String(json.sdk_image ?? '');
  const ls = lines(text);
  const i = ls.findIndex((l) => l.includes(image));
  if (image) {
    images(image, `${path}:${i + 1}`, out);
    if (!/^ghcr\.io\/uor-foundation\//.test(image)) out.foreignImages.push({ image, evidence: `${path}:${i + 1}` });
  }
}

/** Every declaration in the checkout at `dir`, read from the files git tracks there. */
export function readManifests(dir) {
  const files = execFileSync('git', ['-C', dir, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 30 }).split('\0').filter(Boolean).sort();
  const out = { packages: [], dependencies: [], references: [], images: [], foreignImages: [], unreadable: [], files: 0 };
  // A member's `repository.workspace = true` takes the repository of the nearest workspace root above it.
  const cargo = files.filter((f) => basename(f) === 'Cargo.toml');
  const roots = new Map();
  for (const f of cargo) {
    const text = readFileSync(join(dir, f), 'utf8');
    let table = '';
    for (const line of lines(text)) {
      const header = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/);
      if (header) { table = header[1].replace(/["'\s]/g, ''); continue; }
      const m = table === 'workspace.package' && line.match(/^\s*repository\s*=\s*"([^"]+)"/);
      if (m) roots.set(posix.dirname(f), m[1]);
    }
  }
  const workspaceRepository = (f) => {
    for (let d = posix.dirname(f); ; d = posix.dirname(d)) {
      if (roots.has(d)) return roots.get(d);
      if (d === '.' || d === '/' || d === '') return '';
    }
  };
  for (const f of files) {
    const name = basename(f);
    let reader = null;
    if (name === 'Cargo.toml') reader = (p, t, o) => cargoManifest(p, t, o, workspaceRepository(f));
    else if (name === 'Cargo.lock') reader = cargoLock;
    else if (name === 'package.json') reader = packageJson;
    else if (name === 'package-lock.json') reader = packageLock;
    else if (name === 'pyproject.toml') reader = pyproject;
    else if (name === '.gitmodules') reader = gitmodules;
    else if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)) reader = workflow;
    else if (/^Dockerfile/.test(name) || /\.Dockerfile$/.test(name)) reader = dockerfile;
    else if (name === 'prismpm.lock') reader = prismpmLock;
    if (!reader) continue;
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { out.unreadable.push(`${f}: not in the checkout`); continue; }
    out.files += 1;
    reader(f, text, out);
  }
  return out;
}
