#!/usr/bin/env node
/**
 * Project the supply register of the whole Foundation from its pinned sources.
 *
 * For every repository of supply/snapshot.json, checked out at its pinned commit, one run of Anchore syft
 * (pinned by version and download digest) writes three SBOMs of the tree:
 *
 *   CycloneDX 1.7 JSON (ECMA-424, 2nd edition), validated by Ajv against the official 1.7 schema;
 *   SPDX 2.3 JSON, validated by Ajv against the official SPDX 2.3 schema and by spdx/tools-python's
 *     pyspdxtools, installed from PyPI by pinned hashes;
 *   SPDX 3.0.1 JSON-LD, validated by Ajv against the published SPDX 3.0.1 JSON schema.
 *
 * Each schema is read from git at its pinned commit, or downloaded from its issuer, and held to its pinned
 * digest. The values syft draws from the run are fixed so the same tree always gives the same bytes: a file
 * path is cut to the repository root, the CycloneDX serialNumber and the SPDX 2.3 documentNamespace take
 * the RFC 9562 name-based (v5) UUID of `<repository url>@<commit>` in the URL namespace, and the CycloneDX
 * metadata.timestamp and SPDX 2.3 creationInfo.created the commit's committer time. The CycloneDX 1.7 and
 * SPDX 2.3 bytes are committed under supply/sboms/. syft orders the SPDX 3.0.1 @graph and numbers its local
 * identifiers differently on each run, so those bytes cannot be reproduced: each is validated and counted,
 * and the register carries an open claim that it is not committed.
 *
 * Each CycloneDX SBOM is counted by Package-URL type (checked against the purl-spec type index) and by
 * declared license (CycloneDX licenseChoice: an SPDX id, a name, or an SPDX expression).
 *
 * The manifests of each checkout (supply/manifests.mjs) give the intra-Foundation dependency graph: an
 * edge A -> B for a package B publishes that A depends on, a git URL, submodule or GitHub Action into B,
 * a container image whose OCI source annotation is B, or a copy of B's package inside A. Each edge carries
 * every file and line it was read from. supply/registries.json gives what crates.io, npm and PyPI publish
 * under each package name a Foundation manifest declares as its own.
 *
 * Nothing is defaulted: an SBOM that does not validate, a repository syft finds nothing in, a reference to
 * a UOR-Foundation repository the register does not hold, an image whose source is not declared, a
 * dependency name two repositories declare, and a package that is not published as the Foundation's are
 * typed refusals carried into the register as open claims.
 *
 *   node supply/project.mjs <sources-dir> [--check] [--fetch]
 *
 * <sources-dir> holds each repository and standard checked out at its pinned commit under its name. With
 * --fetch, a repository that is not there at its pinned commit is fetched at that commit just before it is
 * read and removed after it, so one repository is on disk at a time. syft, the SPDX 3.0.1 schema and
 * spdx/tools-python are fetched into <sources-dir>/.supply-tools when they are not there at their digests.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readManifests, foundationRepo, keyOf } from './manifests.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const [dir, ...flags] = process.argv.slice(2);
if (!dir || flags.some((f) => f !== '--check' && f !== '--fetch')) {
  process.stderr.write('usage: project.mjs <sources-dir> [--check] [--fetch]\n');
  process.exit(64);
}
const check = flags.includes('--check');
const fetchEach = flags.includes('--fetch');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sources = json(join(here, 'sources.json'));
const snapshotBytes = readFileSync(join(here, 'snapshot.json'));
const pins = JSON.parse(snapshotBytes).repositories;
const ecosystemBytes = readFileSync(join(root, 'ecosystem', 'snapshot.json'));
const registriesBytes = readFileSync(join(here, 'registries.json'));
const registries = JSON.parse(registriesBytes);

// The repositories are exactly the ecosystem register's, in its order.
const ecosystemNames = JSON.parse(ecosystemBytes).repositories.map((r) => r.name);
if (pins.map((p) => p.name).join('\n') !== ecosystemNames.join('\n')) throw new Error('supply/snapshot.json does not pin the repositories of ecosystem/snapshot.json, in order');
const byName = new Map(pins.map((p, i) => [p.name.toLowerCase(), i]));

const headOf = (d) => run('git', ['-C', d, 'rev-parse', 'HEAD']).trim();
function pinnedFiles(standard) {
  const d = join(dir, standard.name);
  const at = headOf(d);
  if (at !== standard.commit) throw new Error(`${standard.name} is at ${at}, not the pinned ${standard.commit}`);
  for (const [path, digest] of Object.entries(standard.files)) {
    const got = sha256(readFileSync(join(d, path)));
    if (got !== digest) throw new Error(`${standard.name}:${path} has sha256 ${got}, not the pinned ${digest}`);
  }
  return (path) => readFileSync(join(d, path), 'utf8');
}
const cdx = sources.standards.cyclonedx;
const cdxFile = pinnedFiles(cdx);
const spdx2 = sources.standards.spdx2;
const spdx2File = pinnedFiles(spdx2);
const purl = sources.standards.purl;
const purlTypes = JSON.parse(pinnedFiles(purl)(purl.types));

// syft, fetched from its release and held to both pinned digests before it runs.
function syftBinary() {
  const s = sources.syft;
  const tools = join(dir, '.supply-tools', `syft-${s.version}`);
  const bin = join(tools, 'syft');
  const tarball = join(tools, 'syft.tar.gz');
  const sums = join(tools, 'checksums.txt');
  if (!existsSync(tarball) || sha256(readFileSync(tarball)) !== s.sha256) {
    rmSync(tools, { recursive: true, force: true });
    mkdirSync(tools, { recursive: true });
    run('curl', ['-sSfL', '-o', tarball, s.url]);
    run('curl', ['-sSfL', '-o', sums, s.checksums.url]);
  }
  if (sha256(readFileSync(tarball)) !== s.sha256) throw new Error(`syft ${s.version} does not have the pinned sha256`);
  if (sha256(readFileSync(sums)) !== s.checksums.sha256) throw new Error(`syft ${s.version} checksums do not have the pinned sha256`);
  const listed = readFileSync(sums, 'utf8').split('\n').find((l) => l.endsWith(` ${s.url.split('/').pop()}`));
  if (!listed || listed.split(/\s+/)[0] !== s.sha256) throw new Error(`syft's own checksums do not list the pinned tarball digest`);
  if (!existsSync(bin)) run('tar', ['-xzf', tarball, '-C', tools, 'syft']);
  const version = run(bin, ['version', '-o', 'json']);
  if (JSON.parse(version).version !== s.version) throw new Error(`syft reports ${JSON.parse(version).version}, not ${s.version}`);
  return { bin, digest: sha256(readFileSync(bin)) };
}
const syft = syftBinary();

// The SPDX 3.0.1 JSON schema, downloaded from spdx.org and held to the digest standards.lock also pins.
function spdx3Schema() {
  const s = sources.standards.spdx3;
  const file = join(dir, '.supply-tools', 'spdx3', s.url.split('/').pop());
  if (!existsSync(file) || sha256(readFileSync(file)) !== s.sha256) {
    mkdirSync(dirname(file), { recursive: true });
    run('curl', ['-sSfL', '-o', file, s.url]);
  }
  if (sha256(readFileSync(file)) !== s.sha256) throw new Error(`${s.url} does not have the pinned sha256`);
  return readFileSync(file, 'utf8');
}

// spdx/tools-python in its own venv, installed only from the hashes the requirements file pins and only from
// wheels, so no build step runs; the venv is rebuilt whenever the requirements bytes change.
function spdxTools() {
  const t = sources.validator.spdxTools;
  const requirements = readFileSync(join(root, t.requirements));
  const venv = join(dir, '.supply-tools', `spdx-tools-${t.version}`);
  const marker = join(venv, 'requirements.sha256');
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== sha256(requirements)) {
    rmSync(venv, { recursive: true, force: true });
    run('python3', ['-m', 'venv', venv]);
    run(join(venv, 'bin', 'pip'), ['install', '-q', '--disable-pip-version-check', '--no-input', '--require-hashes', '--only-binary=:all:', '-r', join(root, t.requirements)]);
    writeFileSync(marker, sha256(requirements));
  }
  const version = run(join(venv, 'bin', 'python'), ['-I', '-c', 'import importlib.metadata as m; print(m.version("spdx-tools"))']).trim();
  if (version !== t.version) throw new Error(`spdx-tools reports ${version}, not ${t.version}`);
  return { bin: join(venv, 'bin', 'pyspdxtools'), version, requirementsSha256: sha256(requirements) };
}
const pyspdx = spdxTools();

// Ajv, in the dialect each schema declares ($schema). Unknown keywords are ignored, as the dialects require;
// formats ajv-formats does not implement are annotations only, and are named in the register.
const Ajv = require('ajv');
const Ajv2019 = require('ajv/dist/2019');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const ajvVersion = json(require.resolve('ajv/package.json')).version;
const formatsVersion = json(require.resolve('ajv-formats/package.json')).version;
const asserted = new Set(Object.keys(require('ajv-formats/dist/formats').fullFormats));
function validator(Class, texts, main) {
  const ajv = new Class({ strict: false, allErrors: false, logger: false, validateFormats: true });
  addFormats(ajv);
  for (const text of texts) ajv.addSchema(JSON.parse(text));
  const fn = ajv.getSchema(JSON.parse(main).$id ?? '') ?? ajv.compile(JSON.parse(main));
  const dialect = JSON.parse(main).$schema;
  const notAsserted = [...new Set(texts.flatMap((t) => [...t.matchAll(/"format"\s*:\s*"([^"]+)"/g)].map((m) => m[1])))].filter((f) => !asserted.has(f)).sort();
  return { check: (doc) => fn(doc), errors: () => ajv.errorsText(fn.errors), dialect, formatsNotAsserted: notAsserted };
}
const validators = {
  cyclonedx: validator(Ajv, Object.keys(cdx.files).map((p) => cdxFile(p)), cdxFile(cdx.schema)),
  spdx: validator(Ajv2019, [spdx2File(spdx2.schema)], spdx2File(spdx2.schema)),
  spdx3: (() => { const t = spdx3Schema(); return validator(Ajv2020, [], t); })(),
};

// RFC 9562 section 5.5, name-based UUID with SHA-1, in the URL namespace of its Appendix A.
function uuidV5(name) {
  const ns = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const refusals = [];
const refuse = (repository, refusal, detail) => refusals.push({ repository, refusal, detail });
const sbomDir = join(here, 'sboms');
if (!check) {
  rmSync(sbomDir, { recursive: true, force: true });
  mkdirSync(sbomDir, { recursive: true });
}
const stale = [];
const manifests = [];
// A repository that is not at its pinned commit is fetched there with --fetch, as oracles/reproject.mjs fetches
// it, and removed after it is read; any other state is an error.
function checkout(pin) {
  const d = join(dir, pin.name);
  if (existsSync(join(d, '.git')) && headOf(d) === pin.commit) return { d, fetched: false };
  if (!fetchEach) throw new Error(`${pin.name} is not checked out at the pinned ${pin.commit} under ${dir}`);
  rmSync(d, { recursive: true, force: true });
  run('git', ['init', '-q', d]);
  run('git', ['-C', d, 'fetch', '-q', '--depth', '1', pin.url, pin.commit]);
  run('git', ['-C', d, 'checkout', '-q', '--detach', 'FETCH_HEAD']);
  if (headOf(d) !== pin.commit) throw new Error(`${pin.name} is at ${headOf(d)}, not the pinned ${pin.commit}`);
  return { d, fetched: true };
}
const scratch = join(dir, '.supply-tools', 'out');
// syft reads only the committed configuration: every SYFT_* variable is removed, and -c names supply/syft.yaml, so a
// .syft.yaml inside a checkout cannot change what is catalogued.
const syftConfig = join(root, sources.syft.config);
const syftEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('SYFT_'))), SYFT_CHECK_FOR_APP_UPDATE: 'false' };
// Each format: its key in sources.json, its name in the register, its file suffix when committed, and its refusal.
const FORMATS = [['cyclonedx', 'cyclonedx-1.7', 'cdx.json', 'sbom-invalid'], ['spdx', 'spdx-2.3', 'spdx.json', 'spdx-invalid'], ['spdx3', 'spdx-3.0.1', 'spdx3.json', 'spdx3-invalid']];
const committing = sources.syft.committed;
const syftRun = (d, keys) => {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const out = Object.fromEntries(keys.map((k) => [k, join(scratch, `${k}.json`)]));
  run(syft.bin, ['-c', syftConfig, 'dir:.', ...sources.syft.args, ...keys.flatMap((k) => ['-o', `${sources.syft.outputs[k]}=${out[k]}`])], { cwd: d, env: syftEnv });
  // syft names a file by its absolute path, so the checkout's own location is cut to the repository root.
  return Object.fromEntries(keys.map((k) => [k, readFileSync(out[k], 'utf8').split(`${realpathSync(d)}/`).join('/')]));
};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const spdx3Unreproduced = [];
const repositories = pins.map((pin, index) => {
  const { d, fetched } = checkout(pin);
  const raw = syftRun(d, FORMATS.map(([k]) => k));
  const committed = Number(run('git', ['-C', d, 'show', '-s', '--format=%ct', 'HEAD']).trim());
  const timestamp = new Date(committed * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const uuid = uuidV5(`${pin.url}@${pin.commit}`);
  const serial = `urn:uuid:${uuid}`;
  const line = (t) => (t.endsWith('\n') ? t : `${t}\n`);
  // The values syft draws from the run, replaced in syft's own bytes so its layout is kept.
  const text = line(raw.cyclonedx.replace(/("serialNumber":\s*")urn:uuid:[0-9a-f-]+(")/, `$1${serial}$2`).replace(/("metadata":\s*\{\s*"timestamp":\s*")[^"]+(")/, `$1${timestamp}$2`));
  const bom = JSON.parse(text);
  if (bom.serialNumber !== serial || bom.metadata?.timestamp !== timestamp) throw new Error(`${pin.name}: syft's serialNumber or timestamp was not where CycloneDX puts it`);
  const spdxText = line(raw.spdx.replace(new RegExp(`("documentNamespace":\\s*"[^"]*)${UUID}(")`), `$1${uuid}$2`).replace(/("creationInfo":\s*\{[^{}]*?"created":\s*")[^"]+(")/, `$1${timestamp}$2`));
  const spdxDoc = JSON.parse(spdxText);
  if (!spdxDoc.documentNamespace?.endsWith(uuid) || spdxDoc.creationInfo?.created !== timestamp) throw new Error(`${pin.name}: syft's documentNamespace or created was not where SPDX 2.3 puts it`);
  const spdx3Doc = JSON.parse(raw.spdx3);
  // A second run tells whether syft's SPDX 3.0.1 bytes are a function of the tree.
  const again = syftRun(d, ['spdx3']).spdx3;
  const runValue = (t) => t.replace(new RegExp(`https://anchore\\.com/syft/dir/${UUID}`, 'g'), '').replace(/"created":"[^"]+"/g, '');
  if (runValue(again) !== runValue(raw.spdx3)) spdx3Unreproduced.push(pin.name);
  const spdxFile = join(scratch, 'spdx.json');
  writeFileSync(spdxFile, spdxText);
  const tools = spawnSync(pyspdx.bin, ['-i', spdxFile], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const checks = {
    cyclonedx: [validators.cyclonedx.check(bom) && bom.bomFormat === 'CycloneDX' && bom.specVersion === '1.7', () => `${cdx.schema}: ${validators.cyclonedx.errors()}`],
    spdx: [validators.spdx.check(spdxDoc) && spdxDoc.spdxVersion === 'SPDX-2.3' && tools.status === 0, () => `${spdx2.schema}: ${validators.spdx.check(spdxDoc) ? 'valid' : validators.spdx.errors()}; pyspdxtools ${pyspdx.version}: exit ${tools.status}, ${`${tools.stderr}${tools.stdout}`.trim().split('\n').slice(0, 4).join(' ')}`],
    spdx3: [validators.spdx3.check(spdx3Doc) && spdx3Doc['@graph']?.some((e) => e.type === 'CreationInfo' && e.specVersion === '3.0.1'), () => `${sources.standards.spdx3.url}: ${validators.spdx3.errors()}`],
  };
  const elements = {
    cyclonedx: null,
    spdx: (spdxDoc.packages?.length ?? 0) + (spdxDoc.files?.length ?? 0) + (spdxDoc.snippets?.length ?? 0),
    spdx3: (spdx3Doc['@graph'] ?? []).filter((e) => e.spdxId).length,
  };
  const bytes = { cyclonedx: text, spdx: spdxText, spdx3: raw.spdx3 };
  const serializations = FORMATS.map(([k, format, ext, refusal]) => {
    const [valid, why] = checks[k];
    if (!valid) refuse(index, refusal, `${pin.name}: syft's ${format} SBOM is not valid (${why()})`);
    // A reproducible format is addressed by its digest whether or not its bytes are committed; --check re-derives both.
    const reproducible = k !== 'spdx3';
    const file = committing[k] && reproducible && valid ? `supply/sboms/${pin.name}.${ext}` : null;
    if (file) {
      const target = join(root, file);
      if (check) { if (!existsSync(target) || readFileSync(target, 'utf8') !== bytes[k]) stale.push(file); }
      else writeFileSync(target, bytes[k]);
    }
    return { format, valid, reproducible, path: file, sha256: reproducible && valid ? sha256(bytes[k]) : '', bytes: Buffer.byteLength(bytes[k]), elements: elements[k] };
  });
  const all = [];
  const walk = (cs) => { for (const c of cs ?? []) { all.push(c); walk(c.components); } };
  walk(bom.components);
  serializations[0].elements = all.length;
  const purlTypeCounts = {};
  const licenses = {};
  let licensed = 0;
  let licenseEntries = 0;
  for (const c of all) {
    // ECMA-427: pkg:<type>/..., the type case-insensitive and canonically lowercase.
    const type = c.purl ? c.purl.slice(4, c.purl.indexOf('/')).toLowerCase() : 'none';
    purlTypeCounts[type] = (purlTypeCounts[type] ?? 0) + 1;
    const entries = (c.licenses ?? []).map((l) => (l.expression ? ['expression', l.expression] : l.license?.id ? ['id', l.license.id] : ['name', l.license?.name ?? '']));
    if (entries.length) licensed += 1;
    for (const [form, value] of entries) {
      const k = `${form}\t${value}`;
      licenses[k] = (licenses[k] ?? 0) + 1;
      licenseEntries += 1;
    }
  }
  for (const type of Object.keys(purlTypeCounts)) {
    if (type !== 'none' && !purlTypes.includes(type)) refuse(index, 'purl-type-unregistered', `${pin.name}: ${purlTypeCounts[type]} components have the Package-URL type ${type}, which ${purl.types} does not register`);
  }
  if (all.length === 0) refuse(index, 'sbom-empty', `${pin.name}: syft ${sources.syft.version} catalogues no component in the tree at ${pin.commit}`);
  manifests.push(readManifests(d));
  if (fetched) rmSync(d, { recursive: true, force: true });
  const [own] = serializations;
  return {
    index,
    name: pin.name,
    commit: pin.commit,
    sbom: own.path ? { path: own.path, sha256: own.sha256, bytes: own.bytes } : null,
    serializations,
    components: all.length,
    purlTypes: Object.fromEntries(Object.entries(purlTypeCounts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    licensedComponents: licensed,
    licenseEntries,
    licenses: Object.entries(licenses).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, count]) => { const [form, license] = k.split('\t'); return { form, license, count }; }),
  };
});
rmSync(scratch, { recursive: true, force: true });
if (check) for (const f of readdirSync(sbomDir)) if (!repositories.some((r) => r.serializations.some((x) => x.path === `supply/sboms/${f}`))) stale.push(`supply/sboms/${f}`);
// syft 1.55.0 writes SPDX 3.0.1 with its @graph order and local identifiers drawn from the run, so two runs on one
// tree differ; those bytes are validated and counted, never committed, and the register says so.
if (spdx3Unreproduced.length === 0) throw new Error(`syft ${sources.syft.version} wrote the same SPDX 3.0.1 bytes twice for every repository; commit them and retire the not-reproducible claim`);
const formatClaims = FORMATS.filter(([k]) => !committing[k]).map(([k, format]) => (k === 'spdx3'
  ? { format, refusal: 'not-reproducible', detail: `syft ${sources.syft.version} (${sources.syft.outputs.spdx3}) orders the @graph and numbers the local identifiers of its SPDX 3.0.1 document differently on each run of the same tree, so its bytes are validated and counted but cannot be committed as a reproducible projection` }
  : { format, refusal: 'not-committed', detail: `${format} is reproducible and each document is addressed by its sha256 and size, which --check re-derives, but its bytes are not committed: ${sources.syft.notCommitted[k]}` }));

// A package is a repository's own when its manifest is in that repository and names it as its repository.
// A manifest in A that names B is a copy of B's package inside A.
const homes = new Map();
const own = repositories.map(() => new Set());
// Every name a repository declares, its own, a copy or unlinked: a dependency on it resolves inside the repository.
const declared = manifests.map((m) => new Set(m.packages.map((p) => `${p.ecosystem}\t${keyOf(p.ecosystem, p.name)}`)));
const edges = new Map();
const edge = (from, to, kind, evidence) => {
  if (from === to) return;
  const k = `${from}\t${to}\t${kind}`;
  if (!edges.has(k)) edges.set(k, { from: pins[from].name, to: pins[to].name, kind, evidence: [] });
  edges.get(k).evidence.push(evidence);
};
const outside = new Map();
const cite = (evidence) => `${evidence.slice(0, 3).join(', ')}${evidence.length > 3 ? `, and ${evidence.length - 3} more` : ''}`;
const outsideRef = (from, name, evidence) => {
  const k = `${from}\t${name}`;
  if (!outside.has(k)) outside.set(k, []);
  outside.get(k).push(evidence);
};
const packages = [];
manifests.forEach((m, a) => {
  let unlinked = 0;
  for (const p of m.packages) {
    const linked = foundationRepo(p.repository);
    const b = linked ? byName.get(linked.toLowerCase()) : undefined;
    if (!linked) { if (!p.private) unlinked += 1; continue; }
    if (b === undefined) { outsideRef(a, linked, p.evidence); continue; }
    if (b !== a) { edge(a, b, 'vendored', p.evidence); continue; }
    const key = `${p.ecosystem}\t${keyOf(p.ecosystem, p.name)}`;
    own[a].add(key);
    if (!homes.has(key)) homes.set(key, new Set());
    homes.get(key).add(a);
    if (!packages.some((q) => q.repository === a && q.ecosystem === p.ecosystem && keyOf(p.ecosystem, q.name) === keyOf(p.ecosystem, p.name))) packages.push({ repository: a, ecosystem: p.ecosystem, name: p.name, evidence: p.evidence, private: p.private });
  }
  if (unlinked > 0) refuse(a, 'packages-unlinked', `${pins[a].name}: ${unlinked} manifests declare a package for publication without naming the UOR-Foundation repository it is published from, so no registry entry can be verified as the Foundation's`);
});
const ambiguous = new Map();
const images = new Map();
manifests.forEach((m, a) => {
  for (const dep of m.dependencies) {
    const key = `${dep.ecosystem}\t${keyOf(dep.ecosystem, dep.name)}`;
    if (declared[a].has(key) || !homes.has(key)) continue;
    const from = [...homes.get(key)];
    if (from.length === 1) edge(a, from[0], 'package', dep.evidence);
    else { const k = `${a}\t${key}`; if (!ambiguous.has(k)) ambiguous.set(k, { a, dep, from }); }
  }
  for (const r of m.references) {
    if (!r.repo) continue;
    const b = byName.get(r.repo.toLowerCase());
    if (b === undefined) outsideRef(a, r.repo, r.evidence);
    else edge(a, b, r.kind, r.evidence);
  }
  for (const i of m.images) {
    const known = registries.images.find((x) => x.image === i.image);
    if (!known) throw new Error(`supply/registries.json does not hold the image ${i.image}; re-snapshot the registries`);
    const src = foundationRepo(known.source);
    const b = src ? byName.get(src.toLowerCase()) : undefined;
    if (b === undefined) images.set(`${a}\t${i.image}`, [...(images.get(`${a}\t${i.image}`) ?? []), i.evidence]);
    else edge(a, b, 'image', i.evidence);
  }
  for (const f of m.foreignImages) refuse(a, 'sdk-image-outside-foundation', `${pins[a].name}: ${f.evidence} pins the SDK image ${f.image.split('@')[0]}, which is not published under ghcr.io/uor-foundation`);
  for (const u of m.unreadable) refuse(a, 'manifest-unreadable', `${pins[a].name}: ${u}`);
});
for (const { a, dep, from } of [...ambiguous.values()]) refuse(a, 'package-ambiguous', `${pins[a].name}: ${dep.evidence} depends on ${dep.ecosystem} ${dep.name}, which ${from.map((i) => pins[i].name).join(' and ')} each declare as their own`);
for (const [k, evidence] of outside) {
  const [a, name] = k.split('\t');
  refuse(Number(a), 'reference-outside-register', `${pins[a].name}: ${evidence.length} references to UOR-Foundation/${name}, which is not a public repository of the ecosystem register (${cite(evidence)})`);
}
for (const [k, evidence] of images) {
  const [a, image] = k.split('\t');
  const known = registries.images.find((x) => x.image === image);
  const why = known.status === 200 ? `its OCI source annotation names ${known.source || 'nothing'}` : `ghcr.io serves no manifest for ${known.reference}`;
  refuse(Number(a), 'image-source-undeclared', `${pins[a].name}: ${evidence.length} references to ghcr.io/uor-foundation/${image}, and ${why}, so the repository it is built from is not declared (${cite(evidence)})`);
}
refusals.sort((x, y) => x.repository - y.repository || (x.refusal < y.refusal ? -1 : x.refusal > y.refusal ? 1 : 0) || (x.detail < y.detail ? -1 : 1));

// What each registry publishes under each of the Foundation's own package names. A dependent is external when
// no Foundation manifest declares a crate of its name.
const foundation = new Set(manifests.flatMap((m) => m.packages.filter((q) => q.ecosystem === 'cargo').map((q) => keyOf('cargo', q.name))));
const listOf = { cargo: registries.crates, npm: registries.npm, pypi: registries.pypi };
const packageClaims = [];
packages.sort((x, y) => x.repository - y.repository || (x.ecosystem < y.ecosystem ? -1 : x.ecosystem > y.ecosystem ? 1 : 0) || (x.name < y.name ? -1 : 1));
const packageRecords = packages.map((p, index) => {
  const entry = listOf[p.ecosystem].find((e) => e.name === p.name);
  if (!entry) throw new Error(`supply/registries.json does not hold ${p.ecosystem} ${p.name}; re-snapshot the registries`);
  const home = pins[p.repository].name;
  const linked = entry.status === 200 && foundationRepo(entry.repository).toLowerCase() === home.toLowerCase();
  const registry = entry.status === 404 ? 'absent' : linked ? 'published' : entry.status === 200 ? 'elsewhere' : 'unread';
  const where = { cargo: 'crates.io', npm: 'the npm registry', pypi: 'PyPI' }[p.ecosystem];
  if (registry === 'absent' && !p.private) packageClaims.push({ package: index, refusal: 'unpublished', detail: `${p.ecosystem} ${p.name} (${p.evidence}) is declared for publication and ${where} has no package of that name` });
  if (registry === 'elsewhere') {
    const other = foundationRepo(entry.repository);
    const refusal = other ? 'published-from-other-repository' : p.private ? 'private-name-held-elsewhere' : 'name-held-elsewhere';
    packageClaims.push({ package: index, refusal, detail: `${where} publishes ${p.name}${entry.repository ? ` from ${entry.repository}` : ' naming no repository'}, not from UOR-Foundation/${home} where ${p.evidence} declares it${p.private ? ' private' : ''}` });
  }
  if (registry === 'unread') packageClaims.push({ package: index, refusal: 'registry-unread', detail: `${where} answered ${entry.status} for ${p.name}` });
  const crates = p.ecosystem === 'cargo' && linked;
  return {
    index,
    repository: home,
    ecosystem: p.ecosystem,
    name: p.name,
    evidence: p.evidence,
    private: p.private,
    registry,
    version: linked ? entry.maxVersion ?? entry.latest ?? entry.version ?? '' : '',
    downloads: linked && p.ecosystem === 'cargo' ? { count: entry.downloads, window: 'all-time' } : linked && p.ecosystem === 'npm' && entry.downloadsLastMonth !== null ? { count: entry.downloadsLastMonth, window: 'last-month' } : null,
    // crates.io is the only one of the three registries that publishes reverse dependencies.
    externalDependents: crates ? entry.dependents.filter((n) => !foundation.has(keyOf('cargo', n))) : null,
  };
});

const edgeList = [...edges.values()].sort((x, y) => (x.from.toLowerCase() < y.from.toLowerCase() ? -1 : x.from.toLowerCase() > y.from.toLowerCase() ? 1 : 0) || (x.to.toLowerCase() < y.to.toLowerCase() ? -1 : x.to.toLowerCase() > y.to.toLowerCase() ? 1 : 0) || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
// Every committed SBOM byte, in every format.
const sbomBytes = repositories.reduce((n, r) => n + r.serializations.reduce((m, x) => m + (x.path ? x.bytes : 0), 0), 0);
const register = {
  spec: 'uor-community/supply-register/1',
  snapshot: { path: 'supply/snapshot.json', sha256: sha256(snapshotBytes) },
  ecosystem: { path: 'ecosystem/snapshot.json', sha256: sha256(ecosystemBytes) },
  registries: { path: 'supply/registries.json', sha256: sha256(registriesBytes), fetchedAt: registries.fetchedAt },
  tools: {
    syft: { version: sources.syft.version, gitCommit: sources.syft.gitCommit, url: sources.syft.url, sha256: sources.syft.sha256, checksumsSha256: sources.syft.checksums.sha256, binarySha256: syft.digest, args: sources.syft.args, outputs: sources.syft.outputs, config: { path: sources.syft.config, sha256: sha256(readFileSync(syftConfig)) } },
    ajv: { version: ajvVersion, ajvFormats: formatsVersion, dialects: Object.fromEntries(FORMATS.map(([k, format]) => [format, { dialect: validators[k].dialect, formatsNotAsserted: validators[k].formatsNotAsserted }])) },
    spdxTools: { version: pyspdx.version, requirements: sources.validator.spdxTools.requirements, requirementsSha256: pyspdx.requirementsSha256 },
  },
  standards: [
    ...Object.entries(cdx.files).map(([path, digest]) => ({ title: cdx.title, path: `${cdx.name}@${cdx.commit}:${path}`, sha256: digest })),
    ...Object.entries(spdx2.files).map(([path, digest]) => ({ title: spdx2.title, path: `${spdx2.name}@${spdx2.commit}:${path}`, sha256: digest })),
    { title: sources.standards.spdx3.title, path: sources.standards.spdx3.url, sha256: sources.standards.spdx3.sha256 },
    ...Object.entries(purl.files).map(([path, digest]) => ({ title: purl.title, path: `${purl.name}@${purl.commit}:${path}`, sha256: digest })),
  ],
  purlTypes,
  sbomBytes,
  componentTotal: repositories.reduce((n, r) => n + r.components, 0),
  repositories,
  edges: edgeList,
  packages: packageRecords,
  refusals,
  packageClaims,
  formatClaims,
};
const text = `${JSON.stringify(register, null, 2)}\n`;
const target = join(here, 'register.json');
if (check) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) stale.push('supply/register.json');
  if (stale.length) {
    process.stderr.write(`not the projection of the pinned sources: ${stale.join(', ')}\n`);
    process.exit(1);
  }
} else writeFileSync(target, text);
process.stdout.write(`${repositories.length} repositories, ${register.componentTotal} components, ${edgeList.length} edges, ${packageRecords.length} packages, ${refusals.length + packageClaims.length + formatClaims.length} open claims, committed SBOMs ${sbomBytes} bytes\n`);
