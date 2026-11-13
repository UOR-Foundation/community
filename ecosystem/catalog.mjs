#!/usr/bin/env node
/**
 * Write the Foundation.Ecosystem.V1 facet from ecosystem/register.json:
 *
 *   app/src/Foundation/Ecosystem/V1/Model.lex.tex  its types, whose tiers, statuses,
 *     TOC stages, versionings and outcomes are the register's vocabulary (read from
 *     STANDARDS.md, toc/README.md and the decision app), and registerValid;
 *   app/src/Ecosystem.lex.tex  every repository and open claim, and the theorem
 *     that the register is valid;
 *   the two lexicon entries that title them.
 *
 * The same register always writes the same bytes.
 *
 *   node ecosystem/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Ecosystem.V1.Model';
const str = (s) => JSON.stringify(String(s));
const camel = (s) => {
  const words = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w[0].toLowerCase() : w[0].toUpperCase()) + w.slice(1).toLowerCase()).join('');
};
const def = (name, params, type, body, rec) =>
  `definition{\n  name: ${name},\n  parameters: [${params}],\n  result: ${type},\n  body: ${body}${rec ? `,\n  recursive_argument: ${rec}` : ''}\n}\n`;

// Each enumeration is the register's vocabulary plus `unrecorded` (or `undecided`) for its absence.
const enums = {
  Tier: [...r.vocabulary.tier.map(camel), 'unrecorded'],
  Status: [...r.vocabulary.status.map(camel), 'unrecorded'],
  TocStage: [...r.vocabulary.tocStages.map(camel), 'unrecorded'],
  Versioning: ['semver', 'other', 'unreleased'],
  StandardsOutcome: [...r.app.outcomes.map(camel), 'undecided'],
};
for (const [name, ctors] of Object.entries(enums)) {
  if (new Set(ctors).size !== ctors.length) throw new Error(`${name} has a repeated constructor`);
}
const ctor = (type, value) => `(ctor ${M}::${type}.${value})`;

// --- the model module ---
const m = [];
m.push(`\\begin{lexlean}{${M}}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\useglossary{prism.arch@1.0.0}\n\\title{Ecosystem model}\n\\begin{semanticmodule}`);
for (const [name, ctors] of Object.entries(enums)) {
  m.push(`inductive{\n  name: ${name},\n  type_parameters: [],\n  parameters: [],\n  constructors: [\n${ctors.map((c) => `    {name: ${c}, fields: []}`).join(',\n')}\n  ]\n}\n`);
}
// Whether a value is recorded, one branch per constructor, so a new vocabulary word is decided, never defaulted.
const recorded = (fn, type, absent) =>
  def(fn, `value : ${type}`, 'Bool', `(match value\n${enums[type].map((c) => `    | ${type}.${c} => ${c === absent ? 'false' : 'true'}`).join('\n')})`);
m.push(recorded('tierRecorded', 'Tier', 'unrecorded'));
m.push(recorded('statusRecorded', 'Status', 'unrecorded'));
m.push(def('isConformant', 'value : StandardsOutcome', 'Bool', `(match value\n${enums.StandardsOutcome.map((c) => `    | StandardsOutcome.${c} => ${c === camel(r.app.conformant) ? 'true' : 'false'}`).join('\n')})`));
m.push(`structure{\n  name: Snapshot,\n  type_parameters: [],\n  parameters: [],\n  fields: [\n${[
  ['query', 'String'], ['snapshotDigest', 'String'], ['norms', 'String'], ['app', 'String'], ['appDigest', 'String'],
  ['repositoryCount', 'Nat'], ['conformantCount', 'Nat'], ['openClaimCount', 'Nat'],
].map(([n, t]) => `    {name: ${n}, type: ${t}}`).join(',\n')}\n  ]\n}\n`);
m.push(`structure{\n  name: Repository,\n  type_parameters: [],\n  parameters: [],\n  fields: [\n${[
  ['index', 'Nat'], ['name', 'String'], ['archived', 'Bool'], ['language', 'String'], ['topics', 'String'],
  ['tier', 'Tier'], ['status', 'Status'], ['tocStage', 'TocStage'],
  ['identityTags', 'Bool'], ['tierTags', 'Nat'], ['statusTags', 'Nat'], ['versioning', 'Versioning'], ['releaseTags', 'Nat'],
  ['outcome', 'StandardsOutcome'],
].map(([n, t]) => `    {name: ${n}, type: ${t}}`).join(',\n')}\n  ]\n}\n`);
m.push(`structure{\n  name: OpenClaim,\n  type_parameters: [],\n  parameters: [],\n  fields: [\n    {name: index, type: Nat},\n    {name: repository, type: Nat},\n    {name: name, type: String},\n    {name: reason, type: String}\n  ]\n}\n`);
m.push(def('repositoriesNumbered', 'position : Nat, repositories : (List Repository)', 'Bool',
  `(match repositories\n    | List.nil => true\n    | List.cons repository rest => (((project repository index) =? position) && (repositoriesNumbered (position + 1) rest)))`, 'repositories'));
m.push(def('repositoryTotal', 'repositories : (List Repository)', 'Nat',
  '(match repositories\n    | List.nil => 0\n    | List.cons repository rest => (1 + (repositoryTotal rest)))', 'repositories'));
m.push(def('conformantTotal', 'repositories : (List Repository)', 'Nat',
  '(match repositories\n    | List.nil => 0\n    | List.cons repository rest => ((if (isConformant (project repository outcome)) then 1 else 0) + (conformantTotal rest)))', 'repositories'));
// A tier or status is recorded exactly when one tag of its kind is carried, as STANDARDS.md requires.
m.push(def('agree', 'left : Bool, right : Bool', 'Bool', '(if left then right else (not right))'));
m.push(def('tagsRead', 'repository : Repository', 'Bool',
  '((agree (tierRecorded (project repository tier)) ((project repository tierTags) =? 1)) && (agree (statusRecorded (project repository status)) ((project repository statusTags) =? 1)))'));
m.push(def('claimed', 'position : Nat, claims : (List OpenClaim)', 'Bool',
  '(match claims\n    | List.nil => false\n    | List.cons claim rest => (((project claim repository) =? position) || (claimed position rest)))', 'claims'));
m.push(def('repositoriesAccounted', 'claims : (List OpenClaim), repositories : (List Repository)', 'Bool',
  '(match repositories\n    | List.nil => true\n    | List.cons repository rest => (((tagsRead repository) && ((isConformant (project repository outcome)) || (claimed (project repository index) claims))) && (repositoriesAccounted claims rest)))', 'repositories'));
m.push(def('claimsNumbered', 'position : Nat, bound : Nat, claims : (List OpenClaim)', 'Bool',
  `(match claims\n    | List.nil => true\n    | List.cons claim rest => (((project claim index) =? position) && (((project claim repository) <=? bound) && (claimsNumbered (position + 1) bound rest))))`, 'claims'));
m.push(def('claimTotal', 'claims : (List OpenClaim)', 'Nat',
  '(match claims | List.nil => 0 | List.cons claim rest => (1 + (claimTotal rest)))', 'claims'));
m.push(def('registerValid', 'snapshot : Snapshot, repositories : (List Repository), claims : (List OpenClaim)', 'Bool',
  '(((repositoryTotal repositories) =? (project snapshot repositoryCount)) && (((conformantTotal repositories) =? (project snapshot conformantCount)) && (((claimTotal claims) =? (project snapshot openClaimCount)) && ((repositoriesNumbered 0 repositories) && ((repositoriesAccounted claims repositories) && (claimsNumbered 0 (repositoryTotal repositories) claims))))))'));
m[m.length - 1] = m[m.length - 1].trimEnd();
m.push('\\end{semanticmodule}\n\\end{lexlean}\n');

// --- the register module ---
const e = [];
e.push(`\\begin{lexlean}{Ecosystem}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\useglossary{prism.arch@1.0.0}\n\\importmodule{${M}}\n\\title{Ecosystem register}\n\\begin{semanticmodule}`);
const conformantCount = r.repositories.filter((x) => x.outcome === r.app.conformant).length;
e.push(def('snapshot', '', `${M}::Snapshot`, `(record ${M}::Snapshot {query := ${str(r.snapshot.query)}, snapshotDigest := ${str(`sha256:${r.snapshot.sha256}`)}, norms := ${str(r.norms.map((n) => `${n.path}#sha256:${n.sha256}`).join(' '))}, app := ${str(r.app.path)}, appDigest := ${str(`sha256:${r.app.sha256}`)}, repositoryCount := ${r.repositories.length}, conformantCount := ${conformantCount}, openClaimCount := ${r.refusals.length}})`));
const names = r.repositories.map((x) => {
  const name = `repo${camel(x.name.replace(/^\./, 'dot-'))[0].toUpperCase()}${camel(x.name.replace(/^\./, 'dot-')).slice(1)}`;
  const tier = x.tier ? camel(r.vocabulary.tier[['t1', 't2', 't3', 't4'].indexOf(x.tier)]) : 'unrecorded';
  e.push(def(name, '', `${M}::Repository`, `(record ${M}::Repository {index := ${x.index}, name := ${str(x.name)}, archived := ${x.archived}, language := ${str(x.language)}, topics := ${str(x.topics.join(' '))}, tier := ${ctor('Tier', tier)}, status := ${ctor('Status', x.status ? camel(x.status) : 'unrecorded')}, tocStage := ${ctor('TocStage', x.tocStage ? camel(x.tocStage) : 'unrecorded')}, identityTags := ${x.request.identity === 'present'}, tierTags := ${x.request.tiertags}, statusTags := ${x.request.statustags}, versioning := ${ctor('Versioning', x.request.versioning)}, releaseTags := ${x.tags}, outcome := ${ctor('StandardsOutcome', x.outcome ? camel(x.outcome) : 'undecided')}})`));
  return name;
});
if (new Set(names).size !== names.length) throw new Error('two repositories share a definition name');
const claims = r.refusals.map((c, i) => {
  e.push(def(`openClaim${i}`, '', `${M}::OpenClaim`, `(record ${M}::OpenClaim {index := ${i}, repository := ${c.repository}, name := ${str(c.refusal)}, reason := ${str(c.detail)}})`));
  return `openClaim${i}`;
});
const list = (type, xs) => xs.reduceRight((rest, n) => `(cons (${n}) ${rest})`, `(nil ${M}::${type})`);
e.push(def('repositories', '', `(List ${M}::Repository)`, list('Repository', names)));
e.push(def('openClaims', '', `(List ${M}::OpenClaim)`, list('OpenClaim', claims)));
e.push(`theorem{\n  name: ecosystemValidHolds,\n  parameters: [],\n  statement: ((${M}::registerValid (snapshot) (repositories) (openClaims)) = true),\n  proof: decide{}\n}`);
e.push('\\end{semanticmodule}\n\\end{lexlean}\n');

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Ecosystem/V1/Model.lex.tex', m.join('\n')],
  ['src/Ecosystem.lex.tex', e.join('\n')],
  ['language/prism.arch/entries/ecosystem-model.toml', entry('ecosystem-model', 'Ecosystem model', M, 'registerValid')],
  ['language/prism.arch/entries/ecosystem-register.toml', entry('ecosystem-register', 'Ecosystem register', 'Ecosystem', 'ecosystemValidHolds')],
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
process.stdout.write(`${names.length} repositories, ${conformantCount} conformant, ${claims.length} open claims\n`);
