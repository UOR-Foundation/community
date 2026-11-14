#!/usr/bin/env node
/**
 * Write Foundation.Governance.V1 from governance/register.json: the type module
 * app/src/Foundation/Governance/V1/Model.lex.tex and the catalog
 * app/src/Governance.lex.tex, closed by the theorem that the register is
 * valid. The declaration below is the whole of the model's shape; the LexLean
 * is written by tools/register-lex.mjs, so none of it is hand-made.
 *
 *   node governance/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const P = { ref: 'Provision' };

// W3C ORG classes and PROV-O/Schema.org actor types, and the Bylaws' own vote vocabulary.
const decl = {
  module: 'Foundation.Governance.V1.Model',
  title: 'Governance model',
  catalog: 'Governance',
  catalogTitle: 'Foundation governance register',
  enums: {
    OrgClass: ['FormalOrganization', 'OrganizationalUnit'],
    RuleKind: ['quorum', 'act', 'removal', 'vacancy', 'writtenAction', 'bylawAmendment', 'officerRemoval', 'stageDecision'],
    RuleBase: ['serving', 'present', 'whole'],
    ActorType: ['Person', 'SoftwareApplication'],
  },
  release: [['board', { ref: 'OrganizationalUnit' }], ['toc', { ref: 'OrganizationalUnit' }], ['boardMinimum', 'Nat'], ['boardMaximum', 'Nat'], ['sources', 'String'], ['pdftotext', 'String']],
  kinds: [
    { name: 'Provision', list: 'provisions', fields: [['document', 'String'], ['ref', 'String'], ['title', 'String'], ['digest', 'String']] },
    { name: 'OrganizationalUnit', list: 'units', fields: [['name', 'String'], ['classification', { enum: 'OrgClass' }], ['purpose', 'String'], ['provision', P]] },
    { name: 'SubOrganization', list: 'subOrganizations', fields: [['unit', { ref: 'OrganizationalUnit' }], ['parent', { ref: 'OrganizationalUnit' }], ['provision', P]], checks: ['(not ((project $ unit) =? (project $ parent)))'] },
    { name: 'Post', list: 'posts', fields: [['name', 'String'], ['unit', { ref: 'OrganizationalUnit' }], ['mandatory', 'Bool'], ['provision', P]] },
    { name: 'Role', list: 'roles', fields: [['name', 'String'], ['unit', { ref: 'OrganizationalUnit' }], ['duty', 'String'], ['provision', P]] },
    { name: 'VoteRule', list: 'voteRules', fields: [['body', { ref: 'OrganizationalUnit' }], ['act', { enum: 'RuleKind' }], ['numerator', 'Nat'], ['denominator', 'Nat'], ['strict', 'Bool'], ['base', { enum: 'RuleBase' }], ['excludesSubject', 'Bool'], ['provision', P]], checks: ['(0 <? (project $ numerator))', '((project $ numerator) <? (project $ denominator))'] },
    { name: 'Stage', list: 'stages', fields: [['name', 'String'], ['signal', 'String'], ['evidence', 'String'], ['decision', 'String'], ['voteRule', { ref: 'VoteRule' }], ['provision', P]] },
    { name: 'BylawNumber', list: 'bylawNumbers', fields: [['name', 'String'], ['amount', 'Nat'], ['provision', P]] },
    { name: 'ServiceLevel', list: 'serviceLevels', fields: [['action', 'String'], ['target', 'String'], ['provision', P]] },
    { name: 'Tier', list: 'tiers', fields: [['name', 'String'], ['useCase', 'String'], ['expectation', 'String']] },
    { name: 'TopicTag', list: 'topicTags', fields: [['category', 'String'], ['label', 'String'], ['applies', 'String']] },
    { name: 'Rung', list: 'rungs', fields: [['rank', 'Nat'], ['name', 'String'], ['event', 'String'], ['consequence', 'String'], ['provision', P]], checks: ['((project $ rank) =? (position + 1))'] },
    { name: 'Actor', list: 'people', fields: [['actorType', { enum: 'ActorType' }], ['name', 'String'], ['identifier', 'String'], ['sameAs', 'String'], ['applicationCategory', 'String']] },
    { name: 'Holding', list: 'holdings', fields: [['person', { ref: 'Actor' }], ['post', { ref: 'Post' }]] },
    { name: 'Membership', list: 'memberships', fields: [['person', { ref: 'Actor' }], ['role', { ref: 'Role' }]] },
    { name: 'Delegation', list: 'delegations', fields: [['agent', { ref: 'Actor' }], ['onBehalfOf', { ref: 'Actor' }], ['repository', 'String'], ['activities', 'Nat']], checks: ['(0 <? (project $ activities))'] },
    { name: 'Reference', list: 'references', fields: [['source', P], ['target', P]] },
    { name: 'OpenClaim', list: 'openClaims', fields: [['area', 'String'], ['subject', 'String'], ['refusal', 'String'], ['detail', 'String']] },
  ],
  // The governance checks: software is never a person, every Board position the Bylaws create is held by exactly
  // one person, the Board's size is within the Bylaws' bounds, every lifecycle decision is a TOC vote, and every
  // rule that decides something belongs to a body that has a quorum rule.
  definitions: [
    def('actorIsSoftware', ['actorType : ActorType'], 'Bool', match('actorType', [['ActorType.person', 'false'], ['ActorType.softwareApplication', 'true']])),
    def('ruleIsQuorum', ['act : RuleKind'], 'Bool', match('act', [['RuleKind.quorum', 'true'], ['RuleKind.act', 'false'], ['RuleKind.removal', 'false'], ['RuleKind.vacancy', 'false'], ['RuleKind.writtenAction', 'false'], ['RuleKind.bylawAmendment', 'false'], ['RuleKind.officerRemoval', 'false'], ['RuleKind.stageDecision', 'false']])),
    def('softwareAt', ['actors : (List Actor)', 'at : Nat'], 'Bool', match('actors', [['List.nil', 'false'], ['List.cons actor rest', '(if ((project actor index) =? at) then (actorIsSoftware (project actor actorType)) else (softwareAt rest at))']]), 'actors'),
    def('personAt', ['actors : (List Actor)', 'at : Nat'], 'Bool', match('actors', [['List.nil', 'false'], ['List.cons actor rest', '(if ((project actor index) =? at) then (not (actorIsSoftware (project actor actorType))) else (personAt rest at))']]), 'actors'),
    def('delegationsTyped', ['actors : (List Actor)', 'values : (List Delegation)'], 'Bool', match('values', [['List.nil', 'true'], ['List.cons delegation rest', '((softwareAt actors (project delegation agent)) && ((personAt actors (project delegation onBehalfOf)) && (delegationsTyped actors rest)))']]), 'values'),
    def('membershipsTyped', ['actors : (List Actor)', 'values : (List Membership)'], 'Bool', match('values', [['List.nil', 'true'], ['List.cons membership rest', '((personAt actors (project membership person)) && (membershipsTyped actors rest))']]), 'values'),
    def('holdingsTyped', ['actors : (List Actor)', 'values : (List Holding)'], 'Bool', match('values', [['List.nil', 'true'], ['List.cons holding rest', '((personAt actors (project holding person)) && (holdingsTyped actors rest))']]), 'values'),
    def('postUnitAt', ['values : (List Post)', 'at : Nat'], 'Nat', match('values', [['List.nil', '0'], ['List.cons post rest', '(if ((project post index) =? at) then (project post unit) else (postUnitAt rest at))']]), 'values'),
    def('holdersOf', ['values : (List Holding)', 'at : Nat'], 'Nat', match('values', [['List.nil', '0'], ['List.cons holding rest', '(if ((project holding post) =? at) then (1 + (holdersOf rest at)) else (holdersOf rest at))']]), 'values'),
    def('seatsIn', ['allPosts : (List Post)', 'values : (List Holding)', 'body : Nat'], 'Nat', match('values', [['List.nil', '0'], ['List.cons holding rest', '(if ((postUnitAt allPosts (project holding post)) =? body) then (1 + (seatsIn allPosts rest body)) else (seatsIn allPosts rest body))']]), 'values'),
    def('positionsHeldOnce', ['values : (List Post)', 'allHoldings : (List Holding)', 'body : Nat'], 'Bool', match('values', [['List.nil', 'true'], ['List.cons post rest', '((if ((project post unit) =? body) then ((holdersOf allHoldings (project post index)) =? 1) else true) && (positionsHeldOnce rest allHoldings body))']]), 'values'),
    def('ruleBodyAt', ['values : (List VoteRule)', 'at : Nat'], 'Nat', match('values', [['List.nil', '0'], ['List.cons voteRule rest', '(if ((project voteRule index) =? at) then (project voteRule body) else (ruleBodyAt rest at))']]), 'values'),
    def('stagesDecidedBy', ['allRules : (List VoteRule)', 'values : (List Stage)', 'body : Nat'], 'Bool', match('values', [['List.nil', 'true'], ['List.cons stage rest', '(((ruleBodyAt allRules (project stage voteRule)) =? body) && (stagesDecidedBy allRules rest body))']]), 'values'),
    def('quorumFor', ['values : (List VoteRule)', 'body : Nat'], 'Bool', match('values', [['List.nil', 'false'], ['List.cons voteRule rest', '((((project voteRule body) =? body) && (ruleIsQuorum (project voteRule act))) || (quorumFor rest body))']]), 'values'),
    def('rulesHaveQuorum', ['allRules : (List VoteRule)', 'values : (List VoteRule)'], 'Bool', match('values', [['List.nil', 'true'], ['List.cons voteRule rest', '((quorumFor allRules (project voteRule body)) && (rulesHaveQuorum allRules rest))']]), 'values'),
  ],
  checks: [
    '(delegationsTyped people delegations)',
    '(membershipsTyped people memberships)',
    '(holdingsTyped people holdings)',
    '(positionsHeldOnce posts holdings (project release board))',
    '((project release boardMinimum) <? ((seatsIn posts holdings (project release board)) + 1))',
    '((seatsIn posts holdings (project release board)) <? ((project release boardMaximum) + 1))',
    '(stagesDecidedBy voteRules stages (project release toc))',
    '(rulesHaveQuorum voteRules voteRules)',
    '((project release board) <? (unitsTotal units))',
    '((project release toc) <? (unitsTotal units))',
  ],
};

const number = (n) => r.constants.find((c) => c.name === n).value;
const records = {
  provisions: r.provisions.map((p) => ({ ...p, digest: `sha256:${p.sha256}` })),
  units: r.units,
  subOrganizations: r.subOrganizations,
  posts: r.posts,
  roles: r.roles,
  voteRules: r.voteRules.map((v) => ({ ...v, act: v.kind, numerator: v.num, denominator: v.den })),
  stages: r.stages,
  bylawNumbers: r.constants.map((c) => ({ ...c, amount: c.value })),
  serviceLevels: r.serviceLevels,
  tiers: r.tiers,
  topicTags: r.tags.map((t) => ({ category: t.category, label: t.tag, applies: t.when })),
  rungs: r.rungs,
  people: r.people.map((p) => ({ ...p, actorType: p.type, applicationCategory: p.applicationCategory ?? '' })),
  holdings: r.holdings,
  memberships: r.memberships,
  delegations: r.delegations,
  references: r.references.map((x) => ({ source: x.from, target: x.to })),
  openClaims: r.refusals.map((c) => ({ area: c.kind, subject: c.subject, refusal: c.refusal, detail: c.detail })),
};
const releaseValues = {
  board: r.units.findIndex((u) => u.name === 'Board of Directors'),
  toc: r.units.findIndex((u) => u.name === 'Technical Oversight Committee'),
  boardMinimum: number('boardMinimum'),
  boardMaximum: number('boardMaximum'),
  sources: r.sources.map((s) => `${s.repository}@${s.commit}:${s.path}#sha256:${s.sha256}`).join(" "),
  pdftotext: r.tools.pdftotext,
};

const outputs = [
  [join(here, '..', 'app', 'src', 'Foundation', 'Governance', 'V1', 'Model.lex.tex'), typesModule(decl)],
  [join(here, '..', 'app', 'src', 'Governance.lex.tex'), catalogModule(decl, records, releaseValues)],
];
let stale = false;
for (const [target, text] of outputs) {
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`${target} is not the catalog of governance/register.json\n`); stale = true; }
  } else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); }
}
if (stale) process.exit(1);
process.stdout.write(decl.kinds.map((k) => `${records[k.list].length} ${k.list}`).join(', ') + '\n');
