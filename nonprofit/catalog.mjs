#!/usr/bin/env node
/**
 * Write the Foundation.Nonprofit.V1 facet from nonprofit/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Nonprofit/V1/Model.lex.tex  its types and registerValid;
 *   app/src/Nonprofit.lex.tex  every source, authority, post, obligation,
 *     filing, IRS observation, website statement, Form 990 Part VI line,
 *     financial need and open claim, and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid checks, besides every reference and count, that every
 * obligation cites the authority it names and is assigned to its post by a
 * Bylaws provision, that every authority is the law of the entity's
 * jurisdiction or of the nation that contains it, that every obligation not
 * discharged, every unanswered Part VI line, every financial need and every
 * unconfirmed status statement is an open claim, that every open claim names a
 * subject that exists, and that the entity is recorded as recognized exactly
 * when IRS recognition data matched it. The same register always writes the
 * same bytes.
 *
 *   node nonprofit/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Nonprofit.V1.Model';

// ISO 3166-2 codes for the jurisdictions an authority can belong to; the vocabularies are the register's own.
const enums = {
  Jurisdiction: ['us', 'us-co'],
  Instrument: ['statute', 'regulation', 'instructions', 'agencyGuidance', 'form', 'bylaws'],
  Cadence: ['once', 'annual', 'continuous', 'onEvent'],
  Applicability: ['standing', 'conditional'],
  // active and pending: Schema.org ActionStatusType ActiveActionStatus, an act the Foundation states is under way.
  ObligationStatus: ['discharged', 'undischarged', 'unobservable', 'undetermined', 'active'],
  Shows: ['recognition', 'filing'],
  Consistency: ['verified', 'unverified', 'pending'],
  LineStatus: ['evidenced', 'open'],
  SubjectKind: ['entity', 'obligation', 'line', 'statement', 'need', 'observation'],
};
// One branch per constructor, so a new word is decided, never defaulted.
const table = (name, type, value) => def(name, [`value : ${type}`], typeof value(enums[type][0]) === 'boolean' ? 'Bool' : 'Nat',
  match('value', enums[type].map((v) => [`${type}.${camel(v)}`, String(value(v))])));
const SUBJECT = Object.fromEntries(enums.SubjectKind.map((k, i) => [k, i]));

const decl = {
  module: M,
  title: 'Nonprofit model',
  catalog: 'Nonprofit',
  catalogTitle: 'Nonprofit register',
  enums,
  release: [
    ['legalName', 'String'], ['coloradoId', 'String'], ['foundingDate', 'String'], ['standing', 'String'],
    ['jurisdiction', { enum: 'Jurisdiction' }], ['nonprofitStatusClaimed', 'String'], ['recognitionObserved', 'Bool'],
    ['governanceDigest', 'String'], ['appDigest', 'String'], ['snapshotDigest', 'String'], ['pdftotext', 'String'],
  ],
  kinds: [
    { name: 'Source', list: 'sources', fields: [['key', 'String'], ['url', 'String'], ['fetchedAt', 'String'], ['digest', 'String']] },
    { name: 'Authority', list: 'authorities', fields: [['key', 'String'], ['instrument', { enum: 'Instrument' }], ['ref', 'String'], ['title', 'String'], ['jurisdiction', { enum: 'Jurisdiction' }], ['source', { ref: 'Source' }], ['digest', 'String']] },
    { name: 'Post', list: 'posts', fields: [['name', 'String'], ['unit', 'String'], ['governanceIndex', 'Nat']], checks: ['((project $ governanceIndex) =? position)'] },
    {
      name: 'Obligation', list: 'obligations',
      fields: [['name', 'String'], ['authority', { ref: 'Authority' }], ['post', { ref: 'Post' }], ['basis', { ref: 'Authority' }], ['cadence', { enum: 'Cadence' }], ['applicability', { enum: 'Applicability' }], ['status', { enum: 'ObligationStatus' }], ['due', 'String'], ['evidence', 'String'], ['observed', 'String']],
    },
    { name: 'Citation', list: 'citations', fields: [['obligation', { ref: 'Obligation' }], ['authority', { ref: 'Authority' }]] },
    { name: 'Filing', list: 'filings', fields: [['event', 'String'], ['dateFiled', 'String'], ['document', 'String'], ['digest', 'String']] },
    {
      name: 'Observation', list: 'observations',
      fields: [['dataset', 'String'], ['source', { ref: 'Source' }], ['shows', { enum: 'Shows' }], ['rows', 'Nat'], ['matched', 'Nat'], ['near', 'Nat']],
      checks: ['((project $ matched) <? ((project $ near) + 1))', '((project $ near) <? ((project $ rows) + 1))'],
    },
    { name: 'Statement', list: 'statements', fields: [['path', 'String'], ['line', 'Nat'], ['text', 'String'], ['claim', 'String'], ['consistency', { enum: 'Consistency' }], ['source', { ref: 'Source' }]] },
    { name: 'PartSixLine', list: 'lines', fields: [['line', 'String'], ['section', 'String'], ['question', 'String'], ['digest', 'String'], ['policy', 'String'], ['status', { enum: 'LineStatus' }], ['evidence', 'String']] },
    { name: 'Need', list: 'needs', fields: [['name', 'String'], ['part', { ref: 'Authority' }], ['provision', { ref: 'Authority' }]] },
    { name: 'OpenClaim', list: 'openClaims', fields: [['area', 'String'], ['subjectKind', { enum: 'SubjectKind' }], ['subject', 'Nat'], ['refusal', 'String'], ['detail', 'String'], ['closes', 'String']] },
  ],
  definitions: [
    table('jurisdictionCode', 'Jurisdiction', (v) => ({ us: 1, 'us-co': 2 })[v]),
    // ISO 3166-2: US-CO is a subdivision of US; US has no parent.
    table('jurisdictionParent', 'Jurisdiction', (v) => ({ us: 0, 'us-co': 1 })[v]),
    table('isBylaws', 'Instrument', (v) => v === 'bylaws'),
    table('isDischarged', 'ObligationStatus', (v) => v === 'discharged'),
    table('isRecognition', 'Shows', (v) => v === 'recognition'),
    table('isVerified', 'Consistency', (v) => v === 'verified'),
    table('isEvidenced', 'LineStatus', (v) => v === 'evidenced'),
    table('subjectCode', 'SubjectKind', (v) => SUBJECT[v]),
    def('agree', ['left : Bool', 'right : Bool'], 'Bool', '(if left then right else (not right))'),
    def('governs', ['law : Jurisdiction', 'home : Jurisdiction'], 'Bool', '(((jurisdictionCode law) =? (jurisdictionCode home)) || ((jurisdictionCode law) =? (jurisdictionParent home)))'),
    def('authoritiesGovern', ['home : Jurisdiction', 'values : (List Authority)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons authority rest', '((governs (project authority jurisdiction) home) && (authoritiesGovern home rest))']]), 'values'),
    def('bylawsAt', ['values : (List Authority)', 'at : Nat'], 'Bool',
      match('values', [['List.nil', 'false'], ['List.cons authority rest', '(if ((project authority index) =? at) then (isBylaws (project authority instrument)) else (bylawsAt rest at))']]), 'values'),
    def('cites', ['at : Nat', 'cited : Nat', 'values : (List Citation)'], 'Bool',
      match('values', [['List.nil', 'false'], ['List.cons citation rest', '((((project citation obligation) =? at) && ((project citation authority) =? cited)) || (cites at cited rest))']]), 'values'),
    def('obligationsCited', ['allAuthorities : (List Authority)', 'allCitations : (List Citation)', 'values : (List Obligation)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons obligation rest', '((cites (project obligation index) (project obligation authority) allCitations) && ((bylawsAt allAuthorities (project obligation basis)) && (obligationsCited allAuthorities allCitations rest)))']]), 'values'),
    def('claimedAs', ['kind : Nat', 'at : Nat', 'values : (List OpenClaim)'], 'Bool',
      match('values', [['List.nil', 'false'], ['List.cons claim rest', '((((subjectCode (project claim subjectKind)) =? kind) && ((project claim subject) =? at)) || (claimedAs kind at rest))']]), 'values'),
    def('obligationsAccounted', ['claims : (List OpenClaim)', 'values : (List Obligation)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons obligation rest', `(((isDischarged (project obligation status)) || (claimedAs ${SUBJECT.obligation} (project obligation index) claims)) && (obligationsAccounted claims rest))`]]), 'values'),
    def('linesAccounted', ['claims : (List OpenClaim)', 'values : (List PartSixLine)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons line rest', `(((isEvidenced (project line status)) || (claimedAs ${SUBJECT.line} (project line index) claims)) && (linesAccounted claims rest))`]]), 'values'),
    def('needsAccounted', ['claims : (List OpenClaim)', 'values : (List Need)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons need rest', `((claimedAs ${SUBJECT.need} (project need index) claims) && (needsAccounted claims rest))`]]), 'values'),
    def('statementsAccounted', ['claims : (List OpenClaim)', 'recognized : Bool', 'values : (List Statement)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons statement rest', `((agree (isVerified (project statement consistency)) recognized) && (((isVerified (project statement consistency)) || (claimedAs ${SUBJECT.statement} (project statement index) claims)) && (statementsAccounted claims recognized rest)))`]]), 'values'),
    def('recognitionMatched', ['values : (List Observation)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons observation rest', '((if (isRecognition (project observation shows)) then (project observation matched) else 0) + (recognitionMatched rest))']]), 'values'),
    def('subjectBound', ['value : SubjectKind', 'obligationBound : Nat', 'lineBound : Nat', 'statementBound : Nat', 'needBound : Nat', 'observationBound : Nat'], 'Nat',
      match('value', [['SubjectKind.entity', '1'], ['SubjectKind.obligation', 'obligationBound'], ['SubjectKind.line', 'lineBound'], ['SubjectKind.statement', 'statementBound'], ['SubjectKind.need', 'needBound'], ['SubjectKind.observation', 'observationBound']])),
    def('claimsNamed', ['obligationBound : Nat', 'lineBound : Nat', 'statementBound : Nat', 'needBound : Nat', 'observationBound : Nat', 'values : (List OpenClaim)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons claim rest', '(((project claim subject) <? (subjectBound (project claim subjectKind) obligationBound lineBound statementBound needBound observationBound)) && (claimsNamed obligationBound lineBound statementBound needBound observationBound rest))']]), 'values'),
  ],
  checks: [
    '(authoritiesGovern (project release jurisdiction) authorities)',
    '(obligationsCited authorities citations obligations)',
    '(obligationsAccounted openClaims obligations)',
    '(linesAccounted openClaims lines)',
    '(needsAccounted openClaims needs)',
    '(statementsAccounted openClaims (project release recognitionObserved) statements)',
    '(agree (project release recognitionObserved) (0 <? (recognitionMatched observations)))',
    `((project release recognitionObserved) || (claimedAs ${SUBJECT.entity} 0 openClaims))`,
    '(claimsNamed (obligationsTotal obligations) (linesTotal lines) (statementsTotal statements) (needsTotal needs) (observationsTotal observations) openClaims)',
  ],
};

const lower = (j) => j.toLowerCase();
const records = {
  sources: r.sources,
  authorities: r.authorities.map((a) => ({ ...a, jurisdiction: lower(a.jurisdiction), digest: `sha256:${a.textSha256}` })),
  posts: r.posts,
  obligations: r.obligations,
  citations: r.citations,
  filings: r.filings.map((f) => ({ ...f, digest: f.documentDigest })),
  observations: r.observations,
  statements: r.statements,
  lines: r.lines.map((l) => ({ ...l, digest: `sha256:${l.questionSha256}` })),
  needs: r.needs,
  openClaims: r.claims,
};
const digestOf = (key) => r.sources.find((s) => s.key === key).digest;
const release = {
  legalName: r.entity.legalName,
  coloradoId: r.entity.identifier[0].value,
  foundingDate: r.entity.foundingDate,
  standing: r.entity.status,
  jurisdiction: lower(r.entity.jurisdiction),
  nonprofitStatusClaimed: r.entity.nonprofitStatusClaimed,
  recognitionObserved: r.entity.recognitionObserved,
  governanceDigest: digestOf('governance/register.json'),
  appDigest: digestOf('apps/uor-990-return.prompt.json'),
  snapshotDigest: digestOf('nonprofit/snapshot.json'),
  pdftotext: r.tools.pdftotext,
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Nonprofit/V1/Model.lex.tex', typesModule(decl)],
  ['src/Nonprofit.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/nonprofit-model.toml', entry('nonprofit-model', 'Nonprofit model', M, 'registerValid')],
  ['language/prism.arch/entries/nonprofit-register.toml', entry('nonprofit-register', 'Nonprofit register', 'Nonprofit', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
      process.stderr.write(`app/${path} is not the catalog of nonprofit/register.json\n`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
if (stale) process.exit(1);
const open = records.openClaims.length;
process.stdout.write(`${records.obligations.length} obligations (${records.obligations.filter((o) => o.status === 'discharged').length} discharged), ${records.lines.length} Part VI lines, ${records.authorities.length} authorities, ${open} open claims\n`);
