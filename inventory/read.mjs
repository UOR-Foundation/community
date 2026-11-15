/**
 * Read the Foundation's pinned repositories for what the asset register names:
 * every host a file links to, every install instruction, every Discord invite,
 * every container image a workflow names, and every CNAME. snapshot.mjs observes
 * what this finds and project.mjs reads it again from its own checkouts, so the
 * two cannot disagree on what was referenced. Files are read from git at the
 * pinned commit, never from a working tree.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** A repository checked out (or fetched) under root/name, read at the pinned commit. */
export function checkout(root, name, commit) {
  const git = (...args) => execFileSync('git', ['-C', join(root, name), ...args], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  const at = git('rev-parse', `${commit}^{commit}`).toString().trim();
  if (at !== commit) throw new Error(`${name} does not hold the pinned ${commit}`);
  const paths = git('ls-tree', '-r', '--name-only', '-z', commit).toString().split('\0').filter(Boolean);
  const blob = (path) => git('show', `${commit}:${path}`);
  return { name, commit, paths, blob, text: (path) => blob(path).toString('utf8').replace(/\r\n/g, '\n') };
}

// Binary formats are not read for links: their bytes are not text a reader follows.
const BINARY = /\.(png|jpe?g|webp|gif|ico|svgz|lockb|woff2?|ttf|otf|pdf|zip|gz|tar|wasm|bin|onnx|pt|safetensors|npy|npz|parquet)$/i;
const URL_HOST = /https?:\/\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)/g;
const INSTALL = /\b(cargo add|npm install|npm i|npx|pip install)\s+((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)/g;
const REGISTRY = { 'cargo add': 'crates.io', 'npm install': 'npm', 'npm i': 'npm', npx: 'npm', 'pip install': 'pypi' };
const INVITE = /discord\.gg\/([A-Za-z0-9-]+)/g;
const IMAGE = /ghcr\.io\/uor-foundation\/([a-z0-9][a-z0-9._-]*[a-z0-9])/g;

const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function collect(found, key, value) {
  if (!found.has(key)) found.set(key, value);
}

/** Everything the website links to, tells a reader to install, or invites them to. */
export function readWebsite(site) {
  const hosts = new Map();
  const installs = new Map();
  const invites = new Map();
  for (const path of site.paths) {
    if (BINARY.test(path)) continue;
    const text = site.text(path);
    for (const m of text.matchAll(URL_HOST)) collect(hosts, m[1].toLowerCase(), { host: m[1].toLowerCase(), repository: site.name, path });
    for (const m of text.matchAll(INSTALL)) {
      // A package name is never a version or a flag; an @version suffix is not part of the name.
      const name = m[2].replace(/@[^/]*$/, '').replace(/\.+$/, '');
      if (!name || /^\d/.test(name)) continue;
      collect(installs, `${REGISTRY[m[1]]} ${name}`, { registry: REGISTRY[m[1]], name, command: m[1], repository: site.name, path });
    }
    for (const m of text.matchAll(INVITE)) collect(invites, m[1], { code: m[1], repository: site.name, path });
  }
  return {
    cname: site.text('public/CNAME').trim().toLowerCase(),
    hosts: [...hosts.values()].sort((a, b) => byKey(a.host, b.host)),
    installs: [...installs.values()].sort((a, b) => byKey(`${a.registry} ${a.name}`, `${b.registry} ${b.name}`)),
    invites: [...invites.values()].sort((a, b) => byKey(a.code, b.code)),
  };
}

// The files of a repository that say where it is published: its README, root manifests, CNAME files and workflows.
const PUBLISHING = (p) => /^readme(\.[a-z]+)?$/i.test(p) || /^(Cargo\.toml|package\.json|pyproject\.toml)$/.test(p) || /(^|\/)CNAME$/.test(p) || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p);

/** The hosts, container images and Pages domains one repository's publishing files name. */
export function readRepository(repo) {
  const hosts = new Map();
  const images = new Map();
  const invites = new Map();
  const cnames = [];
  const files = [];
  for (const path of repo.paths.filter(PUBLISHING).sort(byKey)) {
    const bytes = repo.blob(path);
    files.push({ path, sha256: sha256(bytes) });
    const text = bytes.toString('utf8');
    for (const m of text.matchAll(URL_HOST)) collect(hosts, m[1].toLowerCase(), { host: m[1].toLowerCase(), repository: repo.name, path });
    for (const m of text.matchAll(INVITE)) collect(invites, m[1], { code: m[1], repository: repo.name, path });
    if (path.startsWith('.github/workflows/')) for (const m of text.matchAll(IMAGE)) collect(images, m[1], { image: m[1], repository: repo.name, path });
    if (/(^|\/)CNAME$/.test(path)) {
      const host = text.trim().toLowerCase();
      if (host) cnames.push({ host, repository: repo.name, path });
    }
  }
  return { name: repo.name, commit: repo.commit, files, hosts: [...hosts.values()].sort((a, b) => byKey(a.host, b.host)), images: [...images.values()].sort((a, b) => byKey(a.image, b.image)), invites: [...invites.values()].sort((a, b) => byKey(a.code, b.code)), cnames };
}

