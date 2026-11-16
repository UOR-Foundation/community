#!/usr/bin/env node
/**
 * Write the Foundation.Policy.V1 facet from policies/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Policy/V1/Model.lex.tex  its types and registerValid;
 *   app/src/Policies.lex.tex  every source, authority, standard model and
 *     model section, policy, clause, derivation, citation, carried excerpt,
 *     substitution, requirement and its coverage, post, record class and
 *     retention basis, staged act and open claim, and the theorem that the
 *     register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid checks, besides every reference and count, that every clause
 * cites an authority; that every section of every standard model is projected
 * by exactly one clause and every model clause by exactly one section; that
 * every carried clause carries an excerpt; that every named substitution is
 * applied; that every mandatory requirement (Form 990 Part VI lines 12a, 12b,
 * 12c, 13 and 14, and Bylaws 10.3) is covered by a clause and every other
 * requirement is covered or an open claim; that every post a policy names is
 * held or an open claim; that every record class keeps the longest period its
 * authorities state, and is an open claim when none states one; that every
 * staged act is unexecuted and an open claim; that every authority is the law
 * of the entity's jurisdiction or the nation that contains it; and that every
 * open claim names a subject that exists. The same register always writes the
 * same bytes.
 *
 *   node policies/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Policy.V1.Model';

const enums = {
  // ISO 3166-2 codes for the jurisdictions an authority can belong to.
  Jurisdiction: ['us', 'us-co'],
  Instrument: ['statute', 'regulation', 'instructions', 'publication', 'agencyGuidance', 'form', 'model', 'filedRecord', 'bylaws', 'governance'],
  ClauseKind: ['model', 'carried', 'composed', 'schedule'],
  // The order is the order of length: a period that is stated outlasts none, permanent outlasts every other.
  Period: ['unstated', 'current', 'years', 'permanent'],
  ActKind: ['boardResolution', 'filing', 'recurring', 'publication'],
  SubjectKind: ['requirement', 'post', 'recordClass', 'act'],
};
const table = (name, type, value) => def(name, [`value : ${type}`], typeof value(enums[type][0]) === 'boolean' ? 'Bool' : 'Nat',
  match('value', enums[type].map((v) => [`${type}.${camel(v)}`, String(value(v))])));
const SUBJECT = Object.fromEntries(enums.SubjectKind.map((k, i) => [k, i]));
const call = (name, params) => [name, ...params.map((p) => p.split(' ')[0]), 'rest'].join(' ');
const any = (name, params, test, list, kind) => def(name, [...params, `values : (List ${kind})`], 'Bool',
  match('values', [['List.nil', 'false'], [`List.cons ${list} rest`, `(${test} || (${call(name, params)}))`]]), 'values');
const all = (name, params, test, list, kind) => def(name, [...params, `values : (List ${kind})`], 'Bool',
  match('values', [['List.nil', 'true'], [`List.cons ${list} rest`, `(${test} && (${call(name, params)}))`]]), 'values');
const count = (name, params, test, list, kind) => def(name, [...params, `values : (List ${kind})`], 'Nat',
  match('values', [['List.nil', '0'], [`List.cons ${list} rest`, `((if ${test} then 1 else 0) + (${call(name, params)}))`]]), 'values');

const decl = {
  module: M,
  title: 'Policy model',
  catalog: 'Policies',
  catalogTitle: 'Policy register',
  enums,
  release: [['legalName', 'String'], ['coloradoId', 'String'], ['jurisdiction', { enum: 'Jurisdiction' }], ['boardSeats', 'Nat'], ['governanceDigest', 'String'], ['nonprofitDigest', 'String'], ['snapshotDigest', 'String'], ['clausesDigest', 'String'], ['pdftotext', 'String'], ['pdftohtml', 'String']],
  kinds: [
    { name: 'Source', list: 'sources', fields: [['key', 'String'], ['url', 'String'], ['fetchedAt', 'String'], ['digest', 'String']] },
    { name: 'Authority', list: 'authorities', fields: [['key', 'String'], ['instrument', { enum: 'Instrument' }], ['ref', 'String'], ['title', 'String'], ['jurisdiction', { enum: 'Jurisdiction' }], ['source', { ref: 'Source' }], ['digest', 'String']] },
    { name: 'StandardModel', list: 'models', fields: [['key', 'String'], ['title', 'String'], ['revision', 'String'], ['source', { ref: 'Source' }], ['authority', { ref: 'Authority' }]] },
    { name: 'ModelSection', list: 'sections', fields: [['model', { ref: 'StandardModel' }], ['number', 'String'], ['title', 'String'], ['numberStated', 'Bool'], ['digest', 'String']] },
    { name: 'Policy', list: 'policies', fields: [['key', 'String'], ['title', 'String'], ['draft', 'String'], ['standard', 'String'], ['clauseCount', 'Nat'], ['draftDigest', 'String']] },
    { name: 'Clause', list: 'clauses', fields: [['policy', { ref: 'Policy' }], ['number', 'String'], ['group', 'String'], ['heading', 'String'], ['kind', { enum: 'ClauseKind' }], ['text', 'String'], ['digest', 'String'], ['substitutions', 'String']] },
    { name: 'Derivation', list: 'derivations', fields: [['clause', { ref: 'Clause' }], ['section', { ref: 'ModelSection' }]] },
    { name: 'Citation', list: 'citations', fields: [['clause', { ref: 'Clause' }], ['authority', { ref: 'Authority' }]] },
    { name: 'Carry', list: 'carries', fields: [['clause', { ref: 'Clause' }], ['authority', { ref: 'Authority' }], ['excerpt', 'String'], ['digest', 'String']] },
    { name: 'Substitution', list: 'substitutions', fields: [['id', 'String'], ['replaced', 'String'], ['replacement', 'String'], ['basis', { ref: 'Authority' }], ['applied', 'Nat']] },
    { name: 'Requirement', list: 'requirements', fields: [['key', 'String'], ['policy', { ref: 'Policy' }], ['label', 'String'], ['authority', { ref: 'Authority' }], ['mandatory', 'Bool']] },
    { name: 'Coverage', list: 'coverages', fields: [['requirement', { ref: 'Requirement' }], ['clause', { ref: 'Clause' }]] },
    { name: 'Post', list: 'posts', fields: [['name', 'String'], ['unit', 'String'], ['governanceIndex', 'Nat'], ['held', 'Bool'], ['basis', { ref: 'Authority' }]] },
    { name: 'RecordClass', list: 'recordClasses', fields: [['name', 'String'], ['period', { enum: 'Period' }], ['years', 'Nat'], ['condition', 'String']] },
    { name: 'RetentionBasis', list: 'bases', fields: [['recordClass', { ref: 'RecordClass' }], ['authority', { ref: 'Authority' }], ['period', { enum: 'Period' }], ['years', 'Nat'], ['at', 'String']] },
    { name: 'StagedAct', list: 'acts', fields: [['key', 'String'], ['policy', 'String'], ['kind', { enum: 'ActKind' }], ['name', 'String'], ['voteRuleApplies', 'Bool'], ['voteRule', 'Nat'], ['threshold', 'String'], ['authority', { ref: 'Authority' }], ['executed', 'Bool'], ['preconditions', 'String'], ['steps', 'String']] },
    { name: 'OpenClaim', list: 'openClaims', fields: [['area', 'String'], ['subjectKind', { enum: 'SubjectKind' }], ['subject', 'Nat'], ['refusal', 'String'], ['detail', 'String'], ['closes', 'String']] },
  ],
  definitions: [
    table('jurisdictionCode', 'Jurisdiction', (v) => ({ us: 1, 'us-co': 2 })[v]),
    // ISO 3166-2: US-CO is a subdivision of US; US has no parent.
    table('jurisdictionParent', 'Jurisdiction', (v) => ({ us: 0, 'us-co': 1 })[v]),
    table('isModelClause', 'ClauseKind', (v) => v === 'model'),
    table('isCarriedClause', 'ClauseKind', (v) => v === 'carried'),
    table('periodRank', 'Period', (v) => enums.Period.indexOf(v)),
    table('isUnstated', 'Period', (v) => v === 'unstated'),
    table('subjectCode', 'SubjectKind', (v) => SUBJECT[v]),
    def('natMax', ['left : Nat', 'right : Nat'], 'Nat', '(if (left <? right) then right else left)'),
    def('governs', ['law : Jurisdiction', 'home : Jurisdiction'], 'Bool', '(((jurisdictionCode law) =? (jurisdictionCode home)) || ((jurisdictionCode law) =? (jurisdictionParent home)))'),
    all('authoritiesGovern', ['home : Jurisdiction'], '(governs (project authority jurisdiction) home)', 'authority', 'Authority'),
    any('clauseCited', ['at : Nat'], '((project citation clause) =? at)', 'citation', 'Citation'),
    all('clausesCited', ['allCitations : (List Citation)'], '(clauseCited (project clause index) allCitations)', 'clause', 'Clause'),
    count('clauseDerivations', ['at : Nat'], '((project derivation clause) =? at)', 'derivation', 'Derivation'),
    count('sectionDerivations', ['at : Nat'], '((project derivation section) =? at)', 'derivation', 'Derivation'),
    all('clausesDerived', ['allDerivations : (List Derivation)'], '((clauseDerivations (project clause index) allDerivations) =? (if (isModelClause (project clause kind)) then 1 else 0))', 'clause', 'Clause'),
    all('sectionsOnce', ['allDerivations : (List Derivation)'], '((sectionDerivations (project section index) allDerivations) =? 1)', 'section', 'ModelSection'),
    any('clauseCarries', ['at : Nat'], '((project carry clause) =? at)', 'carry', 'Carry'),
    all('clausesCarried', ['allCarries : (List Carry)'], '((not (isCarriedClause (project clause kind))) || (clauseCarries (project clause index) allCarries))', 'clause', 'Clause'),
    all('substitutionsApplied', [], '(0 <? (project substitution applied))', 'substitution', 'Substitution'),
    any('claimedAs', ['kind : Nat', 'at : Nat'], '(((subjectCode (project claim subjectKind)) =? kind) && ((project claim subject) =? at))', 'claim', 'OpenClaim'),
    any('requirementCovered', ['at : Nat'], '((project coverage requirement) =? at)', 'coverage', 'Coverage'),
    all('requirementsAccounted', ['claims : (List OpenClaim)', 'allCoverages : (List Coverage)'], `((requirementCovered (project requirement index) allCoverages) || ((not (project requirement mandatory)) && (claimedAs ${SUBJECT.requirement} (project requirement index) claims)))`, 'requirement', 'Requirement'),
    all('postsAccounted', ['claims : (List OpenClaim)'], `((project post held) || (claimedAs ${SUBJECT.post} (project post index) claims))`, 'post', 'Post'),
    def('classRank', ['at : Nat', 'values : (List RetentionBasis)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons basis rest', '(natMax (if ((project basis recordClass) =? at) then (periodRank (project basis period)) else 0) (classRank at rest))']]), 'values'),
    def('classYears', ['at : Nat', 'rank : Nat', 'values : (List RetentionBasis)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons basis rest', '(natMax (if (((project basis recordClass) =? at) && ((periodRank (project basis period)) =? rank)) then (project basis years) else 0) (classYears at rank rest))']]), 'values'),
    all('classesSettled', ['claims : (List OpenClaim)', 'allBases : (List RetentionBasis)'], `(((periodRank (project recordClass period)) =? (classRank (project recordClass index) allBases)) && (((project recordClass years) =? (classYears (project recordClass index) (periodRank (project recordClass period)) allBases)) && ((not (isUnstated (project recordClass period))) || (claimedAs ${SUBJECT.recordClass} (project recordClass index) claims))))`, 'recordClass', 'RecordClass'),
    all('actsStaged', ['claims : (List OpenClaim)'], `((not (project act executed)) && (claimedAs ${SUBJECT.act} (project act index) claims))`, 'act', 'StagedAct'),
    def('subjectBound', ['value : SubjectKind', 'requirementBound : Nat', 'postBound : Nat', 'classBound : Nat', 'actBound : Nat'], 'Nat',
      match('value', [['SubjectKind.requirement', 'requirementBound'], ['SubjectKind.post', 'postBound'], ['SubjectKind.recordClass', 'classBound'], ['SubjectKind.act', 'actBound']])),
    all('claimsNamed', ['requirementBound : Nat', 'postBound : Nat', 'classBound : Nat', 'actBound : Nat'], '((project claim subject) <? (subjectBound (project claim subjectKind) requirementBound postBound classBound actBound))', 'claim', 'OpenClaim'),
  ],
  checks: [
    '(authoritiesGovern (project release jurisdiction) authorities)',
    '(clausesCited citations clauses)',
    '(clausesDerived derivations clauses)',
    '(sectionsOnce derivations sections)',
    '((derivationsTotal derivations) =? (sectionsTotal sections))',
    '(clausesCarried carries clauses)',
    '(substitutionsApplied substitutions)',
    '(requirementsAccounted openClaims coverages requirements)',
    '(postsAccounted openClaims posts)',
    '(classesSettled openClaims bases recordClasses)',
    '(actsStaged openClaims acts)',
    '(claimsNamed (requirementsTotal requirements) (postsTotal posts) (recordClassesTotal recordClasses) (actsTotal acts) openClaims)',
  ],
};

const lower = (j) => j.toLowerCase();
const records = {
  sources: r.sources,
  authorities: r.authorities.map((a) => ({ ...a, jurisdiction: lower(a.jurisdiction), digest: `sha256:${a.textSha256}` })),
  models: r.models,
  sections: r.sections.map((s) => ({ ...s, digest: `sha256:${s.textSha256}` })),
  policies: r.policies.map((p) => ({ ...p, clauseCount: p.clauses, draftDigest: `sha256:${p.draftSha256}` })),
  clauses: r.clauses.map((c) => ({ ...c, digest: `sha256:${c.textSha256}` })),
  derivations: r.derivations,
  citations: r.citations,
  carries: r.carries.map((c) => ({ ...c, digest: `sha256:${c.excerptSha256}` })),
  substitutions: r.substitutions.map((s) => ({ ...s, replaced: s.from, replacement: s.to })),
  requirements: r.requirements,
  coverages: r.coverages,
  posts: r.posts,
  recordClasses: r.recordClasses,
  bases: r.bases,
  acts: r.acts,
  openClaims: r.claims,
};
const digestOf = (key) => r.sources.find((s) => s.key === key).digest;
const release = {
  legalName: r.entity.legalName,
  coloradoId: r.entity.coloradoId,
  jurisdiction: lower(r.entity.jurisdiction),
  boardSeats: r.entity.boardSeats,
  governanceDigest: digestOf('governance/register.json'),
  nonprofitDigest: digestOf('nonprofit/register.json'),
  snapshotDigest: digestOf('policies/snapshot.json'),
  clausesDigest: digestOf('policies/clauses.json'),
  pdftotext: r.tools.pdftotext,
  pdftohtml: r.tools.pdftohtml,
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Policy/V1/Model.lex.tex', typesModule(decl)],
  ['src/Policies.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/policy-model.toml', entry('policy-model', 'Policy model', M, 'registerValid')],
  ['language/prism.arch/entries/policy-register.toml', entry('policy-register', 'Policy register', 'Policies', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of policies/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
process.stdout.write(`${records.policies.length} policies, ${records.clauses.length} clauses (${records.derivations.length} from ${records.sections.length} model sections), ${records.requirements.length} requirements, ${records.recordClasses.length} record classes, ${records.acts.length} staged acts, ${records.openClaims.length} open claims\n`);
