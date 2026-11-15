#!/usr/bin/env node
/**
 * Snapshot what the badge application's detectives read of each public
 * UOR-Foundation repository, into bestpractices/snapshot.json, and whether
 * bestpractices.dev already holds a badge entry for any of them.
 *
 * The repositories are those of ecosystem/snapshot.json at the commits
 * licensing/snapshot.json pins. Each is fetched anonymously, one at a time, at
 * depth 1 with blobs over 100001 bytes left on the server, read, and deleted:
 * its top-level tree (RepoFilesExamineDetective, BuildDetective), its first
 * top-level documentation folder and, for each file there of at most 100000
 * bytes, whether it mentions install, use or security
 * (SubdirFileContentsDetective), and whether a file SecurityInsightsDetective
 * or RepoJsonDetective reads is present. The license GitHub identifies and the
 * homepage the repository declares (GithubBasicDetective) are read from the
 * GitHub search API, which states them for the default branch now, so they are
 * kept only with that branch's head at the same moment. The security headers
 * of the final response of the homepage and the repository page are those
 * HardenedSitesDetective reads. The badge search uses the public projects.json
 * API with the url (exact repo_url or homepage_url), pq (prefix) and q (text)
 * queries of projects_controller.rb.
 *
 * Fetched text is data: only names, sizes, digests and booleans are kept.
 *
 *   node bestpractices/snapshot.mjs <scratch-dir> [--check]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATTERNS, SELF_DECLARED, HEADERS } from './detectives.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const [scratch, flag] = process.argv.slice(2);
if (!scratch) {
  process.stderr.write('usage: snapshot.mjs <scratch-dir> [--check]\n');
  process.exit(64);
}
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const bytesOf = (p) => readFileSync(join(root, p));
// Blobs larger than this stay on the server; every size a detective compares with is below it.
const BLOB_LIMIT = 100001;

function get(url, accept) {
  const out = execFileSync('curl', ['-sS', '-H', `Accept: ${accept}`, '-w', '\n%{http_code}', url], { maxBuffer: 1 << 28 });
  const cut = out.lastIndexOf(0x0a);
  return { status: Number(out.subarray(cut + 1).toString()), body: out.subarray(0, cut) };
}
const json = (url, accept = 'application/json') => {
  const r = get(url, accept);
  if (r.status !== 200) throw new Error(`${url} returned HTTP ${r.status}`);
  return JSON.parse(r.body.toString('utf8'));
};
// Response headers of the final response, after at most the 8 redirects evidence.rb follows (MAX_REDIRECTS).
function headers(url) {
  let out = '';
  try {
    out = execFileSync('curl', ['-sS', '-L', '--max-redirs', '8', '-o', '/dev/null', '-D', '-', url], { encoding: 'latin1' });
  } catch {
    return { url, status: 0, present: [], frameAncestors: false };
  }
  const blocks = out.split(/\r?\n\r?\n/).filter((b) => b.startsWith('HTTP/'));
  const last = blocks.at(-1) ?? '';
  const fields = new Map(last.split(/\r?\n/).slice(1).map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  return {
    url,
    status: Number(last.split(' ')[1] ?? 0),
    present: HEADERS.filter((h) => fields.has(h)),
    frameAncestors: (fields.get('content-security-policy') ?? '').includes('frame-ancestors'),
  };
}

const ecosystem = JSON.parse(bytesOf(sources.repositories.set).toString('utf8'));
const licensing = JSON.parse(bytesOf(sources.repositories.commits).toString('utf8'));
const commitOf = new Map(licensing.repositories.map((r) => [r.repository, r.commit]));
const searched = json(`${sources.repositories.api}/search/repositories?q=${encodeURIComponent(ecosystem.query)}&per_page=100`, 'application/vnd.github+json');
const metaOf = new Map(searched.items.map((i) => [i.name.toLowerCase(), i]));

// The GitHub contents API types of git tree modes.
const TYPE = { blob: 'file', tree: 'dir', commit: 'submodule' };
function readTree(name, commit) {
  const dir = join(scratch, `bp-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const git = (a, opts = {}) => execFileSync('git', ['-C', dir, ...a], { maxBuffer: 1 << 28, ...opts });
  try {
    git(['init', '-q']);
    git(['remote', 'add', 'origin', `https://github.com/UOR-Foundation/${name}.git`]);
    git(['config', 'remote.origin.promisor', 'true']);
    git(['config', 'remote.origin.partialclonefilter', `blob:limit=${BLOB_LIMIT}`]);
    git(['fetch', '-q', '--depth', '1', `--filter=blob:limit=${BLOB_LIMIT}`, 'origin', commit]);
    // No lazy fetch afterwards: a blob left on the server is known to be larger than BLOB_LIMIT.
    git(['config', '--unset', 'remote.origin.promisor']);
    const list = (path) => git(['ls-tree', '-z', path ? `${commit}:${path}` : commit]).toString('utf8').split('\0').filter(Boolean).map((l) => {
      const [meta, entry] = [l.slice(0, l.indexOf('\t')), l.slice(l.indexOf('\t') + 1)];
      const [mode, kind, oid] = meta.split(' ');
      return { name: entry, type: mode === '120000' ? 'symlink' : TYPE[kind], oid };
    });
    const sizeOf = (entries) => {
      const blobs = entries.filter((e) => e.type === 'file' || e.type === 'symlink');
      if (!blobs.length) return;
      const out = git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], { input: blobs.map((b) => b.oid).join('\n') + '\n' }).toString('utf8').trim().split('\n');
      const sizes = new Map(out.map((l) => l.split(' ')).map(([oid, s]) => [oid, s === 'missing' ? null : Number(s)]));
      for (const b of blobs) b.size = sizes.get(b.oid) ?? null;
    };
    const top = list('');
    sizeOf(top);
    const topLevel = top.map((e) => ({ name: e.name, type: e.type, size: e.type === 'dir' || e.type === 'submodule' ? 0 : e.size }));
    const folder = top.find((f) => f.type === 'dir' && PATTERNS.docsFolder.re.test(f.name));
    let docs = null;
    if (folder) {
      const entries = list(folder.name);
      sizeOf(entries);
      docs = {
        folder: folder.name,
        files: entries.map((f) => {
          const size = f.type === 'file' ? f.size : 0;
          const row = { name: f.name, type: f.type, size, read: false, sha256: '', contents: [false, false, false] };
          if (f.type !== 'file' || size === null || size > 100000 || size === 0) return row;
          const body = git(['cat-file', 'blob', f.oid]);
          const text = body.toString('latin1');
          return { ...row, read: true, sha256: sha256(body), contents: PATTERNS.docsContents.re.map((re) => re.test(text)) };
        }),
      };
    }
    const selfDeclared = SELF_DECLARED.filter((p) => {
      if (!p.includes('/')) return top.some((f) => f.name === p);
      const [d, file] = p.split('/');
      return top.some((f) => f.name === d && f.type === 'dir') && list(d).some((f) => f.name === file);
    });
    return { topLevel, docs, selfDeclared };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const repositories = ecosystem.repositories.map((r) => {
  const commit = commitOf.get(r.name);
  if (!commit) throw new Error(`${r.name} has no commit in ${sources.repositories.commits}`);
  const meta = metaOf.get(r.name.toLowerCase());
  if (!meta) throw new Error(`${r.name} is not in the GitHub search result`);
  const head = execFileSync('git', ['ls-remote', `https://github.com/UOR-Foundation/${r.name}.git`, 'HEAD'], { encoding: 'utf8' }).split('\t')[0];
  const tree = readTree(r.name, commit);
  const homepage = meta.homepage ?? '';
  return {
    name: r.name,
    commit,
    headNow: head,
    ...tree,
    licenseSpdx: meta.license?.spdx_id ?? '',
    homepage,
    headers: homepage ? [...new Set([homepage, `https://github.com/UOR-Foundation/${r.name}`])].map(headers) : [],
  };
});

// The badge search: one exact url query per repository, and prefix and text queries for the organization.
const search = (query) => {
  const r = get(`${sources.badge.search.endpoint}?${query}`, 'application/json');
  const list = r.status === 200 ? JSON.parse(r.body.toString('utf8')) : [];
  return { query, status: r.status, projects: list.map((p) => ({ id: p.id, name: p.name, repo_url: p.repo_url ?? '', badge_level: p.badge_level ?? '' })) };
};
const queries = [
  ...repositories.map((r) => `url=${encodeURIComponent(`https://github.com/UOR-Foundation/${r.name}`)}`),
  `pq=${encodeURIComponent('https://github.com/UOR-Foundation')}`,
  `pq=${encodeURIComponent('https://github.com/uor-foundation')}`,
  'q=UOR-Foundation',
];
const badgeSearch = queries.map(search);

const text = `${JSON.stringify({
  spec: 'uor-community/bestpractices-snapshot/1',
  ecosystemSnapshot: sha256(bytesOf(sources.repositories.set)),
  licensingSnapshot: sha256(bytesOf(sources.repositories.commits)),
  githubSearch: ecosystem.query,
  repositories,
  badgeSearch,
}, null, 2)}\n`;
const target = join(here, 'snapshot.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
    process.stderr.write('bestpractices/snapshot.json differs from what the detectives read now; re-snapshot and re-project\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
const found = badgeSearch.reduce((n, s) => n + s.projects.length, 0);
process.stdout.write(`${repositories.length} repositories, ${badgeSearch.length} badge queries, ${found} badge entries found\n`);