/** The Public Suffix List, as its formal algorithm reads it, over the ICANN section or the whole list. */
export function publicSuffixList(text) {
  const rules = [];
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('// ===BEGIN ICANN DOMAINS===')) section = 'icann';
    else if (line.startsWith('// ===BEGIN PRIVATE DOMAINS===')) section = 'private';
    if (!line || line.startsWith('//')) continue;
    const rule = line.split(/\s/)[0].toLowerCase();
    rules.push({ exception: rule.startsWith('!'), labels: rule.replace(/^!/, '').split('.'), section });
  }
  const registrable = (host, sections) => {
    const labels = host.toLowerCase().split('.');
    const matches = rules.filter((r) => sections.includes(r.section) && r.labels.length <= labels.length
      && r.labels.every((l, i) => l === '*' || l === labels[labels.length - r.labels.length + i]));
    const exception = matches.find((r) => r.exception);
    // The prevailing rule: an exception rule; else the matching rule with the most labels; else the rule "*".
    const suffixLength = exception ? exception.labels.length - 1 : Math.max(1, ...matches.map((r) => r.labels.length));
    return labels.length > suffixLength ? labels.slice(labels.length - suffixLength - 1).join('.') : '';
  };
  return { icann: (host) => registrable(host, ['icann']), all: (host) => registrable(host, ['icann', 'private']) };
}

/** SemVer 2.0.0 precedence, section 11; a leading v marks a version and is not part of it. */
const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
export const isSemver = (tag) => SEMVER.test(tag);
export function semverCompare(a, b) {
  const [x, y] = [a, b].map((t) => t.match(SEMVER));
  for (let i = 1; i <= 3; i += 1) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
  if (!x[4] || !y[4]) return (x[4] ? -1 : 0) + (y[4] ? 1 : 0);
  const [p, q] = [x[4].split('.'), y[4].split('.')];
  for (let i = 0; i < Math.max(p.length, q.length); i += 1) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const [n, m] = [/^\d+$/.test(p[i]), /^\d+$/.test(q[i])];
    if (n && m && Number(p[i]) !== Number(q[i])) return Number(p[i]) - Number(q[i]);
    if (n !== m) return n ? -1 : 1;
    if (!n && p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

/** The identifiers of an SPDX License Expression (SPDX 3.0.1 Annex B), split on its operators and parentheses. */
export const licenseIds = (expression) => expression.replace(/[()]/g, ' ').split(/\s+/).filter((t) => t && !['AND', 'OR', 'WITH'].includes(t)).map((t) => t.replace(/\+$/, ''));

/**
 * The hosts that are the Foundation's own, each with the first reference to it and why it is the Foundation's:
 * it is under the registrable domain the website's CNAME names, it is the organization's GitHub Pages host, a
 * Foundation repository's CNAME file claims it, or it is a platform host the website runs on (declared.json,
 * with the source text that shows it).
 */
export function foundationHosts({ psl, cname, owner, pagesSuffix, platform, cnames, referenced }) {
  const home = psl.icann(cname);
  const pages = `${owner.toLowerCase()}.${pagesSuffix}`;
  const claimed = new Set(cnames.map((c) => c.host));
  const declared = new Map(platform.map((p) => [p.host, p]));
  const out = new Map();
  const refs = [...referenced, ...cnames, ...platform.map((p) => ({ host: p.host, repository: p.evidence[0].repository, path: p.evidence[0].path }))];
  for (const r of refs) {
    if (out.has(r.host)) continue;
    const reason = psl.icann(r.host) === home ? 'registrable-domain' : r.host === pages ? 'github-pages' : claimed.has(r.host) ? 'pages-cname' : declared.has(r.host) ? 'platform' : '';
    if (reason) out.set(r.host, { host: r.host, reason, repository: r.repository, path: r.path });
  }
  return [...out.values()].sort((a, b) => byKey(a.host, b.host));
}
