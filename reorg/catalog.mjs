#!/usr/bin/env node
/**
 * Write the Foundation.Reorg.V1 facet from reorg/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Reorg/V1/Model.lex.tex  its types, whose request fields and
 *     dispositions are the uor-repo-disposition app's own, the app's first-hit
 *     table written from the prompt's rules, and registerValid;
 *   app/src/Reorg.lex.tex  every repository with its evidence commit, consumption
 *     edge, citation, candidate, norm gap and staged act, and the theorem that the
 *     register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid holds when every repository has the one disposition the app's table
 * gives its request (a fold the register refuses for want of a kept host is put to
 * review), every fold names a kept host other than itself and following hosts always
 * settles, so no fold cycle exists; every disposition is supported by a citation of
 * its kind; every consumer count is the consumption edges into it; every review is a
 * candidate; and every staged act is unexecuted, belongs to a repository that is not
 * kept, is conditional exactly when its repository is under review, and names a kept
 * host or none. The same register always writes the same bytes.
 *
 *   node reorg/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel, pascal } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const prompt = JSON.parse(readFileSync(join(here, '..', r.app.path), 'utf8'));
const app = prompt.app;
const M = 'Foundation.Reorg.V1.Model';

// The app's choice fields become enumerations, except a yes/no field, which is a Bool. The app's word "none" is
// written "absent", so no constructor shares a name with Lean's Option.none.
const ctor = (v) => (v === 'none' ? 'absent' : v);
const boolField = (f) => f.values.join() === 'yes,no';
const enumFields = app.fields.filter((f) => !boolField(f));
const enums = Object.fromEntries(enumFields.map((f) => [pascal(f.name), f.values.map(ctor)]));
enums.Disposition = app.outcomes;
enums.Signal = ['archivedFlag', 'deprecation', 'supersession', 'relocation', 'reservedName', 'familyHub', 'familyMember', 'soleConsumer', 'sharedConsumer', 'purposeNames', 'recentActivity', 'quietActivity', 'purpose'];
enums.DependencyKind = ['crate', 'npm', 'pypi', 'workflow', 'submodule'];
enums.Action = ['tocApplication', 'maintainerNotice', 'subtreeAdd', 'hostPullRequest', 'readmeRedirect', 'transferIssues', 'statusTopic', 'archiveRepository'];
for (const [name, values] of Object.entries(enums)) {
  if (new Set(values.map(camel)).size !== values.length) throw new Error(`${name} has a repeated constructor`);
}
for (const s of new Set(r.citations.map((c) => c.signal))) if (!enums.Signal.includes(s)) throw new Error(`the register cites the undeclared signal ${s}`);
for (const a of new Set(r.acts.map((x) => x.action))) if (!enums.Action.includes(a)) throw new Error(`the register stages the undeclared action ${a}`);

// Which signals support which disposition: the evidence each rule of the app reads.
const SUPPORTS = {
  keep: ['recentActivity', 'reservedName'],
  archive: ['archivedFlag', 'deprecation'],
  fold: ['supersession'],
  review: ['relocation', 'familyMember', 'soleConsumer', 'purposeNames', 'quietActivity'],
};
if (Object.keys(SUPPORTS).join() !== app.outcomes.join()) throw new Error('every disposition needs its supporting signals');
const predicate = (name, type, holds) =>
  def(name, [`value : ${type}`], 'Bool', match('value', enums[type].map((v) => [`${type}.${camel(v)}`, holds(v) ? 'true' : 'false'])));
const is = (f, v) => `${camel(f.name)}Is${pascal(ctor(v))}`;
const cond = (c) => {
  const f = app.fields.find((x) => x.name === c.field);
  const term = boolField(f)
    ? (c.value === 'yes' ? `(project repository ${f.name})` : `(not (project repository ${f.name}))`)
    : `(${is(f, c.value)} (project repository ${f.name}))`;
  if (c.op === 'is') return term;
  if (c.op === 'is not') return `(not ${term})`;
  throw new Error(`the table uses the operator ${c.op}`);
};
const and = (xs) => xs.reduceRight((rest, x) => (rest === null ? x : `(${x} && ${rest})`), null);
const or = (xs) => (xs.length ? xs.reduceRight((rest, x) => (rest === null ? x : `(${x} || ${rest})`), null) : 'false');
// The first rule that matches, numbered from 1; 0 is the app's otherwise.
const firstRule = app.rules.reduceRight((rest, rule, i) => `(if ${and(rule.when.map(cond))} then ${i + 1} else ${rest})`, '0');
const gives = (outcome) => [...app.rules.map((x, i) => (x.then === outcome ? i + 1 : -1)).filter((n) => n > 0), ...(app.otherwise === outcome ? [0] : [])];
const R = { ref: 'Repository' };
const lookup = (name, kind, list, at, result, body) =>
  def(name, [`values : (List ${kind})`, 'at : Nat'], result, match('values', [['List.nil', at], [`List.cons ${list} rest`, body]]), 'values');
const every = (name, params, kind, v, body) =>
  def(name, [...params, `values : (List ${kind})`], 'Bool', match('values', [['List.nil', 'true'], [`List.cons ${v} rest`, `(${body} && (${name} ${params.map((p) => p.split(' ')[0]).join(' ')}${params.length ? ' ' : ''}rest))`]]), 'values');
const total = (name, test) =>
  def(name, ['values : (List Repository)'], 'Nat', match('values', [['List.nil', '0'], ['List.cons repository rest', `((if (${test} (project repository disposition)) then 1 else 0) + (${name} rest))`]]), 'values');

const decl = {
  module: M,
  title: 'Reorganization model',
  catalog: 'Reorg',
  catalogTitle: 'Reorganization register',
  enums,
  kinds: [
    {
      name: 'Repository',
      list: 'repositories',
      fields: [
        ['name', 'String'], ['commit', 'String'], ['lastCommit', 'String'], ['recentCommits', 'Nat'], ['dependents', 'Nat'],
        ...app.fields.map((f) => [f.name, boolField(f) ? 'Bool' : { enum: pascal(f.name) }]),
        ['disposition', { enum: 'Disposition' }], ['host', R], ['hostRefused', 'Bool'], ['ruleId', 'String'], ['purpose', 'String'],
      ],
      checks: ['(consumerAgrees (project $ consumer) (project $ dependents))', '(activityAgrees (project $ activity) (project $ recentCommits))', '(dispositionFollows $)'],
    },
    { name: 'Dependency', list: 'dependencies', fields: [['source', R], ['target', R], ['kind', { enum: 'DependencyKind' }], ['file', 'String'], ['line', 'Nat']], checks: ['(not ((project $ source) =? (project $ target)))'] },
    { name: 'Citation', list: 'citations', fields: [['repository', R], ['signal', { enum: 'Signal' }], ['source', 'String'], ['line', 'Nat'], ['text', 'String']] },
    { name: 'Candidate', list: 'candidates', fields: [['repository', R], ['host', R], ['refusal', 'String'], ['signals', 'String'], ['detail', 'String']] },
    { name: 'NormGap', list: 'normGaps', fields: [['norm', 'String'], ['digest', 'String'], ['refusal', 'String'], ['detail', 'String']] },
    {
      name: 'Act',
      list: 'acts',
      fields: [['repository', R], ['host', R], ['step', 'Nat'], ['action', { enum: 'Action' }], ['command', 'String'], ['precondition', 'String'], ['conditional', 'Bool'], ['executed', 'Bool']],
      checks: ['(not (project $ executed))', '(0 <? (project $ step))'],
    },
  ],
  release: [
    ['snapshotDigest', 'String'], ['asOf', 'String'], ['windowDays', 'Nat'], ['setDigest', 'String'], ['norms', 'String'], ['platform', 'String'],
    ['app', 'String'], ['appDigest', 'String'], ['builder', 'String'],
    ['keepCount', 'Nat'], ['archiveCount', 'Nat'], ['foldCount', 'Nat'], ['reviewCount', 'Nat'],
  ],
  definitions: [
    ...enumFields.flatMap((f) => f.values.map((v) => predicate(is(f, v), pascal(f.name), (x) => x === ctor(v)))),
    ...app.outcomes.map((o) => predicate(`is${pascal(o)}`, 'Disposition', (x) => x === o)),
    ...app.outcomes.map((o) => predicate(`supports${pascal(o)}`, 'Signal', (x) => SUPPORTS[o].includes(x))),
    def('supports', ['disposition : Disposition', 'signal : Signal'], 'Bool', match('disposition', app.outcomes.map((o) => [`Disposition.${camel(o)}`, `(supports${pascal(o)} signal)`]))),
    def('agree', ['left : Bool', 'right : Bool'], 'Bool', '(if left then right else (not right))'),
    def('consumerAgrees', ['consumer : Consumer', 'amount : Nat'], 'Bool', match('consumer', [['Consumer.absent', '(amount =? 0)'], ['Consumer.sole', '(amount =? 1)'], ['Consumer.shared', '(1 <? amount)']])),
    def('activityAgrees', ['activity : Activity', 'amount : Nat'], 'Bool', match('activity', [['Activity.recent', '(0 <? amount)'], ['Activity.quiet', '(amount =? 0)']])),
    // The app's table, rule by rule, as the uor-repo-disposition prompt states it.
    def('firstRule', ['repository : Repository'], 'Nat', firstRule),
    def('ruleGives', ['position : Nat', 'disposition : Disposition'], 'Bool', match('disposition', app.outcomes.map((o) => [`Disposition.${camel(o)}`, or(gives(o).map((n) => `(position =? ${n})`))]))),
    def('ruleFolds', ['position : Nat'], 'Bool', or(gives('fold').map((n) => `(position =? ${n})`))),
    def('dispositionFollows', ['repository : Repository'], 'Bool',
      '(if (project repository hostRefused) then ((ruleFolds (firstRule repository)) && (isReview (project repository disposition))) else (ruleGives (firstRule repository) (project repository disposition)))'),
    total('keptTotal', 'isKeep'), total('archivedTotal', 'isArchive'), total('foldedTotal', 'isFold'), total('reviewedTotal', 'isReview'),
    lookup('keptAt', 'Repository', 'repository', 'false', 'Bool', '(if ((project repository index) =? at) then (isKeep (project repository disposition)) else (keptAt rest at))'),
    lookup('reviewAt', 'Repository', 'repository', 'false', 'Bool', '(if ((project repository index) =? at) then (isReview (project repository disposition)) else (reviewAt rest at))'),
    lookup('hostAt', 'Repository', 'repository', '0', 'Nat', '(if ((project repository index) =? at) then (project repository host) else (hostAt rest at))'),
    every('foldsSound', ['allRepos : (List Repository)'], 'Repository', 'repository',
      '(if (isFold (project repository disposition)) then ((not ((project repository host) =? (project repository index))) && (keptAt allRepos (project repository host))) else ((project repository host) =? (project repository index)))'),
    // Following hosts from any repository reaches one that is its own host within as many steps as there are
    // repositories, so no chain of folds returns to where it started.
    def('settles', ['allRepos : (List Repository)', 'fuel : (List Repository)', 'at : Nat'], 'Bool',
      match('fuel', [['List.nil', 'false'], ['List.cons spent rest', '(if ((hostAt allRepos at) =? at) then true else (settles allRepos rest (hostAt allRepos at)))']]), 'fuel'),
    every('foldsSettle', ['allRepos : (List Repository)'], 'Repository', 'repository', '(settles allRepos allRepos (project repository index))'),
    def('supportedBy', ['values : (List Citation)', 'at : Nat', 'disposition : Disposition'], 'Bool',
      match('values', [['List.nil', 'false'], ['List.cons citation rest', '((((project citation repository) =? at) && (supports disposition (project citation signal))) || (supportedBy rest at disposition))']]), 'values'),
    every('dispositionsCited', ['allCites : (List Citation)'], 'Repository', 'repository', '(supportedBy allCites (project repository index) (project repository disposition))'),
    lookup('dependentsOf', 'Dependency', 'dependency', '0', 'Nat', '((if ((project dependency target) =? at) then 1 else 0) + (dependentsOf rest at))'),
    every('dependentsCounted', ['allDeps : (List Dependency)'], 'Repository', 'repository', '((project repository dependents) =? (dependentsOf allDeps (project repository index)))'),
    every('actsSound', ['allRepos : (List Repository)'], 'Act', 'act',
      '((not (keptAt allRepos (project act repository))) && ((agree (project act conditional) (reviewAt allRepos (project act repository))) && (((project act host) =? (project act repository)) || (keptAt allRepos (project act host)))))'),
    lookup('claimedAt', 'Candidate', 'candidate', 'false', 'Bool', '(((project candidate repository) =? at) || (claimedAt rest at))'),
    every('reviewsClaimed', ['allCandidates : (List Candidate)'], 'Repository', 'repository', '(if (isReview (project repository disposition)) then (claimedAt allCandidates (project repository index)) else true)'),
    every('candidatesSound', ['allRepos : (List Repository)'], 'Candidate', 'candidate',
      '((reviewAt allRepos (project candidate repository)) && (((project candidate host) =? (project candidate repository)) || (keptAt allRepos (project candidate host))))'),
  ],
  checks: [
    '((keptTotal repositories) =? (project release keepCount))',
    '((archivedTotal repositories) =? (project release archiveCount))',
    '((foldedTotal repositories) =? (project release foldCount))',
    '((reviewedTotal repositories) =? (project release reviewCount))',
    '((((keptTotal repositories) + (archivedTotal repositories)) + ((foldedTotal repositories) + (reviewedTotal repositories))) =? (project release repositoriesCount))',
    '(foldsSound repositories repositories)',
    '(foldsSettle repositories repositories)',
    '(dispositionsCited citations repositories)',
    '(dependentsCounted dependencies repositories)',
    '(actsSound repositories acts)',
    '(reviewsClaimed candidates repositories)',
    '(candidatesSound repositories candidates)',
  ],
};

const records = {
  repositories: r.repositories.map((x) => ({
    name: x.name, commit: x.commit, lastCommit: x.lastCommit, recentCommits: x.recentCommits, dependents: x.dependents,
    ...Object.fromEntries(app.fields.map((f) => [f.name, boolField(f) ? x.request[f.name] === 'yes' : ctor(x.request[f.name])])),
    disposition: x.disposition, host: x.host, hostRefused: x.refusal === 'host-not-kept', ruleId: x.rule, purpose: x.purpose,
  })),
  dependencies: r.dependencies.map((d) => ({ source: d.from, target: d.to, kind: d.kind, file: d.file, line: d.line })),
  citations: r.citations,
  candidates: r.candidates,
  normGaps: r.normGaps.map((g) => ({ norm: g.norm, digest: `sha256:${g.sha256}`, refusal: g.refusal, detail: g.detail })),
  acts: r.acts,
};
const count = (x) => r.repositories.filter((y) => y.disposition === x).length;
const release = {
  snapshotDigest: `sha256:${r.snapshot.sha256}`,
  asOf: r.snapshot.asOf,
  windowDays: r.snapshot.window.days,
  setDigest: `${r.snapshot.set.path}#sha256:${r.snapshot.set.sha256}`,
  norms: r.norms.map((n) => `${n.path}#sha256:${n.sha256}`).join(' '),
  platform: r.platform.map((p) => `${p.url}#sha256:${p.sha256}`).join(' '),
  app: r.app.path,
  appDigest: `sha256:${r.app.sha256}`,
  builder: `${r.app.builder.repository}@${r.app.builder.commit}`,
  keepCount: count('keep'), archiveCount: count('archive'), foldCount: count('fold'), reviewCount: count('review'),
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;
const appDir = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Reorg/V1/Model.lex.tex', typesModule(decl)],
  ['src/Reorg.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/reorg-model.toml', entry('reorg-model', 'Reorganization model', M, 'registerValid')],
  ['language/prism.arch/entries/reorg-register.toml', entry('reorg-register', 'Reorganization register', 'Reorg', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(appDir, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of reorg/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
process.stdout.write(`${records.repositories.length} repositories (${['keep', 'archive', 'fold', 'review'].map((x) => `${count(x)} ${x}`).join(', ')}), ${records.candidates.length + records.normGaps.length} open claims, ${records.acts.length} staged acts\n`);
