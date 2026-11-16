#!/usr/bin/env node
/**
 * Write Foundation.Licensing.V1 from licensing/register.json through
 * tools/register-lex.mjs:
 *
 *   app/src/Foundation/Licensing/V1/Model.lex.tex  the types and registerValid;
 *   app/src/Licensing.lex.tex  every license, repository, declaration, policy rule
 *     and open claim, and the theorem that the register is valid;
 *   the two lexicon entries that title them.
 *
 * registerValid checks, beyond every reference resolving: a repository is REUSE
 * compliant exactly when every count the tool holds against compliance is zero
 * and every file carries copyright and licensing information (REUSE 3.3, as
 * reuse's ProjectReport.is_compliant decides it); a non-compliant repository, a
 * repository without a LICENSE file or with one the matching guidelines cannot
 * identify, and every declaration the policy or the website does not allow are
 * named by an open claim of that kind; a declaration said to conform names
 * exactly the one license its repository's policy rule sets. Every declared
 * identifier is a reference to a License record, and the projector makes a
 * License record only from an entry of the pinned SPDX License List.
 *
 *   node licensing/catalog.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesModule, catalogModule, def, match, camel } from '../tools/register-lex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const M = 'Foundation.Licensing.V1.Model';

const enums = {
  Refusal: ['reuse-noncompliant', 'policy-mismatch', 'website-mismatch', 'license-file-missing', 'license-text-unidentified', 'declarations-disagree', 'identifier-unlisted', 'expression-invalid', 'license-undeclared'],
  DeclarationKind: ['cargo', 'cargo-workspace', 'npm', 'pyproject', 'license-file', 'spdx-identifier'],
};
const is = (type, value) => def(`is${camel(value).replace(/^./, (c) => c.toUpperCase())}`, [`value : ${type}`], 'Bool',
  match('value', enums[type].map((v) => [`${type}.${camel(v)}`, v === value ? 'true' : 'false'])));
const claimedAs = (refusal) => {
  const p = `is${camel(refusal).replace(/^./, (c) => c.toUpperCase())}`;
  return def(`claimed${p.slice(2)}`, ['position : Nat', 'claims : (List OpenClaim)'], 'Bool',
    match('claims', [['List.nil', 'false'], ['List.cons claim rest', `((((project claim repository) =? position) && (${p} (project claim refusal))) || (claimed${p.slice(2)} position rest))`]]), 'claims');
};

const decl = {
  module: M,
  title: 'Licensing model',
  catalog: 'Licensing',
  catalogTitle: 'Licensing register',
  enums,
  kinds: [
    { name: 'License', list: 'licenses', fields: [['spdxId', 'String'], ['name', 'String'], ['isException', 'Bool'], ['osiApproved', 'Bool'], ['fsfLibre', 'Bool'], ['deprecated', 'Bool']] },
    { name: 'PolicyRule', list: 'rules', fields: [['document', 'String'], ['section', 'String'], ['statement', 'String'], ['subject', 'String'], ['allows', 'String']] },
    {
      name: 'Repository', list: 'repositories',
      fields: [
        ['name', 'String'], ['commit', 'String'], ['filesTotal', 'Nat'], ['filesWithCopyright', 'Nat'], ['filesWithLicense', 'Nat'],
        ['missingLicenses', 'Nat'], ['badLicenses', 'Nat'], ['deprecatedLicenses', 'Nat'], ['unusedLicenses', 'Nat'],
        ['licensesWithoutExtension', 'Nat'], ['readErrors', 'Nat'], ['invalidExpressions', 'Nat'], ['compliant', 'Bool'],
        ['licenseFiles', 'Nat'], ['identifiedFiles', 'Nat'], ['expected', { ref: 'License' }], ['rule', { ref: 'PolicyRule' }], ['expression', 'String'],
      ],
      checks: ['(countsReconcile $)'],
    },
    {
      name: 'Declaration', list: 'declarations',
      fields: [['repository', { ref: 'Repository' }], ['declarationKind', { enum: 'DeclarationKind' }], ['source', 'String'], ['expression', 'String'], ['conformsPolicy', 'Bool'], ['conformsWebsite', 'Bool']],
    },
    { name: 'DeclaredId', list: 'declaredIds', fields: [['declaration', { ref: 'Declaration' }], ['license', { ref: 'License' }], ['orLater', 'Bool']] },
    { name: 'OpenClaim', list: 'openClaims', fields: [['repository', { ref: 'Repository' }], ['refusal', { enum: 'Refusal' }], ['detail', 'String']] },
    { name: 'PolicyClaim', list: 'policyClaims', fields: [['refusal', { enum: 'Refusal' }], ['detail', 'String']] },
  ],
  release: [
    ['standards', 'String'], ['reuseTool', 'String'], ['spdxList', 'String'], ['spdxDigest', 'String'], ['exceptionsDigest', 'String'],
    ['inputs', 'String'], ['sources', 'String'], ['commits', 'String'], ['compliantCount', 'Nat'], ['dcoRule', 'Bool'], ['claRule', 'Bool'],
  ],
  definitions: [
    ...['reuse-noncompliant', 'policy-mismatch', 'website-mismatch', 'license-file-missing', 'license-text-unidentified'].map((v) => is('Refusal', v)),
    ...['reuse-noncompliant', 'policy-mismatch', 'website-mismatch', 'license-file-missing', 'license-text-unidentified'].map(claimedAs),
    def('agree', ['left : Bool', 'right : Bool'], 'Bool', '(if left then right else (not right))'),
    // ProjectReport.is_compliant (reuse 6.3.0 report.py): no missing, unused, bad or deprecated license, none without
    // an extension, no read error, no invalid expression, and no file without copyright or licensing information.
    def('noFindings', ['repository : Repository'], 'Bool',
      '((((project repository missingLicenses) =? 0) && (((project repository badLicenses) =? 0) && (((project repository deprecatedLicenses) =? 0) && ((project repository unusedLicenses) =? 0)))) && ((((project repository licensesWithoutExtension) =? 0) && (((project repository readErrors) =? 0) && ((project repository invalidExpressions) =? 0))) && (((project repository filesWithCopyright) =? (project repository filesTotal)) && ((project repository filesWithLicense) =? (project repository filesTotal)))))'),
    def('countsReconcile', ['repository : Repository'], 'Bool',
      '((agree (project repository compliant) (noFindings repository)) && ((((project repository filesWithCopyright) <? ((project repository filesTotal) + 1)) && ((project repository filesWithLicense) <? ((project repository filesTotal) + 1))) && ((project repository identifiedFiles) <? ((project repository licenseFiles) + 1))))'),
    def('compliantTotal', ['values : (List Repository)'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons repository rest', '((if (project repository compliant) then 1 else 0) + (compliantTotal rest))']]), 'values'),
    def('repositoriesClaimed', ['claims : (List OpenClaim)', 'values : (List Repository)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons repository rest', '((((project repository compliant) || (claimedReuseNoncompliant (project repository index) claims)) && ((((project repository licenseFiles) =? 0) && (claimedLicenseFileMissing (project repository index) claims)) || ((0 <? (project repository licenseFiles)) && (((project repository identifiedFiles) =? (project repository licenseFiles)) || (claimedLicenseTextUnidentified (project repository index) claims))))) && (repositoriesClaimed claims rest))']]), 'values'),
    def('declarationsClaimed', ['claims : (List OpenClaim)', 'values : (List Declaration)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons declaration rest', '((((project declaration conformsPolicy) || (claimedPolicyMismatch (project declaration repository) claims)) && ((project declaration conformsWebsite) || (claimedWebsiteMismatch (project declaration repository) claims))) && (declarationsClaimed claims rest))']]), 'values'),
    def('idsOf', ['values : (List DeclaredId)', 'at : Nat'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons declaredId rest', '(if ((project declaredId declaration) =? at) then (1 + (idsOf rest at)) else (idsOf rest at))']]), 'values'),
    def('licenseOf', ['values : (List DeclaredId)', 'at : Nat'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons declaredId rest', '(if ((project declaredId declaration) =? at) then (project declaredId license) else (licenseOf rest at))']]), 'values'),
    def('expectedOf', ['values : (List Repository)', 'at : Nat'], 'Nat',
      match('values', [['List.nil', '0'], ['List.cons repository rest', '(if ((project repository index) =? at) then (project repository expected) else (expectedOf rest at))']]), 'values'),
    def('conformingNamesExpected', ['allIds : (List DeclaredId)', 'allRepositories : (List Repository)', 'values : (List Declaration)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons declaration rest', '((if (project declaration conformsPolicy) then (((idsOf allIds (project declaration index)) =? 1) && ((licenseOf allIds (project declaration index)) =? (expectedOf allRepositories (project declaration repository)))) else true) && (conformingNamesExpected allIds allRepositories rest))']]), 'values'),
    def('declarationsHaveIds', ['allIds : (List DeclaredId)', 'values : (List Declaration)'], 'Bool',
      match('values', [['List.nil', 'true'], ['List.cons declaration rest', '((0 <? (idsOf allIds (project declaration index))) && (declarationsHaveIds allIds rest))']]), 'values'),
  ],
  checks: [
    '((compliantTotal repositories) =? (project release compliantCount))',
    '(repositoriesClaimed openClaims repositories)',
    '(declarationsClaimed openClaims declarations)',
    '(conformingNamesExpected declaredIds repositories declarations)',
    '(declarationsHaveIds declaredIds declarations)',
  ],
};

const records = {
  licenses: r.licenses.map((l) => ({ ...l, spdxId: l.id, isException: l.exception })),
  rules: r.rules.map((x) => ({ ...x, allows: x.licenses })),
  repositories: r.repositories,
  declarations: r.declarations.map((x) => ({ ...x, declarationKind: x.kind })),
  declaredIds: r.declaredIds,
  openClaims: r.refusals,
  policyClaims: r.policyClaims,
};
const release = {
  standards: r.standards.join('; '),
  reuseTool: `reuse ${r.tools.reuse.version} ${r.tools.reuse.wheel}#sha256:${r.tools.reuse.sha256} (lint ${r.tools.reuse.lint}, REUSE ${r.tools.reuse.spec})`,
  spdxList: `SPDX License List ${r.spdx.version} ${r.spdx.tag}@${r.spdx.commit}`,
  spdxDigest: `sha256:${r.spdx.licensesSha256}`,
  exceptionsDigest: `sha256:${r.spdx.exceptionsSha256}`,
  inputs: r.inputs.map((i) => `${i.path}#sha256:${i.sha256}`).join(' '),
  sources: r.sources.map((s) => `${s.ref}#sha256:${s.sha256}`).join(' '),
  commits: r.repositories.map((x) => `${x.name}@${x.commit}`).join(' '),
  compliantCount: r.repositories.filter((x) => x.compliant).length,
  dcoRule: r.policy.dcoRule,
  claRule: r.policy.claRule,
};

const entry = (id, surface, module, component) =>
  `spec = "lexlean/entry/1"\nid = "${id}"\ncategory = "label-word"\nsurface_arity = 0\nframe = "atom"\n\n[denotation]\nkind = "document"\nmodule = "${module}"\ncomponent = "${component}"\n\n[[form]]\nid = "${id}"\nchannel = "text"\nsurface = "${surface}"\ncanonical_source = true\nfeatures = ["sentence-case", "singular"]\n`;

const app = join(here, '..', 'app');
const outputs = [
  ['src/Foundation/Licensing/V1/Model.lex.tex', typesModule(decl)],
  ['src/Licensing.lex.tex', catalogModule(decl, records, release)],
  ['language/prism.arch/entries/licensing-model.toml', entry('licensing-model', 'Licensing model', M, 'registerValid')],
  ['language/prism.arch/entries/licensing-register.toml', entry('licensing-register', 'Licensing register', 'Licensing', 'registerValidHolds')],
];
let stale = false;
for (const [path, text] of outputs) {
  const target = join(app, path);
  if (process.argv[2] === '--check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) { process.stderr.write(`app/${path} is not the catalog of licensing/register.json\n`); stale = true; }
  } else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); }
}
if (stale) process.exit(1);
process.stdout.write(decl.kinds.map((k) => `${records[k.list].length} ${k.list}`).join(', ') + '\n');
