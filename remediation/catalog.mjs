#!/usr/bin/env node
/**
 * Write the Foundation.Remediation.V1 facet from remediation/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Remediation/V1/Model.lex.tex  its types and registerValid;
 *   app/src/Remediation.lex.tex  every repository, every change that applies at
 *     every tier, every open claim, and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid holds when every repository is projected at exactly one tier,
 * the one its tier tag records or else the one the uor-repo-tier app proposes,
 * a repository without a recorded tier names the proposed tier as an open claim
 * for its maintainers to confirm, every change and claim names
 * a repository, and each repository's counts of changes, decisions and findings
 * are the records that name it. The same register always writes the same bytes.
 *
 *   node remediation/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Remediation.V1.Model';

const enums = {
  App: r.apps.map((a) => a.app),
  ChangeKind: ['topic', 'file', 'ruleset', 'rename', 'decision'],
  Refusal: [...new Set(r.refusals.map((c) => c.refusal))].sort(),
};
for (const [name, values] of Object.entries(enums)) {
  if (new Set(values.map(camel)).size !== values.length) throw new Error(`${name} has a repeated constructor`);
}
const predicate = (name, type, holds) =>
  def(name, [`value : ${type}`], 'Bool', match('value', enums[type].map((v) => [`${type}.${camel(v)}`, holds(v) ? 'true' : 'false'])));
const and = (xs) => xs.reduceRight((rest, x) => (rest === null ? x : `(${x} && ${rest})`), null);
const isDecision = (v) => v.startsWith('decision-');
const isFinding = (v) => v.startsWith('blocked-') || v === 'unobservable';

const count = (name, kind, item, holds) => def(name, ['position : Nat', `values : (List ${kind})`], 'Nat',
  match('values', [['List.nil', '0'], [`List.cons ${item} rest`, `((if (((project ${item} repository) =? position) && ${holds}) then 1 else 0) + (${name} position rest))`]]), 'values');

const decl = {
  module: M,
  title: 'Remediation model',
  catalog: 'Remediation',
  catalogTitle: 'Remediation register',
  enums,
  kinds: [
    {
      name: 'Repository',
      list: 'repositories',
      fields: [
        ['name', 'String'], ['commit', 'String'], ['archived', 'Bool'], ['tierRecorded', 'Bool'],
        ['tiersProjected', 'Nat'], ['changesNow', 'Nat'], ['decisions', 'Nat'], ['findings', 'Nat'],
      ],
      checks: ['(tiersRead $)'],
    },
    {
      name: 'Change',
      list: 'changes',
      fields: [['repository', { ref: 'Repository' }], ['app', { enum: 'App' }], ['kind', { enum: 'ChangeKind' }], ['detail', 'String']],
    },
    { name: 'OpenClaim', list: 'openClaims', fields: [['repository', { ref: 'Repository' }], ['name', { enum: 'Refusal' }], ['reason', 'String']] },
  ],
  release: [
    ['ecosystemDigest', 'String'], ['observationsDigest', 'String'], ['rolesDigest', 'String'], ['sources', 'String'],
  ],
  definitions: [
    predicate('isTierDecision', 'Refusal', (v) => v === 'decision-tier'),
    predicate('isDecision', 'Refusal', isDecision),
    predicate('isFinding', 'Refusal', isFinding),
    def('tiersRead', ['repository : Repository'], 'Bool',
      '((project repository tiersProjected) =? 1)'),
    count('changesOf', 'Change', 'change', 'true'),
    count('decisionsOf', 'OpenClaim', 'claim', '(isDecision (project claim name))'),
    count('findingsOf', 'OpenClaim', 'claim', '(isFinding (project claim name))'),
    count('tierDecisionsOf', 'OpenClaim', 'claim', '(isTierDecision (project claim name))'),
    // Each repository: projected at every tier when none is recorded, which is then an open decision,
    // and its counts are the records that name it.
    def('accounted', ['changes : (List Change)', 'claims : (List OpenClaim)', 'values : (List Repository)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons repository rest', and([
        '((project repository tierRecorded) || ((tierDecisionsOf (project repository index) claims) =? 1))',
        '((changesOf (project repository index) changes) =? (project repository changesNow))',
        '((decisionsOf (project repository index) claims) =? (project repository decisions))',
        '((findingsOf (project repository index) claims) =? (project repository findings))',
        '(accounted changes claims rest)',
      ])]]), 'values'),
  ],
  checks: ['(accounted changes openClaims repositories)'],
};

const live = r.repositories.filter((x) => !x.empty);
if (live.length !== r.repositories.length) throw new Error('an unobservable repository has no catalog form yet');
const records = {
  repositories: r.repositories.map((x) => ({
    name: x.name, commit: x.commit, archived: x.archived, tierRecorded: Boolean(x.tier), tiersProjected: x.tiers.length,
    changesNow: x.now.length,
    decisions: r.refusals.filter((c) => c.repository === x.index && isDecision(c.refusal)).length,
    findings: r.refusals.filter((c) => c.repository === x.index && isFinding(c.refusal)).length,
  })),
  changes: r.repositories.flatMap((x) => x.now.map((c) => ({ repository: x.index, app: c.app, kind: c.kind, detail: c.detail }))),
  openClaims: r.refusals.map((c) => ({ repository: c.repository, name: c.refusal, reason: c.detail })),
};
r.repositories.forEach((x, i) => { if (x.index !== i) throw new Error(`${x.name} is numbered ${x.index}, not ${i}`); });
const release = {
  ecosystemDigest: `sha256:${r.ecosystem.sha256}`,
  observationsDigest: `sha256:${r.observations.sha256}`,
  rolesDigest: `sha256:${r.roles.sha256}`,
  sources: r.sources.map((s) => `${s.path}#sha256:${s.sha256}`).join(' '),
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Remediation/V1/Model.lex.tex', typesModule(decl)],
  ['src/Remediation.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/remediation-model.toml', entry('remediation-model', 'Remediation model', M, 'registerValid')],
  ['language/prism.arch/entries/remediation-register.toml', entry('remediation-register', 'Remediation register', 'Remediation', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of remediation/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
process.stdout.write(`${records.repositories.length} repositories, ${records.changes.length} changes at every tier, ${records.openClaims.length} open claims\n`);
