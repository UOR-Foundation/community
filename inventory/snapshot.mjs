#!/usr/bin/env node
/**
 * Observe the Foundation's assets into inventory/snapshot.json: what each pinned
 * repository's publishing files and the website name (read.mjs), and what the
 * public authorities answer about each of them now: GitHub's repository
 * homepage, RDAP (RFC 9083, through the IANA RFC 9224 bootstrap) and DNS for
 * every Foundation host, crates.io, npm and PyPI for every published package,
 * the OCI Distribution API for every container image, an HTTP GET for every
 * service URL, and Discord for every invite. The standards that define the
 * types and values the register uses are fetched at their pinned versions and
 * addressed by sha256. Only fields the register reads are kept, and every list
 * is sorted, so a snapshot changes only when what it observes does.
 *
 * Only public, unauthenticated, read-only requests are made. No secret and no
 * access right is observed: those belong to the security register.
 *
 *   node inventory/snapshot.mjs <clones-dir> [--check]
 *
 * <clones-dir> holds every repository of sources.json, by name, holding its
 * pinned commit (a blob-less clone is enough). --check observes again and fails
 * when anything but the observation time differs.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkout, readWebsite, readRepository, publicSuffixList, isSemver, semverCompare, licenseIds, sha256, foundationHosts } from './read.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'));
const sources = read('sources.json');
const declared = read('declared.json');
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: snapshot.mjs <clones-dir> [--check]\n');
  process.exit(64);
}
const observedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const UA = { 'User-Agent': 'uor-community-inventory/1 (read-only)' };
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, headers = {}, init = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { ...UA, ...headers }, ...init });
      if (res.status >= 500 && attempt < 2) { await pause(1000 * (attempt + 1)); continue; }
      return res;
    } catch (e) {
      if (attempt >= 2) throw new Error(`${url}: ${e.message}`);
      await pause(1000 * (attempt + 1));
    }
  }
}
async function bytes(url) {
  const res = await get(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
const json = async (url, headers) => { const res = await get(url, headers); return { status: res.status, body: res.ok ? await res.json() : null, res }; };

// ---- Standards, at their pinned versions.
const S = sources.standards;
const schemaTypes = await bytes(S.schemaOrg.types);
const schemaProperties = await bytes(S.schemaOrg.properties);
const schemaNames = (b) => new Set(b.toString('utf8').split('\n').slice(1).map((l) => l.split(',')[0].replace(/^"|"$/g, '').replace('https://schema.org/', '')).filter(Boolean));
const types = schemaNames(schemaTypes);
const properties = schemaNames(schemaProperties);
const spdxLicenses = await bytes(S.spdx.licenses);
const spdxExceptions = await bytes(S.spdx.exceptions);
const licenseList = JSON.parse(spdxLicenses.toString('utf8'));
const exceptionList = JSON.parse(spdxExceptions.toString('utf8'));
const spdxIds = new Set([...licenseList.licenses.map((l) => l.licenseId), ...exceptionList.exceptions.map((e) => e.licenseExceptionId)]);
const pslBytes = await bytes(S.publicSuffix.list);
const psl = publicSuffixList(pslBytes.toString('utf8'));
const bootstrapBytes = await bytes(S.rdapBootstrap.url);
const bootstrap = JSON.parse(bootstrapBytes.toString('utf8'));
const valuesBytes = await bytes(S.rdapValues.url);
const rdapValues = [...valuesBytes.toString('utf8').matchAll(/<record[^>]*>\s*<value>([^<]+)<\/value>\s*<type>([^<]+)<\/type>/g)].map((m) => ({ value: m[1].trim(), type: m[2].trim() }));
const registered = (type, value) => rdapValues.some((v) => v.type === type && v.value === value);

// ---- What the pinned repositories name.
const pin = (name) => sources.repositories.find((r) => r.repository === name);
for (const c of sources.checkouts) if (pin(c.name).commit !== c.commit) throw new Error(`${c.name} is pinned at two commits`);
const repositories = sources.repositories.map((p) => readRepository(checkout(root, p.repository, p.commit)));
const site = readWebsite(checkout(root, sources.website, pin(sources.website).commit));

// ---- Every quote declared.json rests on must occur in its file at the pinned commit.
const quoted = [declared.foundation, ...declared.platformHosts, ...declared.services, ...declared.relationships].flatMap((d) => d.evidence);
const evidence = new Map();
for (const q of quoted) {
  const p = pin(q.repository);
  if (!p) throw new Error(`declared.json quotes ${q.repository}, which sources.json does not pin`);
  const blob = checkout(root, q.repository, p.commit).blob(q.path);
  if (!blob.toString('utf8').includes(q.quote)) throw new Error(`${q.repository}@${p.commit}:${q.path} does not say: ${q.quote}`);
  evidence.set(`${q.repository}:${q.path}`, { repository: q.repository, commit: p.commit, path: q.path, sha256: sha256(blob) });
}

// ---- GitHub: each repository's homepage, as its REST resource states it.
const github = [];
for (const r of repositories) {
  const { status, body } = await json(`https://api.github.com/repos/${sources.owner}/${r.name}`, { Accept: 'application/vnd.github+json' });
  github.push({ repository: r.name, status, homepage: body?.homepage ?? '' });
}

// ---- Published packages.
const packages = [];
const owners = await json(`${sources.registries.crates.api}crates/${sources.registries.crates.ownersOf}/owners`);
const crateNames = new Map();
for (const user of (owners.body?.users ?? []).sort((a, b) => a.id - b.id)) {
  for (let page = 1; ; page += 1) {
    const listing = await json(`${sources.registries.crates.api}crates?user_id=${user.id}&per_page=100&page=${page}`);
    for (const c of listing.body.crates) if (!crateNames.has(c.name)) crateNames.set(c.name, `owner:${user.login}`);
    if (listing.body.crates.length < 100) break;
    await pause(1000);
  }
}
const npmOrg = await json(`${sources.registries.npm.api}-/org/${sources.registries.npm.organization}/package`);
const npmNames = new Map(Object.keys(npmOrg.body ?? {}).sort(byKey).map((n) => [n, `organization:${sources.registries.npm.organization}`]));
const pypiNames = new Map();
for (const i of site.installs) {
  const into = { 'crates.io': crateNames, npm: npmNames, pypi: pypiNames }[i.registry];
  if (!into.has(i.name)) into.set(i.name, `install:${i.repository}/${i.path}`);
}
for (const [name, origin] of [...crateNames].sort(([a], [b]) => byKey(a, b))) {
  await pause(1000);
  const { status, body } = await json(`${sources.registries.crates.api}crates/${name}`);
  const latest = body ? body.versions.find((v) => v.num === body.crate.max_version) : null;
  await pause(1000);
  const who = status === 200 ? await json(`${sources.registries.crates.api}crates/${name}/owners`) : { body: { users: [] } };
  packages.push({ registry: 'crates.io', name, origin, status, version: body?.crate.max_version ?? '', license: latest?.license ?? '', repository: body?.crate.repository ?? '', homepage: body?.crate.homepage ?? '', owners: who.body.users.map((u) => u.login).sort(byKey) });
}
for (const [name, origin] of [...npmNames].sort(([a], [b]) => byKey(a, b))) {
  const { status, body } = await json(`${sources.registries.npm.api}${name.replace('/', '%2f')}`);
  const version = body?.['dist-tags']?.latest ?? '';
  const meta = body?.versions?.[version] ?? {};
  const repo = meta.repository ?? body?.repository ?? '';
  packages.push({ registry: 'npm', name, origin, status, version, license: typeof meta.license === 'string' ? meta.license : '', repository: typeof repo === 'string' ? repo : repo.url ?? '', homepage: meta.homepage ?? '', owners: (body?.maintainers ?? []).map((m) => m.name).sort(byKey) });
}
for (const [name, origin] of [...pypiNames].sort(([a], [b]) => byKey(a, b))) {
  const { status, body } = await json(`${sources.registries.pypi.api}${name}/json`);
  const urls = Object.values(body?.info?.project_urls ?? {}).filter((u) => typeof u === 'string').sort(byKey);
  packages.push({ registry: 'pypi', name, origin, status, version: body?.info?.version ?? '', license: body?.info?.license_expression ?? '', repository: urls.find((u) => /github\.com\//i.test(u)) ?? '', homepage: body?.info?.home_page ?? '', owners: [] });
}
for (const p of packages) p.spdx = p.license ? licenseIds(p.license).every((id) => spdxIds.has(id) || /^(LicenseRef|DocumentRef)-/.test(id)) : false;

// ---- Container images the workflows name.
const images = [];
const named = new Map();
for (const r of repositories) for (const i of r.images) named.set(i.image, [...(named.get(i.image) ?? []), r.name]);
const ACCEPT = 'application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json';
for (const [image, namedBy] of [...named].sort(([a], [b]) => byKey(a, b))) {
  const repo = `${sources.registries.ghcr.namespace.replace(/^ghcr\.io\//, '')}/${image}`;
  const token = (await json(`https://ghcr.io/token?scope=repository:${repo}:pull`)).body?.token ?? '';
  const auth = { Authorization: `Bearer ${token}` };
  const tags = await json(`${sources.registries.ghcr.api}${repo}/tags/list?n=10000`, auth);
  const entry = { image, namedBy: [...new Set(namedBy)].sort(byKey), status: tags.status, tag: '', source: '', revision: '', licenses: '' };
  const versions = (tags.body?.tags ?? []).filter(isSemver).sort(semverCompare);
  if (versions.length) {
    entry.tag = versions[versions.length - 1];
    let manifest = (await json(`${sources.registries.ghcr.api}${repo}/manifests/${entry.tag}`, { ...auth, Accept: ACCEPT })).body;
    const annotations = { ...(manifest?.annotations ?? {}) };
    if (manifest?.manifests) manifest = (await json(`${sources.registries.ghcr.api}${repo}/manifests/${manifest.manifests[0].digest}`, { ...auth, Accept: ACCEPT })).body;
    Object.assign(annotations, manifest?.annotations ?? {});
    if (manifest?.config) Object.assign(annotations, (await json(`${sources.registries.ghcr.api}${repo}/blobs/${manifest.config.digest}`, auth)).body?.config?.Labels ?? {});
    entry.source = annotations['org.opencontainers.image.source'] ?? '';
    entry.revision = annotations['org.opencontainers.image.revision'] ?? '';
    entry.licenses = annotations['org.opencontainers.image.licenses'] ?? '';
  }
  images.push(entry);
}

// ---- Foundation hosts: DNS for each, RDAP and NS for each registrable domain.
const referenced = [...site.hosts, ...repositories.flatMap((r) => r.hosts),
  ...declared.services.filter((d) => d.url).map((d) => ({ host: new URL(d.url).hostname, repository: d.evidence[0].repository, path: d.evidence[0].path })),
  ...github.filter((g) => g.homepage).map((g) => ({ host: new URL(g.homepage).hostname, repository: g.repository, path: 'homepage' })),
  ...packages.flatMap((p) => [p.homepage, p.repository].filter((u) => /^https?:\/\//.test(u)).map((u) => ({ host: new URL(u).hostname, repository: `${p.registry}/${p.name}`, path: 'homepage' })))];
const hosts = foundationHosts({ psl, cname: site.cname, owner: sources.owner, pagesSuffix: S.githubPages.suffix, platform: declared.platformHosts, cnames: repositories.flatMap((r) => r.cnames), referenced });
const TYPES = { A: 1, NS: 2, CNAME: 5, AAAA: 28 };
async function dns(name, type) {
  const { status, body } = await json(`${S.dns.url}?name=${encodeURIComponent(name)}&type=${type}`);
  if (status !== 200) throw new Error(`DNS ${name} ${type} answered ${status}`);
  return { rcode: body.Status, data: (body.Answer ?? []).filter((a) => a.type === TYPES[type] && a.name.replace(/\.$/, '') === name).map((a) => a.data.replace(/\.$/, '').toLowerCase()).sort(byKey) };
}
const hostObservations = [];
for (const h of hosts) {
  const a = await dns(h.host, 'A');
  hostObservations.push({ ...h, icann: psl.icann(h.host), site: psl.all(h.host), rcode: a.rcode, a: a.data, aaaa: (await dns(h.host, 'AAAA')).data, cname: (await dns(h.host, 'CNAME')).data });
}
const rdapService = (domain) => {
  const labels = domain.split('.');
  let best = null;
  for (const [entries, urls] of bootstrap.services) for (const e of entries) {
    const l = e.toLowerCase().split('.');
    if (labels.slice(-l.length).join('.') === l.join('.') && (!best || l.length > best.length)) best = { length: l.length, url: urls.find((u) => u.startsWith('https://')) ?? urls[0] };
  }
  return best?.url ?? '';
};
const domains = [];
for (const domain of [...new Set(hostObservations.map((h) => h.icann).filter(Boolean))].sort(byKey)) {
  const server = rdapService(domain);
  const res = server ? await json(`${server.replace(/\/?$/, '/')}domain/${domain}`, { Accept: 'application/rdap+json' }) : { status: 0, body: null };
  const b = res.body ?? {};
  const registrar = (b.entities ?? []).find((e) => (e.roles ?? []).includes('registrar'));
  const fn = registrar?.vcardArray?.[1]?.find((p) => p[0] === 'fn')?.[3] ?? '';
  const events = (b.events ?? []).map((e) => ({ action: e.eventAction, date: e.eventDate })).sort((x, y) => byKey(x.action, y.action));
  domains.push({
    domain, server, status: res.status, registrar: fn,
    expiration: events.find((e) => e.action === 'expiration')?.date ?? '',
    statuses: [...(b.status ?? [])].sort(byKey),
    nameservers: (b.nameservers ?? []).map((n) => n.ldhName.toLowerCase().replace(/\.$/, '')).sort(byKey),
    ns: (await dns(domain, 'NS')).data,
    registered: events.every((e) => registered('event action', e.action)) && (b.status ?? []).every((s) => registered('status', s)),
  });
}

// ---- Services: one GET each, redirects not followed.
const http = [];
for (const url of [...new Set(declared.services.map((s) => s.url).filter(Boolean))].sort(byKey)) {
  let status = 0;
  let location = '';
  try {
    const res = await get(url, {}, { redirect: 'manual' });
    status = res.status;
    location = res.headers.get('location') ?? '';
    await res.arrayBuffer();
  } catch { status = 0; }
  http.push({ url, status, location });
}

// ---- Discord invites the website links to.
const invites = [];
const codes = new Map([...site.invites, ...repositories.flatMap((r) => r.invites)].map((i) => [i.code, i]));
for (const i of [...codes.values()].sort((a, b) => byKey(a.code, b.code))) {
  const { status, body } = await json(`${sources.registries.discord.api}${i.code}`);
  invites.push({ code: i.code, status, guild: body?.guild?.id ?? '' });
}

const used = (set, names) => Object.fromEntries([...names].sort(byKey).map((n) => [n, set.has(n)]));
const snapshot = {
  spec: 'uor-community/inventory-snapshot/1',
  observedAt,
  standards: {
    schemaOrg: { version: S.schemaOrg.version, types: { url: S.schemaOrg.types, sha256: sha256(schemaTypes) }, properties: { url: S.schemaOrg.properties, sha256: sha256(schemaProperties) },
      typesUsed: used(types, declared.schema.types), propertiesUsed: used(properties, declared.schema.properties) },
    spdx: { version: licenseList.licenseListVersion, licenses: { url: S.spdx.licenses, sha256: sha256(spdxLicenses) }, exceptions: { url: S.spdx.exceptions, sha256: sha256(spdxExceptions) } },
    publicSuffix: { url: S.publicSuffix.list, sha256: sha256(pslBytes) },
    rdapBootstrap: { url: S.rdapBootstrap.url, sha256: sha256(bootstrapBytes), publication: bootstrap.publication },
    rdapValues: { url: S.rdapValues.url, sha256: sha256(valuesBytes) },
  },
  evidence: [...evidence.values()].sort((a, b) => byKey(`${a.repository}:${a.path}`, `${b.repository}:${b.path}`)),
  website: { repository: sources.website, commit: pin(sources.website).commit, ...site },
  repositories,
  github,
  hosts: hostObservations,
  domains,
  packages,
  images,
  http,
  invites,
};
const text = `${JSON.stringify(snapshot, null, 1)}\n`;
const target = join(here, 'snapshot.json');
if (flag === '--check') {
  const strip = (t) => t.replace(/\n "observedAt": "[^"]*",/, '');
  if (!existsSync(target) || strip(readFileSync(target, 'utf8')) !== strip(text)) {
    process.stderr.write('inventory/snapshot.json differs from what the authorities answer now; re-snapshot and re-project\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
process.stdout.write(`${repositories.length} repositories, ${hostObservations.length} hosts, ${domains.length} registrable domains, ${packages.length} packages, ${images.length} images, ${http.length} service URLs, ${invites.length} invites\n`);
