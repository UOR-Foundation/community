#!/usr/bin/env node
/**
 * Project the supply register of the whole Foundation from its pinned sources.
 *
 * For every repository of supply/snapshot.json, checked out at its pinned commit, Anchore syft (pinned by
 * version and download digest) writes a CycloneDX 1.6 JSON SBOM, which Ajv validates against the official
 * CycloneDX 1.6 schema read from git at the pinned commit. The SBOM's two run-dependent values are fixed
 * so the same tree always gives the same bytes: serialNumber becomes the RFC 9562 name-based (v5) UUID of
 * `<repository url>@<commit>` in the URL namespace, and metadata.timestamp the commit's committer time.
 * Each SBOM is counted by Package-URL type (checked against the purl-spec type index) and by declared
 * license (CycloneDX licenseChoice: an SPDX id, a name, or an SPDX expression).
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
 *   node supply/project.mjs <sources-dir> [--check]
 *
 * <sources-dir> holds each repository and standard checked out at its pinned commit under its name.
 * syft is fetched into <sources-dir>/.supply-tools when it is not there at its pinned digest.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readManifests, foundationRepo, keyOf } from './manifests.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const [dir, flag] = process.argv.slice(2);
if (!dir) {
  process.stderr.write('usage: project.mjs <sources-dir> [--check]\n');
  process.exit(64);
}
const check = flag === '--check';
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

// Ajv, as JSON Schema draft-07 (the schema's $schema). Unknown keywords are ignored, as draft-07 requires;
// formats ajv-formats does not implement are annotations only, and are named in the register.
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajvVersion = json(require.resolve('ajv/package.json')).version;
const formatsVersion = json(require.resolve('ajv-formats/package.json')).version;
const ajv = new Ajv({ strict: false, allErrors: false, logger: false, validateFormats: true });
addFormats(ajv);
const schemaText = Object.keys(cdx.files).map((p) => [p, cdxFile(p)]);
for (const [, text] of schemaText) ajv.addSchema(JSON.parse(text));
const validate = ajv.getSchema(JSON.parse(cdxFile(cdx.schema)).$id);
const asserted = new Set(Object.keys(require('ajv-formats/dist/formats').fullFormats));
const formatsNotAsserted = [...new Set(schemaText.flatMap(([, t]) => [...t.matchAll(/"format"\s*:\s*"([^"]+)"/g)].map((m) => m[1])))].filter((f) => !asserted.has(f)).sort();

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
const repositories = pins.map((pin, index) => {
  const d = join(dir, pin.name);
  const at = headOf(d);
  if (at !== pin.commit) throw new Error(`${pin.name} is at ${at}, not the pinned ${pin.commit}`);
  const raw = run(syft.bin, [`dir:.`, ...sources.syft.args], { cwd: d });
  const committed = Number(run('git', ['-C', d, 'show', '-s', '--format=%ct', 'HEAD']).trim());
  const timestamp = new Date(committed * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  // The two values syft draws from the run, replaced in syft's own bytes so its layout is kept.
  const serial = `urn:uuid:${uuidV5(`${pin.url}@${pin.commit}`)}`;
  let text = raw.replace(/("serialNumber":\s*")urn:uuid:[0-9a-f-]+(")/, `$1${serial}$2`).replace(/("metadata":\s*\{\s*"timestamp":\s*")[^"]+(")/, `$1${timestamp}$2`);
  if (!text.endsWith('\n')) text += '\n';
  const bom = JSON.parse(text);
  if (bom.serialNumber !== serial || bom.metadata?.timestamp !== timestamp) throw new Error(`${pin.name}: syft's serialNumber or timestamp was not where CycloneDX puts it`);
  const valid = validate(bom) && bom.bomFormat === 'CycloneDX' && bom.specVersion === '1.6';
  const file = `supply/sboms/${pin.name}.cdx.json`;
  const target = join(root, file);
  if (valid) {
    if (check) { if (!existsSync(target) || readFileSync(target, 'utf8') !== text) stale.push(file); }
    else writeFileSync(target, text);
  } else {
    refuse(index, 'sbom-invalid', `${pin.name}: syft's SBOM does not validate against ${cdx.schema}: ${ajv.errorsText(validate.errors)}`);
  }
  const all = [];
  const walk = (cs) => { for (const c of cs ?? []) { all.push(c); walk(c.components); } };
  walk(bom.components);
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
  return {
    index,
    name: pin.name,
    commit: pin.commit,
    sbom: valid ? { path: file, sha256: sha256(text), bytes: Buffer.byteLength(text) } : null,
    components: all.length,
    purlTypes: Object.fromEntries(Object.entries(purlTypeCounts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    licensedComponents: licensed,
    licenseEntries,
    licenses: Object.entries(licenses).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, count]) => { const [form, license] = k.split('\t'); return { form, license, count }; }),
  };
});
if (check) for (const f of readdirSync(sbomDir)) if (!repositories.some((r) => r.sbom && r.sbom.path === `supply/sboms/${f}`)) stale.push(`supply/sboms/${f}`);

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
const sbomBytes = repositories.reduce((n, r) => n + (r.sbom?.bytes ?? 0), 0);
const register = {
  spec: 'uor-community/supply-register/1',
  snapshot: { path: 'supply/snapshot.json', sha256: sha256(snapshotBytes) },
  ecosystem: { path: 'ecosystem/snapshot.json', sha256: sha256(ecosystemBytes) },
  registries: { path: 'supply/registries.json', sha256: sha256(registriesBytes), fetchedAt: registries.fetchedAt },
  tools: {
    syft: { version: sources.syft.version, gitCommit: sources.syft.gitCommit, url: sources.syft.url, sha256: sources.syft.sha256, checksumsSha256: sources.syft.checksums.sha256, binarySha256: syft.digest, args: sources.syft.args },
    ajv: { version: ajvVersion, ajvFormats: formatsVersion, dialect: 'http://json-schema.org/draft-07/schema#', formatsNotAsserted },
  },
  standards: [
    ...Object.entries(cdx.files).map(([path, digest]) => ({ path: `${cdx.name}@${cdx.commit}:${path}`, sha256: digest })),
    ...Object.entries(purl.files).map(([path, digest]) => ({ path: `${purl.name}@${purl.commit}:${path}`, sha256: digest })),
  ],
  purlTypes,
  sbomBytes,
  componentTotal: repositories.reduce((n, r) => n + r.components, 0),
  repositories,
  edges: edgeList,
  packages: packageRecords,
  refusals,
  packageClaims,
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
process.stdout.write(`${repositories.length} repositories, ${register.componentTotal} components, ${edgeList.length} edges, ${packageRecords.length} packages, ${refusals.length + packageClaims.length} open claims, SBOMs ${sbomBytes} bytes\n`);
