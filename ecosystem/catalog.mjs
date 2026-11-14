#!/usr/bin/env node
/**
 * Write the Foundation.Ecosystem.V1 facet from ecosystem/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Ecosystem/V1/Model.lex.tex  its types, whose tiers, statuses,
 *     TOC stages and outcomes are the register's vocabulary (read from STANDARDS.md,
 *     toc/README.md and the decision app), and registerValid;
 *   app/src/Ecosystem.lex.tex  every repository, open claim and TOC application, and
 *     the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * The same register always writes the same bytes.
 *
 *   node ecosystem/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Ecosystem.V1.Model';
const UNRECORDED = 'unrecorded';
const UNDECIDED = 'undecided';

// Each enumeration is the register's vocabulary plus a word for its absence.
const enums = {
  Tier: [...r.vocabulary.tier, UNRECORDED],
  Status: [...r.vocabulary.status, UNRECORDED],
  TocStage: [...r.vocabulary.tocStages, UNRECORDED],
  Versioning: ['semver', 'other', 'unreleased'],
  StandardsOutcome: [...r.app.outcomes, UNDECIDED],
};
for (const [name, values] of Object.entries(enums)) {
  if (new Set(values.map(camel)).size !== values.length) throw new Error(`${name} has a repeated constructor`);
}
// One branch per constructor, so a new vocabulary word is decided, never defaulted.
const predicate = (name, type, holds) =>
  def(name, [`value : ${type}`], 'Bool', match('value', enums[type].map((v) => [`${type}.${camel(v)}`, holds(v) ? 'true' : 'false'])));

const decl = {
  module: M,
  title: 'Ecosystem model',
  catalog: 'Ecosystem',
  catalogTitle: 'Ecosystem register',
  enums,
  kinds: [
    {
      name: 'Repository',
      list: 'repositories',
      fields: [
        ['name', 'String'], ['archived', 'Bool'], ['language', 'String'], ['topics', 'String'],
        ['tier', { enum: 'Tier' }], ['status', { enum: 'Status' }], ['tocStage', { enum: 'TocStage' }],
        ['identityTags', 'Bool'], ['tierTags', 'Nat'], ['statusTags', 'Nat'],
        ['versioning', { enum: 'Versioning' }], ['releaseTags', 'Nat'], ['outcome', { enum: 'StandardsOutcome' }],
      ],
      checks: ['(tagsRead $)'],
    },
    { name: 'OpenClaim', list: 'openClaims', fields: [['repository', { ref: 'Repository' }], ['name', 'String'], ['reason', 'String']] },
    { name: 'TocApplication', list: 'tocApplications', fields: [['number', 'Nat'], ['title', 'String'], ['stage', { enum: 'TocStage' }], ['reason', 'String']] },
  ],
  release: [
    ['query', 'String'], ['snapshotDigest', 'String'], ['norms', 'String'], ['app', 'String'], ['appDigest', 'String'],
    ['conformantCount', 'Nat'],
  ],
  definitions: [
    predicate('tierRecorded', 'Tier', (v) => v !== UNRECORDED),
    predicate('statusRecorded', 'Status', (v) => v !== UNRECORDED),
    predicate('isConformant', 'StandardsOutcome', (v) => v === r.app.conformant),
    def('agree', ['left : Bool', 'right : Bool'], 'Bool', '(if left then right else (not right))'),
    // A tier or status is recorded exactly when one tag of its kind is carried, as STANDARDS.md requires.
    def('tagsRead', ['repository : Repository'], 'Bool',
      '((agree (tierRecorded (project repository tier)) ((project repository tierTags) =? 1)) && (agree (statusRecorded (project repository status)) ((project repository statusTags) =? 1)))'),
    def('conformantTotal', ['values : (List Repository)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons repository rest', '((if (isConformant (project repository outcome)) then 1 else 0) + (conformantTotal rest))']]), 'values'),
    def('claimed', ['position : Nat', 'claims : (List OpenClaim)'], 'Bool',
      match('claims', [['List.nil', 'false'], ['List.cons claim rest', '(((project claim repository) =? position) || (claimed position rest))']]), 'claims'),
    def('repositoriesAccounted', ['claims : (List OpenClaim)', 'values : (List Repository)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons repository rest', '(((isConformant (project repository outcome)) || (claimed (project repository index) claims)) && (repositoriesAccounted claims rest))']]), 'values'),
  ],
  checks: [
    '((conformantTotal repositories) =? (project release conformantCount))',
    '(repositoriesAccounted openClaims repositories)',
  ],
};

const records = {
  repositories: r.repositories.map((x) => ({
    name: x.name, archived: x.archived, language: x.language, topics: x.topics.join(' '),
    tier: x.tier ? r.vocabulary.tier[r.app.tiers.indexOf(x.tier)] : UNRECORDED,
    status: x.status || UNRECORDED, tocStage: x.tocStage || UNRECORDED,
    identityTags: x.request.identity === 'present', tierTags: x.request.tiertags, statusTags: x.request.statustags,
    versioning: x.request.versioning, releaseTags: x.tags, outcome: x.outcome || UNDECIDED,
  })),
  openClaims: r.refusals.map((c) => ({ repository: c.repository, name: c.refusal, reason: c.detail })),
  tocApplications: r.tocApplications.map((a) => ({ number: a.number, title: a.title, stage: a.stage || UNRECORDED, reason: a.refusal })),
};
const release = {
  query: r.snapshot.query,
  snapshotDigest: `sha256:${r.snapshot.sha256}`,
  norms: r.norms.map((n) => `${n.path}#sha256:${n.sha256}`).join(' '),
  app: r.app.path,
  appDigest: `sha256:${r.app.sha256}`,
  conformantCount: r.repositories.filter((x) => x.outcome === r.app.conformant).length,
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Ecosystem/V1/Model.lex.tex', typesModule(decl)],
  ['src/Ecosystem.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/ecosystem-model.toml', entry('ecosystem-model', 'Ecosystem model', M, 'registerValid')],
  ['language/prism.arch/entries/ecosystem-register.toml', entry('ecosystem-register', 'Ecosystem register', 'Ecosystem', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of ecosystem/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
const claims = records.openClaims.length + records.tocApplications.length;
process.stdout.write(`${records.repositories.length} repositories, ${release.conformantCount} conformant, ${claims} open claims\n`);
