#!/usr/bin/env node
/**
 * Project the Foundation asset register from its pinned sources and its snapshot.
 *
 * Every asset gets one stable id, its Schema.org class and, where a source
 * states one, its SPDX license: the Foundation itself (org:), its repositories
 * (repo:, read by reference from ecosystem/register.json), its community spaces
 * (community:, chat:), the hosts it serves or runs on (domain:), the packages
 * and container images it publishes (package:), the public services it
 * provides (service:), the organizations its sources name (org:), and its
 * brand and legal documents (document:). Ids are sorted, so an id's rank among
 * all ids is its position, and a repeated id cannot be numbered.
 *
 * Nothing is defaulted. A package, image, service or document that does not
 * resolve to a repository of the register, a service with no observable
 * deployment, a host that does not resolve, a registrable domain RDAP does not
 * answer for or whose registration ends within the window, an install
 * instruction that names an unpublished package, an image that is not public
 * or has no released version, a relationship whose relation the source does
 * not state, a document whose bytes are not the ones its lock records, and a
 * repository whose homepage GitHub did not answer for, are each a typed
 * refusal carried into the register as an open claim. The same sources and
 * snapshot always project the same bytes.
 *
 *   node inventory/project.mjs <checkouts-dir> [--check]
 *
 * <checkouts-dir> holds every `checkouts` repository of sources.json, by name.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkout, readWebsite, licenseIds, sha256 } from './read.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const file = (path) => { const bytes = readFileSync(join(repoRoot, path)); return { path, bytes, sha256: sha256(bytes), json: () => JSON.parse(bytes.toString('utf8')) }; };
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <checkouts-dir> [--check]\n');
  process.exit(64);
}
const sourcesFile = file('inventory/sources.json');
const declaredFile = file('inventory/declared.json');
const snapshotFile = file('inventory/snapshot.json');
const ecosystemFile = file('ecosystem/register.json');
const discordPolicyFile = file('governance/discord.json');
const guildFile = file('observations/responses/discord/guild.json');
const sources = sourcesFile.json();
const declared = declaredFile.json();
const snapshot = snapshotFile.json();
const ecosystem = ecosystemFile.json();
const guild = guildFile.json();
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- The checkouts, at their pins, agree with what the snapshot observed.
const checkouts = Object.fromEntries(sources.checkouts.map((c) => [c.name, checkout(root, c.name, c.commit)]));
const site = readWebsite(checkouts[sources.website]);
for (const key of ['cname', 'hosts', 'installs', 'invites']) {
  if (JSON.stringify(site[key]) !== JSON.stringify(snapshot.website[key])) throw new Error(`the website's ${key} differ from inventory/snapshot.json; re-snapshot`);
}
if (sources.repositories.map((p) => p.repository).join() !== ecosystem.repositories.map((r) => r.name).join()) {
  throw new Error('inventory/sources.json does not pin exactly the repositories of ecosystem/register.json, in its order');
}
for (const p of sources.repositories) {
  const seen = snapshot.repositories.find((r) => r.name === p.repository);
  if (!seen || seen.commit !== p.commit) throw new Error(`inventory/snapshot.json did not read ${p.repository} at ${p.commit}; re-snapshot`);
}
for (const e of snapshot.evidence) {
  const c = checkouts[e.repository];
  if (c && sha256(c.blob(e.path)) !== e.sha256) throw new Error(`${e.repository}:${e.path} is not the file the snapshot quoted`);
}
const quoted = (d) => d.evidence.map((q) => {
  const e = snapshot.evidence.find((x) => x.repository === q.repository && x.path === q.path);
  if (!e) throw new Error(`no snapshot evidence for ${q.repository}:${q.path}`);
  if (checkouts[q.repository] && !checkouts[q.repository].text(q.path).includes(q.quote)) throw new Error(`${q.repository}:${q.path} does not say: ${q.quote}`);
  return `${e.repository}@${e.commit}:${e.path}#sha256:${e.sha256}`;
}).join(' ');
for (const [name, ok] of Object.entries({ ...snapshot.standards.schemaOrg.typesUsed, ...snapshot.standards.schemaOrg.propertiesUsed })) {
  if (!ok) throw new Error(`Schema.org ${snapshot.standards.schemaOrg.version} has no ${name}`);
}

const assets = [];
const refusals = [];
const add = (a) => { assets.push({ license: '', url: '', linkTo: '', needsRepository: false, ...a }); return a.id; };
const refuse = (id, refusal, detail) => refusals.push({ id, refusal, detail });
const repoUrl = (name) => `https://github.com/${sources.owner}/${name}`;
const repoIds = new Map(ecosystem.repositories.map((r) => [r.name.toLowerCase(), `repo:${r.name}`]));
// A source-repository URL names a repository of the register when it is github.com/<owner>/<name>, compared without case.
const repoOf = (url) => {
  const m = String(url).replace(/^git\+/, '').match(/^(?:https?|git|ssh):\/\/(?:git@)?github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!m) return { owner: '', id: '' };
  return { owner: m[1], id: m[1].toLowerCase() === sources.owner.toLowerCase() ? repoIds.get(m[2].toLowerCase()) ?? '' : '' };
};
const spdx = (expression) => (expression && licenseIds(expression).length ? expression : '');

// ---- The Foundation.
const FOUNDATION = add({ id: declared.foundation.id, kind: 'organization', type: 'Organization', name: declared.foundation.name, url: declared.foundation.url, source: quoted(declared.foundation) });

// ---- Repositories, by reference to the ecosystem register.
const ecosystemSource = `${ecosystemFile.path}#sha256:${ecosystemFile.sha256}`;
for (const r of ecosystem.repositories) {
  const id = add({ id: `repo:${r.name}`, kind: 'repository', type: 'SoftwareSourceCode', name: r.name, url: repoUrl(r.name), source: `${ecosystemSource} repositories[${r.index}]` });
  const gh = snapshot.github.find((g) => g.repository === r.name);
  if (!gh || gh.status !== 200) refuse(id, 'homepage-unobserved', `GitHub answered ${gh?.status ?? 'nothing'} for the repository resource, so its homepage is not read`);
}

// ---- Community spaces.
const discordSource = `${guildFile.path}#sha256:${guildFile.sha256} ${discordPolicyFile.path}#sha256:${discordPolicyFile.sha256}`;
const GUILD = add({ id: `chat:discord/${guild.guild}`, kind: 'community', type: 'Service', name: 'UOR Foundation Discord', url: `https://discord.com/channels/${guild.guild}`, source: discordSource });
add({ id: `community:github/${sources.owner}`, kind: 'community', type: 'Organization', name: `${sources.owner} on GitHub`, url: `https://github.com/${sources.owner}`, source: `${sourcesFile.path}#sha256:${sourcesFile.sha256}` });
const communities = [
  { asset: GUILD, platform: 'discord', channels: guild.channels.length, invites: snapshot.invites.map((i) => i.code).join(' ') },
  { asset: `community:github/${sources.owner}`, platform: 'github', channels: 0, invites: '' },
];
for (const i of snapshot.invites) {
  if (i.status !== 200 || i.guild !== guild.guild) refuse(GUILD, 'invite-elsewhere', `the invite ${i.code} answered ${i.status} for guild ${i.guild || 'none'}, not ${guild.guild}`);
}

// ---- Hosts and registrable domains.
const snapshotSource = `${snapshotFile.path}#sha256:${snapshotFile.sha256}`;
const DAY = 86400000;
const domains = [];
for (const h of snapshot.hosts) {
  const id = add({ id: `domain:${h.host}`, kind: 'domain', type: 'WebSite', name: h.host, url: `https://${h.host}/`, source: `${snapshotSource} hosts[${h.host}] from ${h.repository}:${h.path}` });
  const d = snapshot.domains.find((x) => x.domain === h.icann) ?? { server: '', status: 0, registrar: '', expiration: '', nameservers: [], ns: [], registered: false };
  const days = d.expiration ? Math.floor((Date.parse(d.expiration) - Date.parse(snapshot.observedAt)) / DAY) : 0;
  domains.push({
    asset: id, registrable: h.icann, site: h.site, reason: h.reason, rcode: h.rcode, addresses: [...h.a, ...h.aaaa].join(' '), cname: h.cname.join(' '),
    rdapServer: d.server, rdapStatus: d.status, registrar: d.registrar, expiration: d.expiration, expires: Boolean(d.expiration), daysToExpiry: Math.max(days, 0),
    nameservers: d.nameservers.join(' '), valuesRegistered: d.registered,
  });
  if (h.rcode !== 0) refuse(id, 'host-unresolved', `DNS answers RCODE ${h.rcode} for ${h.host}, which ${h.repository}:${h.path} references`);
  if (d.status !== 200) refuse(id, 'rdap-unavailable', d.server ? `RDAP at ${d.server} answered ${d.status} for ${h.icann}` : `the IANA RDAP bootstrap names no service for ${h.icann}`);
  else if (!d.registered) refuse(id, 'rdap-value-unregistered', `${h.icann}: an RDAP event action or status is not in the IANA RDAP JSON Values registry`);
  // A registration is one claim, on the registrable domain's own asset when the Foundation serves it.
  const registration = snapshot.hosts.some((x) => x.host === h.icann) ? `domain:${h.icann}` : id;
  domains[domains.length - 1].registration = registration;
  if (registration === id && d.expiration && days < sources.expiryDays.value) refuse(id, 'registration-expiring', `${h.icann} expires ${d.expiration}, ${days} days after the observation`);
}

// ---- Published packages and container images.
const packages = [];
const excluded = [];
for (const p of snapshot.packages) {
  const { id: linkTo, owner } = repoOf(p.repository);
  const listed = !p.origin.startsWith('install:');
  if (!listed && p.status === 200 && owner.toLowerCase() !== sources.owner.toLowerCase()) {
    excluded.push({ registry: p.registry, name: p.name, origin: p.origin, reason: `published from ${p.repository || 'no stated repository'}, not by the Foundation` });
    continue;
  }
  const id = add({ id: `package:${p.registry}/${p.name}`, kind: 'package', type: 'SoftwareApplication', name: p.name, url: { 'crates.io': `https://crates.io/crates/${p.name}`, npm: `https://www.npmjs.com/package/${p.name}`, pypi: `https://pypi.org/project/${p.name}/` }[p.registry], license: p.spdx ? spdx(p.license) : '', linkTo, needsRepository: true, source: `${snapshotSource} packages[${p.registry}/${p.name}] (${p.origin})` });
  packages.push({ asset: id, registry: p.registry, name: p.name, version: p.version, published: p.status === 200, owners: p.owners.join(' '), origin: p.origin, repository: p.repository });
  if (p.status !== 200) refuse(id, 'install-target-unpublished', `${p.origin.slice(8)} tells a reader to install ${p.name} from ${p.registry}, which answers ${p.status}: the name is unclaimed`);
  else if (!linkTo) refuse(id, 'source-repository-unregistered', `${p.registry} states the source ${p.repository || '(none)'}, which is no public repository of the ecosystem register`);
  if (p.license && !p.spdx) refuse(id, 'license-not-spdx', `${p.registry} states the license "${p.license}", which is not an SPDX License Expression of the pinned list`);
}
for (const i of snapshot.images) {
  const { id: linkTo } = repoOf(i.source);
  const name = `${sources.registries.ghcr.namespace}/${i.image}`;
  const id = add({ id: `package:${name}`, kind: 'package', type: 'SoftwareApplication', name, url: `https://${name}`, license: spdx(i.licenses), linkTo, needsRepository: true, source: `${snapshotSource} images[${i.image}] named by ${i.namedBy.join(', ')}` });
  packages.push({ asset: id, registry: 'ghcr.io', name: i.image, version: i.tag, published: i.status === 200, owners: '', origin: `workflow:${i.namedBy.join(' ')}`, repository: i.source });
  if (i.status !== 200) refuse(id, 'image-not-public', `ghcr.io answers ${i.status} to an anonymous tag listing of ${name}, which ${i.namedBy.join(', ')} names`);
  else if (!i.tag) refuse(id, 'image-unversioned', `${name} has no SemVer tag, so no released image states its source`);
  else if (!linkTo) refuse(id, 'source-repository-unregistered', `${name}:${i.tag} states the source ${i.source || '(none)'}, which is no public repository of the ecosystem register`);
}

// ---- Public services.
const services = [];
for (const s of declared.services) {
  const linkTo = s.repository ? repoIds.get(s.repository.toLowerCase()) ?? '' : '';
  const id = add({ id: s.id, kind: 'service', type: s.type, name: s.name, url: s.url, linkTo, needsRepository: true, source: quoted(s) });
  const h = snapshot.http.find((x) => x.url === s.url);
  const status = h?.status ?? 0;
  const deployed = status >= 200 && status < 400;
  services.push({ asset: id, provider: FOUNDATION, url: s.url, httpStatus: status, deployed, location: h?.location ?? '' });
  if (!s.repository) refuse(id, 'service-without-repository', `no public repository of the ecosystem register states that it implements ${s.url}`);
  else if (!linkTo) refuse(id, 'source-repository-unregistered', `${s.repository} is no public repository of the ecosystem register`);
  if (!s.url) refuse(id, 'service-without-url', `${s.evidence[0].repository}:${s.evidence[0].path} implements it, and no route or address publishes it`);
  else if (!deployed) refuse(id, 'service-not-deployed', `a GET of ${s.url} answered ${status}`);
}

// ---- Organizations the sources name, and the relation each states.
const relationships = [];
for (const r of declared.relationships) {
  const id = add({ id: r.id, kind: 'organization', type: 'Organization', name: r.name, url: r.url, source: quoted(r) });
  relationships.push({ asset: id, relation: r.relation || 'unstated', statement: r.statement });
  if (!r.relation) refuse(id, 'relation-unstated', `the source says "${r.statement}", which states no Schema.org relation (memberOf, sponsor, funder or provider)`);
}

// ---- Brand and legal documents.
const documents = [];
const IMAGE = /\.(png|jpe?g|svg|webp|gif)$/i;
const docs = checkouts[sources.documents];
for (const path of [...docs.paths].sort(byKey)) {
  const digest = sha256(docs.blob(path));
  const id = add({ id: `document:${docs.name}/${path}`, kind: 'document', type: IMAGE.test(path) ? 'ImageObject' : 'CreativeWork', name: path, url: `${repoUrl(docs.name)}/blob/${docs.commit}/${path}`, linkTo: repoIds.get(docs.name.toLowerCase()) ?? '', needsRepository: true, source: `${docs.name}@${docs.commit}:${path}#sha256:${digest}` });
  documents.push({ asset: id, repository: docs.name, commit: docs.commit, path, digest: `sha256:${digest}`, lockDigest: '' });
}
const brandCheckout = checkouts[sources.brand.checkout];
const lockBytes = brandCheckout.blob(sources.brand.lock);
const lock = JSON.parse(lockBytes.toString('utf8'));
for (const entry of [...lock.copied, ...lock.fonts.files].sort((a, b) => byKey(a.to, b.to))) {
  const digest = sha256(brandCheckout.blob(entry.to));
  const id = add({ id: `document:${brandCheckout.name}/${entry.to}`, kind: 'document', type: IMAGE.test(entry.to) ? 'ImageObject' : 'CreativeWork', name: entry.to, url: `${repoUrl(brandCheckout.name)}/blob/${brandCheckout.commit}/${entry.to}`, linkTo: repoIds.get(brandCheckout.name.toLowerCase()) ?? '', needsRepository: true, source: `${brandCheckout.name}@${brandCheckout.commit}:${sources.brand.lock}#sha256:${sha256(lockBytes)} from ${lock.source.repository}@${lock.source.commit}:${entry.from}` });
  documents.push({ asset: id, repository: brandCheckout.name, commit: brandCheckout.commit, path: entry.to, digest: `sha256:${digest}`, lockDigest: `sha256:${entry.sha256}` });
  if (digest !== entry.sha256) refuse(id, 'digest-mismatch', `${entry.to} is sha256:${digest}; ${sources.brand.lock} records sha256:${entry.sha256}`);
}
for (const a of assets) if (a.needsRepository && !a.linkTo && !refusals.some((r) => r.id === a.id)) refuse(a.id, 'source-repository-unregistered', `${a.id} names no public repository of the ecosystem register`);

// ---- Number the assets by id, so an id's rank is its position.
assets.sort((a, b) => byKey(a.id, b.id));
const position = new Map();
assets.forEach((a, i) => {
  if (position.has(a.id)) throw new Error(`the id ${a.id} is given to two assets`);
  position.set(a.id, i);
});
const at = (id) => position.get(id);
const register = {
  spec: 'uor-community/asset-register/1',
  snapshot: { path: snapshotFile.path, sha256: snapshotFile.sha256, observedAt: snapshot.observedAt },
  sources: [sourcesFile, declaredFile, ecosystemFile, discordPolicyFile, guildFile].map((f) => ({ path: f.path, sha256: f.sha256 })),
  checkouts: sources.checkouts.map(({ name, url, commit }) => ({ name, url, commit })),
  standards: snapshot.standards,
  expiryDays: sources.expiryDays.value,
  assets: assets.map((a, index) => ({ index, id: a.id, kind: a.kind, type: a.type, name: a.name, url: a.url, license: a.license, needsRepository: a.needsRepository, repository: a.linkTo ? at(a.linkTo) : -1, source: a.source })),
  communities: communities.map((c) => ({ ...c, asset: at(c.asset) })),
  domains: domains.map((d) => ({ ...d, asset: at(d.asset), registration: at(d.registration) })).sort((a, b) => a.asset - b.asset),
  packages: packages.map((p) => ({ ...p, asset: at(p.asset) })).sort((a, b) => a.asset - b.asset),
  services: services.map((s) => ({ ...s, asset: at(s.asset), provider: at(s.provider) })).sort((a, b) => a.asset - b.asset),
  relationships: relationships.map((r) => ({ ...r, asset: at(r.asset) })).sort((a, b) => a.asset - b.asset),
  documents: documents.map((d) => ({ ...d, asset: at(d.asset) })).sort((a, b) => a.asset - b.asset),
  refusals: refusals.map((r) => ({ asset: at(r.id), id: r.id, refusal: r.refusal, detail: r.detail })).sort((a, b) => a.asset - b.asset || byKey(a.refusal, b.refusal)),
  excluded,
};
const text = `${JSON.stringify(register, null, 1)}\n`;
const target = join(here, 'register.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
    process.stderr.write('inventory/register.json is not the projection of its pinned sources and snapshot\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
const count = (k) => assets.filter((a) => a.kind === k).length;
process.stdout.write(`${assets.length} assets (${['organization', 'repository', 'community', 'domain', 'package', 'service', 'document'].map((k) => `${count(k)} ${k}`).join(', ')}), ${refusals.length} open claims, ${excluded.length} third-party installs excluded\n`);
