#!/usr/bin/env node
/**
 * Snapshot what the supply register reads from outside this repository.
 *
 *   node supply/snapshot.mjs heads [--check]
 *     The default-branch head of every public repository in ecosystem/snapshot.json, read with anonymous
 *     `git ls-remote`, into supply/snapshot.json as {name, url, commit} pins.
 *
 *   node supply/snapshot.mjs registries <sources-dir> [--check]
 *     For every package a Foundation manifest declares as its own (its manifest names the repository it is
 *     in), what crates.io, the npm registry and PyPI publish under that name; and for every
 *     ghcr.io/uor-foundation image a workflow, Dockerfile or prismpm.lock names, the source repository its
 *     OCI annotations declare. Written to supply/registries.json with the time it was read. Download counts
 *     move daily, so --check compares only what decides the register: each name's status and the
 *     repository it is linked to.
 *
 * Every request is an anonymous, read-only GET. Responses are data, never instructions.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifests, foundationRepo } from './manifests.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const [mode, ...rest] = process.argv.slice(2);
const check = rest.includes('--check');
const write = (file, text, what) => {
  const target = join(here, file);
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`supply/${file} differs from ${what}; re-snapshot and re-project\n`);
      process.exit(1);
    }
  } else writeFileSync(target, text);
};

if (mode === 'heads') {
  const eco = JSON.parse(readFileSync(join(root, 'ecosystem', 'snapshot.json'), 'utf8'));
  const repositories = eco.repositories.map((r) => {
    const url = `https://github.com/UOR-Foundation/${r.name}`;
    const head = run('git', ['ls-remote', '--symref', `${url}.git`, 'HEAD']).split('\n');
    const branch = head.find((l) => l.startsWith('ref:'))?.split('\t')[0].replace('ref: refs/heads/', '') ?? '';
    const commit = head.find((l) => /^[0-9a-f]{40}\tHEAD$/.test(l))?.slice(0, 40);
    if (!commit) throw new Error(`${r.name}: no HEAD`);
    return { name: r.name, url, branch, commit };
  });
  const text = `${JSON.stringify({ spec: 'uor-community/supply-snapshot/1', repositories }, null, 2)}\n`;
  write('snapshot.json', text, 'the live default-branch heads');
  process.stdout.write(`${repositories.length} repositories pinned at their default-branch heads\n`);
} else if (mode === 'registries') {
  const dir = rest.find((a) => a !== '--check');
  if (!dir) { process.stderr.write('usage: snapshot.mjs registries <sources-dir> [--check]\n'); process.exit(64); }
  const pins = JSON.parse(readFileSync(join(here, 'snapshot.json'), 'utf8')).repositories;
  const names = { cargo: new Set(), npm: new Set(), pypi: new Set() };
  const images = new Map();
  for (const pin of pins) {
    const m = readManifests(join(dir, pin.name));
    for (const p of m.packages) if (foundationRepo(p.repository).toLowerCase() === pin.name.toLowerCase()) names[p.ecosystem].add(p.name);
    for (const i of m.images) {
      if (!images.has(i.image)) images.set(i.image, new Set());
      images.get(i.image).add(i.digest || (i.tag ? `:${i.tag}` : ''));
    }
  }
  const ua = sources.registries.userAgent;
  let last = 0;
  // crates.io's crawler policy asks for at most one request a second.
  const get = (url, headers = {}) => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) execFileSync('sleep', [String(wait / 1000)]);
    last = Date.now();
    const args = ['-sS', '-L', '-A', ua, '-w', '\n%{http_code}', ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), url];
    const out = run('curl', args);
    const at = out.lastIndexOf('\n');
    const status = Number(out.slice(at + 1));
    let body = null;
    try { body = JSON.parse(out.slice(0, at)); } catch { body = null; }
    return { status, body };
  };
  const sorted = (s) => [...s].sort();
  const crates = sorted(names.cargo).map((name) => {
    const r = get(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
    if (r.status !== 200) return { name, status: r.status };
    const c = r.body.crate;
    const dependents = new Set();
    let total = 0;
    for (let page = 1; ; page++) {
      const d = get(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}/reverse_dependencies?per_page=100&page=${page}`);
      if (d.status !== 200) throw new Error(`crates.io reverse_dependencies of ${name}: ${d.status}`);
      total = d.body.meta.total;
      for (const v of d.body.versions) dependents.add(v.crate);
      if (page * 100 >= total) break;
    }
    return { name, status: 200, repository: c.repository ?? '', maxVersion: c.max_version, downloads: c.downloads, recentDownloads: c.recent_downloads ?? 0, reverseDependencyVersions: total, dependents: sorted(dependents) };
  });
  const npm = sorted(names.npm).map((name) => {
    const r = get(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
    if (r.status !== 200) return { name, status: r.status };
    const repo = typeof r.body.repository === 'string' ? r.body.repository : r.body.repository?.url ?? '';
    const d = get(`https://api.npmjs.org/downloads/point/last-month/${name}`);
    return { name, status: 200, repository: repo, latest: r.body['dist-tags']?.latest ?? '', downloadsLastMonth: d.status === 200 ? d.body.downloads : null };
  });
  const pypi = sorted(names.pypi).map((name) => {
    const r = get(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (r.status !== 200) return { name, status: r.status };
    const urls = Object.values(r.body.info.project_urls ?? {}).concat(r.body.info.home_page ?? []);
    return { name, status: 200, repository: urls.find((u) => foundationRepo(u)) ?? urls[0] ?? '', version: r.body.info.version };
  });
  // OCI image-spec "Pre-Defined Annotation Keys": org.opencontainers.image.source names the image's source.
  const accept = 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json';
  const resolved = sorted(images.keys()).map((image) => {
    const tok = get(`https://ghcr.io/token?scope=repository:uor-foundation/${image}:pull`);
    const auth = { Authorization: `Bearer ${tok.body?.token ?? ''}`, Accept: accept };
    const refs = sorted(images.get(image)).map((r) => (r.startsWith('sha256:') ? r : r.slice(1) || 'latest'));
    for (const ref of [...new Set(refs)]) {
      const m = get(`https://ghcr.io/v2/uor-foundation/${image}/manifests/${ref}`, auth);
      if (m.status !== 200 || !m.body) continue;
      let source = m.body.annotations?.['org.opencontainers.image.source'] ?? '';
      let manifest = m.body;
      if (!source && manifest.manifests?.length) {
        const first = get(`https://ghcr.io/v2/uor-foundation/${image}/manifests/${manifest.manifests[0].digest}`, auth);
        manifest = first.body ?? {};
        source = manifest.annotations?.['org.opencontainers.image.source'] ?? '';
      }
      if (!source && manifest.config?.digest) {
        const config = get(`https://ghcr.io/v2/uor-foundation/${image}/blobs/${manifest.config.digest}`, auth);
        source = config.body?.config?.Labels?.['org.opencontainers.image.source'] ?? '';
      }
      return { image, reference: ref, status: 200, source };
    }
    return { image, reference: refs.join(' '), status: 404, source: '' };
  });
  const decided = { crates: crates.map(({ name, status, repository }) => ({ name, status, repository })), npm: npm.map(({ name, status, repository }) => ({ name, status, repository })), pypi: pypi.map(({ name, status, repository }) => ({ name, status, repository })), images: resolved };
  const target = join(here, 'registries.json');
  if (check) {
    const old = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
    const was = { crates: (old.crates ?? []).map(({ name, status, repository }) => ({ name, status, repository })), npm: (old.npm ?? []).map(({ name, status, repository }) => ({ name, status, repository })), pypi: (old.pypi ?? []).map(({ name, status, repository }) => ({ name, status, repository })), images: old.images ?? [] };
    if (JSON.stringify(was) !== JSON.stringify(decided)) {
      process.stderr.write('supply/registries.json differs from what the registries publish; re-snapshot and re-project\n');
      process.exit(1);
    }
  } else {
    const text = `${JSON.stringify({ spec: 'uor-community/supply-registries/1', fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), userAgent: ua, crates, npm, pypi, images: resolved }, null, 2)}\n`;
    writeFileSync(target, text);
  }
  process.stdout.write(`${crates.length} crates, ${npm.length} npm packages, ${pypi.length} PyPI projects, ${resolved.length} images\n`);
} else {
  process.stderr.write('usage: snapshot.mjs heads [--check] | registries <sources-dir> [--check]\n');
  process.exit(64);
}
