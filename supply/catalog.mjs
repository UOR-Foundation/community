#!/usr/bin/env node
/**
 * Write the Foundation.Supply.V1 facet from supply/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Supply/V1/Model.lex.tex  its types, whose Package-URL types are the purl-spec type
 *     index, whose license forms are CycloneDX's licenseChoice, whose SBOM formats are the editions syft
 *     writes (CycloneDX 1.7, SPDX 2.3, SPDX 3.0.1), and registerValid;
 *   app/src/Supply.lex.tex  every repository with its SBOM digest, every serialization of it in each format
 *     with its validity and committed digest, every component and license count,
 *     every Foundation package and what its registry publishes, every intra-Foundation dependency edge,
 *     every open claim, and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * The same register always writes the same bytes.
 *
 *   node supply/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel, pascal } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Supply.V1.Model';
const NONE = 'none';
const R = { ref: 'Repository' };

const enums = {
  // ECMA-427 Package-URL types as purl-spec registers them, and a word for a component without a purl.
  PurlType: [...r.purlTypes, NONE],
  // CycloneDX 1.7 licenseChoice: a license by SPDX id or by name, or an SPDX license expression.
  LicenseForm: ['license.id', 'license.name', 'expression'],
  // The SBOM editions syft writes for each repository: ECMA-424 2nd edition, SPDX 2.3 and SPDX 3.0.1.
  SbomFormat: ['cyclonedx-1.7', 'spdx-2.3', 'spdx-3.0.1'],
  EdgeKind: ['package', 'git', 'submodule', 'action', 'image', 'vendored'],
  RegistryStatus: ['published', 'absent', 'elsewhere', 'unread'],
};
for (const [name, values] of Object.entries(enums)) {
  if (new Set(values.map(camel)).size !== values.length) throw new Error(`${name} has a repeated constructor`);
}
const FORM = { id: 'license.id', name: 'license.name', expression: 'expression' };

// Sums and lookups over the register, one per check; each recursive list is a parameter named values.
const sumWhere = (name, kind, field) =>
  def(name, ['position : Nat', `values : (List ${kind})`], 'Nat',
    match('values', [['List.nil', '0'], ['List.cons row rest', `(if ((project row repository) =? position) then ((project row ${field}) + (${name} position rest)) else (${name} position rest))`]]), 'values');
const claimedBy = (name, kind, field) =>
  def(name, ['position : Nat', `claims : (List ${kind})`], 'Bool',
    match('claims', [['List.nil', 'false'], ['List.cons claim rest', `(((project claim ${field}) =? position) || (${name} position rest))`]]), 'claims');

const decl = {
  module: M,
  title: 'Supply model',
  catalog: 'Supply',
  catalogTitle: 'Supply register',
  enums,
  kinds: [
    {
      name: 'Repository',
      list: 'repositories',
      fields: [
        ['name', 'String'], ['commit', 'String'], ['sbomDigest', 'String'], ['hasSbom', 'Bool'],
        ['components', 'Nat'], ['licensedComponents', 'Nat'], ['licenseEntries', 'Nat'],
      ],
      // A licensed component has at least one license entry, and is a component.
      checks: ['((project $ licensedComponents) <? ((project $ components) + 1))', '((project $ licensedComponents) <? ((project $ licenseEntries) + 1))'],
    },
    { name: 'ComponentCount', list: 'componentCounts', fields: [['repository', R], ['purlType', { enum: 'PurlType' }], ['count', 'Nat']], checks: ['(0 <? (project $ count))'] },
    { name: 'LicenseCount', list: 'licenseCounts', fields: [['repository', R], ['form', { enum: 'LicenseForm' }], ['license', 'String'], ['count', 'Nat']], checks: ['(0 <? (project $ count))'] },
    // One SBOM of a repository in one format. Only a valid, reproducible serialization is committed; a reproducible one
    // has a digest whether or not its bytes are committed.
    {
      name: 'Serialization',
      list: 'serializations',
      fields: [['repository', R], ['format', { enum: 'SbomFormat' }], ['valid', 'Bool'], ['committed', 'Bool'], ['reproducible', 'Bool'], ['digest', 'String'], ['bytes', 'Nat'], ['elements', 'Nat']],
      checks: ['((not (project $ committed)) || ((project $ valid) && (project $ reproducible)))'],
    },
    {
      name: 'Package',
      list: 'packages',
      fields: [
        ['repository', R], ['ecosystem', { enum: 'PurlType' }], ['name', 'String'], ['evidence', 'String'], ['declaredPrivate', 'Bool'],
        ['registry', { enum: 'RegistryStatus' }], ['version', 'String'], ['downloads', 'Nat'], ['downloadsKnown', 'Bool'], ['downloadWindow', 'String'],
        ['externalDependents', 'Nat'], ['dependentsKnown', 'Bool'],
      ],
    },
    { name: 'Edge', list: 'edges', fields: [['dependent', R], ['dependency', R], ['kind', { enum: 'EdgeKind' }], ['evidence', 'String']], checks: ['(not ((project $ dependent) =? (project $ dependency)))'] },
    { name: 'RepositoryClaim', list: 'repositoryClaims', fields: [['repository', R], ['refusal', 'String'], ['detail', 'String']] },
    { name: 'PackageClaim', list: 'packageClaims', fields: [['subject', { ref: 'Package' }], ['refusal', 'String'], ['detail', 'String']] },
    { name: 'FormatClaim', list: 'formatClaims', fields: [['format', { enum: 'SbomFormat' }], ['refusal', 'String'], ['detail', 'String']] },
  ],
  release: [
    ['componentTotal', 'Nat'], ['snapshotDigest', 'String'], ['ecosystemDigest', 'String'], ['registriesDigest', 'String'], ['registriesFetchedAt', 'String'],
    ['syft', 'String'], ['syftDigest', 'String'], ['syftBinaryDigest', 'String'], ['standards', 'String'], ['validator', 'String'],
    ['formats', 'Nat'], ['sbomBytes', 'Nat'],
  ],
  definitions: [
    sumWhere('componentsOf', 'ComponentCount', 'count'),
    sumWhere('licensesOf', 'LicenseCount', 'count'),
    def('countsReconcile', ['allCounts : (List ComponentCount)', 'allLicenses : (List LicenseCount)', 'values : (List Repository)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons repository rest', '((((componentsOf (project repository index) allCounts) =? (project repository components)) && ((licensesOf (project repository index) allLicenses) =? (project repository licenseEntries))) && (countsReconcile allCounts allLicenses rest))']]), 'values'),
    def('componentSum', ['values : (List Repository)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons repository rest', '((project repository components) + (componentSum rest))']]), 'values'),
    claimedBy('repositoryClaimed', 'RepositoryClaim', 'repository'),
    claimedBy('packageClaimed', 'PackageClaim', 'subject'),
    // A repository is accounted for by a valid SBOM that catalogues something, or by an open claim.
    def('sbomsAccounted', ['claims : (List RepositoryClaim)', 'values : (List Repository)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons repository rest', '((((project repository hasSbom) && (0 <? (project repository components))) || (repositoryClaimed (project repository index) claims)) && (sbomsAccounted claims rest))']]), 'values'),
    // Only a published package, or a private one no registry holds, needs no claim.
    def('registryAccepted', ['status : RegistryStatus', 'isPrivate : Bool'], 'Bool',
      match('status', [['RegistryStatus.published', 'true'], ['RegistryStatus.absent', 'isPrivate'], ['RegistryStatus.elsewhere', 'false'], ['RegistryStatus.unread', 'false']])),
    def('packagesAccounted', ['claims : (List PackageClaim)', 'values : (List Package)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons item rest', '(((registryAccepted (project item registry) (project item declaredPrivate)) || (packageClaimed (project item index) claims)) && (packagesAccounted claims rest))']]), 'values'),
    // Format equality, one match per side, since a match is never nested inside a term.
    ...enums.SbomFormat.map((f) => def(`is${pascal(f)}`, ['value : SbomFormat'], 'Bool',
      match('value', enums.SbomFormat.map((g) => [`SbomFormat.${camel(g)}`, String(f === g)])))),
    def('sameFormat', ['left : SbomFormat', 'right : SbomFormat'], 'Bool',
      match('left', enums.SbomFormat.map((f) => [`SbomFormat.${camel(f)}`, `(is${pascal(f)} right)`]))),
    def('formatClaimed', ['wanted : SbomFormat', 'claims : (List FormatClaim)'], 'Bool',
      match('claims', [['List.nil', 'false'], ['List.cons claim rest', '((sameFormat (project claim format) wanted) || (formatClaimed wanted rest))']]), 'claims'),
    def('serializationsOf', ['position : Nat', 'values : (List Serialization)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons item rest', '(if ((project item repository) =? position) then (1 + (serializationsOf position rest)) else (serializationsOf position rest))']]), 'values'),
    // Every repository is serialized once in each format.
    def('formatsCovered', ['formats : Nat', 'held : (List Serialization)', 'values : (List Repository)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons repository rest', '(((serializationsOf (project repository index) held) =? formats) && (formatsCovered formats held rest))']]), 'values'),
    // A serialization that does not validate is a repository claim; a valid one that is not committed is a format claim.
    def('serializationsAccounted', ['claims : (List RepositoryClaim)', 'held : (List FormatClaim)', 'values : (List Serialization)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons item rest', '((((project item valid) || (repositoryClaimed (project item repository) claims)) && (((project item committed) || (not (project item valid))) || (formatClaimed (project item format) held))) && (serializationsAccounted claims held rest))']]), 'values'),
    def('committedBytes', ['values : (List Serialization)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons item rest', '(if (project item committed) then ((project item bytes) + (committedBytes rest)) else (committedBytes rest))']]), 'values'),
  ],
  checks: [
    '((componentSum repositories) =? (project release componentTotal))',
    '(countsReconcile componentCounts licenseCounts repositories)',
    '(sbomsAccounted repositoryClaims repositories)',
    '(packagesAccounted packageClaims packages)',
    '(formatsCovered (project release formats) serializations repositories)',
    '(serializationsAccounted repositoryClaims formatClaims serializations)',
    '((committedBytes serializations) =? (project release sbomBytes))',
  ],
};

const position = new Map(r.repositories.map((x) => [x.name, x.index]));
const records = {
  repositories: r.repositories.map((x) => ({
    name: x.name, commit: x.commit, sbomDigest: x.sbom ? `sha256:${x.sbom.sha256}` : '', hasSbom: Boolean(x.sbom),
    components: x.components, licensedComponents: x.licensedComponents, licenseEntries: x.licenseEntries,
  })),
  componentCounts: r.repositories.flatMap((x) => Object.entries(x.purlTypes).map(([purlType, count]) => ({ repository: x.index, purlType, count }))),
  licenseCounts: r.repositories.flatMap((x) => x.licenses.map((l) => ({ repository: x.index, form: FORM[l.form], license: l.license, count: l.count }))),
  packages: r.packages.map((p) => ({
    repository: position.get(p.repository), ecosystem: p.ecosystem, name: p.name, evidence: p.evidence, declaredPrivate: p.private,
    registry: p.registry, version: p.version, downloads: p.downloads?.count ?? 0, downloadsKnown: p.downloads !== null, downloadWindow: p.downloads?.window ?? '',
    externalDependents: p.externalDependents?.length ?? 0, dependentsKnown: p.externalDependents !== null,
  })),
  edges: r.edges.map((e) => ({ dependent: position.get(e.from), dependency: position.get(e.to), kind: e.kind, evidence: e.evidence.join(' ') })),
  repositoryClaims: r.refusals.map((c) => ({ repository: c.repository, refusal: c.refusal, detail: c.detail })),
  packageClaims: r.packageClaims.map((c) => ({ subject: c.package, refusal: c.refusal, detail: c.detail })),
  serializations: r.repositories.flatMap((x) => x.serializations.map((z) => ({
    repository: x.index, format: z.format, valid: z.valid, committed: Boolean(z.path), reproducible: z.reproducible, digest: z.sha256 ? `sha256:${z.sha256}` : '', bytes: z.bytes, elements: z.elements,
  }))),
  formatClaims: r.formatClaims.map((c) => ({ format: c.format, refusal: c.refusal, detail: c.detail })),
};
const t = r.tools;
const release = {
  componentTotal: r.componentTotal,
  snapshotDigest: `sha256:${r.snapshot.sha256}`,
  ecosystemDigest: `sha256:${r.ecosystem.sha256}`,
  registriesDigest: `sha256:${r.registries.sha256}`,
  registriesFetchedAt: r.registries.fetchedAt,
  syft: `syft ${t.syft.version} (${t.syft.gitCommit}) -c ${t.syft.config.path}#sha256:${t.syft.config.sha256} ${t.syft.args.join(' ')} ${Object.values(t.syft.outputs).map((o) => `-o ${o}`).join(' ')}`,
  syftDigest: `sha256:${t.syft.sha256}`,
  syftBinaryDigest: `sha256:${t.syft.binarySha256}`,
  standards: r.standards.map((s) => `${s.path}#sha256:${s.sha256}`).join(' '),
  validator: `ajv ${t.ajv.version} ajv-formats ${t.ajv.ajvFormats}; ${Object.entries(t.ajv.dialects).map(([f, d]) => `${f}: ${d.dialect}, formats not asserted: ${d.formatsNotAsserted.join(' ') || 'none'}`).join('; ')}; spdx-tools ${t.spdxTools.version} pyspdxtools (${t.spdxTools.requirements}#sha256:${t.spdxTools.requirementsSha256})`,
  formats: enums.SbomFormat.length,
  sbomBytes: r.sbomBytes,
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Supply/V1/Model.lex.tex', typesModule(decl)],
  ['src/Supply.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/supply-model.toml', entry('supply-model', 'Supply model', M, 'registerValid')],
  ['language/prism.arch/entries/supply-register.toml', entry('supply-register', 'Supply register', 'Supply', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of supply/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
process.stdout.write(decl.kinds.map((k) => `${records[k.list].length} ${k.list}`).join(', ') + '\n');
