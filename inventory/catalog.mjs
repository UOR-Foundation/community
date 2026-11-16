#!/usr/bin/env node
/**
 * Write the Foundation.Asset.V1 facet from inventory/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Asset/V1/Model.lex.tex  its types, whose asset kinds,
 *     Schema.org classes, relations and registries are the register's
 *     vocabulary, and registerValid;
 *   app/src/Assets.lex.tex  every asset, observation and open claim, and the
 *     theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid holds when every asset id is unique (ids are sorted, and each
 * id's rank among all ids is its position), every package, service and
 * document resolves to a repository asset or is an open claim, every domain
 * has an RDAP observation and every failed or expiring one is an open claim,
 * every organization other than the Foundation has a relationship whose
 * relation is stated or is an open claim, and every undeployed service and
 * unpublished package is an open claim. The same register always writes the
 * same bytes.
 *
 *   node inventory/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const declared = JSON.parse(readFileSync(join(here, 'declared.json'), 'utf8'));
const M = 'Foundation.Asset.V1.Model';
const KINDS = ['organization', 'repository', 'community', 'domain', 'package', 'service', 'document'];
const UNSTATED = 'unstated';

const enums = {
  AssetKind: KINDS,
  SchemaType: declared.schema.types,
  // The Schema.org properties that relate the Foundation to another organization, and a word for none stated.
  Relation: [...declared.schema.properties.filter((p) => p !== 'codeRepository'), UNSTATED],
  Registry: ['crates.io', 'npm', 'pypi', 'ghcr.io'],
};
for (const [name, values] of Object.entries(enums)) {
  if (new Set(values.map(camel)).size !== values.length) throw new Error(`${name} has a repeated constructor`);
}
// One branch per constructor, so a new vocabulary word is decided, never defaulted.
const predicate = (name, type, holds) =>
  def(name, [`value : ${type}`], 'Bool', match('value', enums[type].map((v) => [`${type}.${camel(v)}`, holds(v) ? 'true' : 'false'])));
const kindIs = (k) => `is${k[0].toUpperCase()}${k.slice(1)}Kind`;
// Whether the asset numbered `at` is of kind k; false when no asset is numbered `at`.
const kindAt = (k) => def(`${k}At`, ['allAssets : (List Asset)', 'at : Nat'], 'Bool',
  match('allAssets', [['List.nil', 'false'], ['List.cons asset rest', `(if ((project asset index) =? at) then (${kindIs(k)} (project asset kind)) else (${k}At rest at))`]]), 'allAssets');
// That every record of a detail list is about an asset of the kind it details.
const typed = (list, type, kind) => def(`${list}Typed`, ['allAssets : (List Asset)', `values : (List ${type})`], 'Bool',
  match('values', [['List.nil', 'true'], ['List.cons item rest', `((${kind}At allAssets (project item asset)) && (${list}Typed allAssets rest))`]]), 'values');
const accounted = (list, type, holds) => def(`${list}Accounted`, ['claims : (List OpenClaim)', `values : (List ${type})`], 'Bool',
  match('values', [['List.nil', 'true'], ['List.cons item rest', `((${holds} || (claimed (project item asset) claims)) && (${list}Accounted claims rest))`]]), 'values');
const A = { ref: 'Asset' };

const decl = {
  module: M,
  title: 'Asset model',
  catalog: 'Assets',
  catalogTitle: 'Asset register',
  enums,
  kinds: [
    {
      name: 'Asset',
      list: 'assets',
      fields: [
        ['identifier', 'String'], ['rank', 'Nat'], ['kind', { enum: 'AssetKind' }], ['schemaType', { enum: 'SchemaType' }], ['name', 'String'], ['url', 'String'],
        ['license', 'String'], ['needsRepository', 'Bool'], ['linked', 'Bool'], ['repository', 'Nat'], ['source', 'String'],
      ],
      // Assets are numbered in id order and each id's rank among all ids is its position, so no id repeats.
      checks: ['((project $ rank) =? (project $ index))'],
    },
    { name: 'Community', list: 'communities', fields: [['asset', A], ['platform', 'String'], ['channels', 'Nat'], ['invites', 'String']] },
    {
      name: 'DomainObservation',
      list: 'domains',
      fields: [
        ['asset', A], ['registration', A], ['registrable', 'String'], ['site', 'String'], ['reason', 'String'], ['rcode', 'Nat'], ['addresses', 'String'], ['cname', 'String'],
        ['rdapServer', 'String'], ['rdapStatus', 'Nat'], ['registrar', 'String'], ['expiration', 'String'], ['expires', 'Bool'], ['daysToExpiry', 'Nat'],
        ['nameservers', 'String'], ['valuesRegistered', 'Bool'],
      ],
    },
    { name: 'PackageRecord', list: 'packages', fields: [['asset', A], ['registry', { enum: 'Registry' }], ['name', 'String'], ['version', 'String'], ['published', 'Bool'], ['owners', 'String'], ['origin', 'String'], ['sourceRepository', 'String']] },
    {
      name: 'ServiceRecord',
      list: 'services',
      fields: [['asset', A], ['provider', A], ['url', 'String'], ['httpStatus', 'Nat'], ['deployed', 'Bool'], ['location', 'String']],
      // RFC 9110 section 15: a 2xx or 3xx answer is a deployment.
      checks: ['(agree (project $ deployed) ((199 <? (project $ httpStatus)) && ((project $ httpStatus) <? 400)))'],
    },
    { name: 'Relationship', list: 'relationships', fields: [['asset', A], ['relation', { enum: 'Relation' }], ['statement', 'String']] },
    { name: 'Document', list: 'documents', fields: [['asset', A], ['repository', 'String'], ['commit', 'String'], ['path', 'String'], ['digest', 'String'], ['lockDigest', 'String']] },
    { name: 'OpenClaim', list: 'openClaims', fields: [['asset', A], ['refusal', 'String'], ['detail', 'String']] },
  ],
  release: [
    ['foundation', A], ['snapshotDigest', 'String'], ['observedAt', 'String'], ['sources', 'String'], ['checkouts', 'String'], ['standards', 'String'], ['expiryDays', 'Nat'],
  ],
  definitions: [
    ...KINDS.map((k) => predicate(kindIs(k), 'AssetKind', (v) => v === k)),
    predicate('relationStated', 'Relation', (v) => v !== UNSTATED),
    def('agree', ['left : Bool', 'right : Bool'], 'Bool', '(if left then right else (not right))'),
    ...KINDS.map(kindAt),
    def('claimed', ['position : Nat', 'claims : (List OpenClaim)'], 'Bool',
      match('claims', [['List.nil', 'false'], ['List.cons claim rest', '(((project claim asset) =? position) || (claimed position rest))']]), 'claims'),
    // A package, service or document resolves to an asset of kind repository, or is an open claim.
    def('assetsResolved', ['claims : (List OpenClaim)', 'allAssets : (List Asset)', 'values : (List Asset)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons asset rest', '(((not (project asset needsRepository)) || (((project asset linked) && (repositoryAt allAssets (project asset repository))) || (claimed (project asset index) claims))) && (assetsResolved claims allAssets rest))']]), 'values'),
    def('linksAreRepositories', ['total : Nat', 'values : (List Asset)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons asset rest', '(((not (project asset linked)) || ((project asset needsRepository) && ((project asset repository) <? total))) && (linksAreRepositories total rest))']]), 'values'),
    def('observedAt', ['position : Nat', 'observations : (List DomainObservation)'], 'Bool',
      match('observations', [['List.nil', 'false'], ['List.cons item rest', '(((project item asset) =? position) || (observedAt position rest))']]), 'observations'),
    def('domainsObserved', ['observations : (List DomainObservation)', 'values : (List Asset)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons asset rest', '(((not (isDomainKind (project asset kind))) || (observedAt (project asset index) observations)) && (domainsObserved observations rest))']]), 'values'),
    def('relatedAt', ['position : Nat', 'links : (List Relationship)'], 'Bool',
      match('links', [['List.nil', 'false'], ['List.cons item rest', '(((project item asset) =? position) || (relatedAt position rest))']]), 'links'),
    def('organizationsRelated', ['links : (List Relationship)', 'foundation : Nat', 'values : (List Asset)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons asset rest', '(((not (isOrganizationKind (project asset kind))) || (((project asset index) =? foundation) || (relatedAt (project asset index) links))) && (organizationsRelated links foundation rest))']]), 'values'),
    def('expiryAccounted', ['expiryWindow : Nat', 'claims : (List OpenClaim)', 'values : (List DomainObservation)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons item rest', '(((not ((project item expires) && ((project item daysToExpiry) <? expiryWindow))) || (claimed (project item registration) claims)) && (expiryAccounted expiryWindow claims rest))']]), 'values'),
    accounted('rdap', 'DomainObservation', '((project item rdapStatus) =? 200)'),
    accounted('resolution', 'DomainObservation', '((project item rcode) =? 0)'),
    accounted('deployments', 'ServiceRecord', '(project item deployed)'),
    accounted('publications', 'PackageRecord', '(project item published)'),
    accounted('relations', 'Relationship', '(relationStated (project item relation))'),
    typed('domains', 'DomainObservation', 'domain'),
    typed('packages', 'PackageRecord', 'package'),
    typed('services', 'ServiceRecord', 'service'),
    typed('relationships', 'Relationship', 'organization'),
    typed('documents', 'Document', 'document'),
    typed('communities', 'Community', 'community'),
  ],
  checks: [
    '(organizationAt assets (project release foundation))',
    '(linksAreRepositories (assetsTotal assets) assets)',
    '(assetsResolved openClaims assets assets)',
    '(domainsObserved domains assets)',
    '(organizationsRelated relationships (project release foundation) assets)',
    '(rdapAccounted openClaims domains)',
    '(resolutionAccounted openClaims domains)',
    '(expiryAccounted (project release expiryDays) openClaims domains)',
    '(deploymentsAccounted openClaims services)',
    '(publicationsAccounted openClaims packages)',
    '(relationsAccounted openClaims relationships)',
    '(domainsTyped assets domains)',
    '(packagesTyped assets packages)',
    '(servicesTyped assets services)',
    '(relationshipsTyped assets relationships)',
    '(documentsTyped assets documents)',
    '(communitiesTyped assets communities)',
  ],
};

// An id's rank is the number of distinct ids that sort before it.
const ids = [...new Set(r.assets.map((a) => a.id))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const records = {
  assets: r.assets.map((a) => ({
    identifier: a.id, rank: ids.indexOf(a.id), kind: a.kind, schemaType: a.type, name: a.name, url: a.url, license: a.license,
    needsRepository: a.needsRepository, linked: a.repository >= 0, repository: Math.max(a.repository, 0), source: a.source,
  })),
  communities: r.communities,
  domains: r.domains,
  packages: r.packages.map((p) => ({ ...p, sourceRepository: p.repository })),
  services: r.services,
  relationships: r.relationships,
  documents: r.documents,
  openClaims: r.refusals.map((c) => ({ asset: c.asset, refusal: c.refusal, detail: c.detail })),
};
const release = {
  foundation: r.assets.findIndex((a) => a.id === declared.foundation.id),
  snapshotDigest: `sha256:${r.snapshot.sha256}`,
  observedAt: r.snapshot.observedAt,
  sources: r.sources.map((s) => `${s.path}#sha256:${s.sha256}`).join(' '),
  checkouts: r.checkouts.map((c) => `${c.url}@${c.commit}`).join(' '),
  standards: [
    `schema.org@${r.standards.schemaOrg.version} ${r.standards.schemaOrg.types.url}#sha256:${r.standards.schemaOrg.types.sha256} ${r.standards.schemaOrg.properties.url}#sha256:${r.standards.schemaOrg.properties.sha256}`,
    `spdx@${r.standards.spdx.version} ${r.standards.spdx.licenses.url}#sha256:${r.standards.spdx.licenses.sha256} ${r.standards.spdx.exceptions.url}#sha256:${r.standards.spdx.exceptions.sha256}`,
    `${r.standards.publicSuffix.url}#sha256:${r.standards.publicSuffix.sha256}`,
    `${r.standards.rdapBootstrap.url}@${r.standards.rdapBootstrap.publication}#sha256:${r.standards.rdapBootstrap.sha256}`,
    `${r.standards.rdapValues.url}#sha256:${r.standards.rdapValues.sha256}`,
  ].join(' '),
  expiryDays: r.expiryDays,
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Asset/V1/Model.lex.tex', typesModule(decl)],
  ['src/Assets.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/asset-model.toml', entry('asset-model', 'Asset model', M, 'registerValid')],
  ['language/prism.arch/entries/asset-register.toml', entry('asset-register', 'Asset register', 'Assets', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of inventory/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
process.stdout.write(`${records.assets.length} assets, ${records.openClaims.length} open claims\n`);
