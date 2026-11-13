#!/usr/bin/env node
/**
 * Project the ecosystem register from its pinned sources.
 *
 * The tag vocabulary is read from the Topic Tags table of STANDARDS.md and the
 * TOC stages from the Project Stages list of toc/README.md, both in
 * UOR-Foundation/.github at the commit sources.json pins. Each repository of
 * ecosystem/snapshot.json is classified by that vocabulary alone and then asked
 * the repo-standards decision app (its prompt, at the pinned Prism-DevRel
 * commit) for its outcome, by evaluating the prompt's own first-hit rules.
 * Nothing is defaulted: a repository without exactly one tier tag has no tier,
 * and is decided only when every tier gives the same outcome; a repository the
 * app does not find conformant, an undecidable one, and a TOC application with
 * no recorded decision are typed refusals carried into the register as open
 * claims. The same checkouts and snapshot always project the same bytes.
 *
 *   node ecosystem/project.mjs <checkouts-dir> [--check]
 *
 * <checkouts-dir> holds `.github` and `prism-devrel` checked out at the pinned commits.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <checkouts-dir> [--check]\n');
  process.exit(64);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function pinned(source) {
  const dir = join(root, source.name);
  const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim();
  const at = head.startsWith('ref:') ? readFileSync(join(dir, '.git', head.slice(5)), 'utf8').trim() : head;
  if (at !== source.commit) throw new Error(`${source.name} is at ${at}, not the pinned ${source.commit}`);
  return (path) => {
    const bytes = readFileSync(join(dir, path));
    return { path: `${source.name}@${source.commit}:${path}`, sha256: sha256(bytes), text: bytes.toString('utf8').replace(/\r\n/g, '\n') };
  };
}
const norms = pinned(sources.norms);
const devrel = pinned(sources.app);
const standards = norms(sources.norms.standards);
const toc = norms(sources.norms.toc);
const promptFile = devrel(sources.app.prompt);
const prompt = JSON.parse(promptFile.text);
const snapshotBytes = readFileSync(join(here, 'snapshot.json'));
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));

// The Topic Tags table of STANDARDS.md: | Category | Required Tags | When |.
const section = (text, heading) => {
  const at = text.indexOf(`\n## ${heading}\n`);
  if (at < 0) throw new Error(`no "## ${heading}" section`);
  const rest = text.slice(at + heading.length + 5);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
};
const vocabulary = {};
for (const line of section(standards.text, 'Topic Tags').split('\n')) {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 4 || !cells[2].includes('`')) continue;
  vocabulary[cells[1].toLowerCase()] = { tags: [...cells[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]), when: cells[3] };
}
for (const category of ['identity', 'tier', 'domain', 'technology', 'status']) {
  if (!vocabulary[category]) throw new Error(`STANDARDS.md has no ${category} row in its Topic Tags table`);
}
const tocStages = [...section(toc.text, 'Project Stages').matchAll(/^- \*\*([^*]+)\*\*/gm)].map((m) => m[1]);
if (tocStages.length === 0) throw new Error('toc/README.md lists no project stages');

// The repo-standards decision app: its fields, first-hit rules and otherwise.
const app = prompt.app;
if (prompt.pattern !== 'decisionTable') throw new Error(`${app.name} is a ${prompt.pattern}, not a decisionTable`);
const BINDING = ['tier', 'identity', 'tiertags', 'statustags', 'versioning'];
if (app.fields.map((f) => f.name).join() !== BINDING.join()) {
  throw new Error(`${app.name} asks [${app.fields.map((f) => f.name)}]; the projector binds [${BINDING}]`);
}
const tierField = app.fields.find((f) => f.name === 'tier');
if (tierField.values.length !== vocabulary.tier.tags.length) {
  throw new Error(`${app.name} has ${tierField.values.length} tiers; STANDARDS.md tags ${vocabulary.tier.tags.length}`);
}
const OPS = {
  is: (a, b) => a === b, 'is not': (a, b) => a !== b, '=': (a, b) => a === b, '!=': (a, b) => a !== b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
};
function decide(request) {
  for (const rule of app.rules) {
    if (rule.when.every((c) => {
      if (!OPS[c.op]) throw new Error(`${app.name} uses the operator ${c.op}`);
      return OPS[c.op](request[c.field], c.value);
    })) return { outcome: rule.then, why: rule.why };
  }
  return { outcome: app.otherwise, why: app.otherwiseWhy };
}
// The interpreter is held to the app's own examples before it decides anything.
for (const ex of app.examples) {
  const words = ex.request.split(/\s+/);
  const request = Object.fromEntries(app.fields.map((f, i) => [f.name, f.kind === 'number' ? Number(words[i]) : words[i]]));
  const got = decide(request).outcome;
  if (got !== ex.response) throw new Error(`${app.name} example "${ex.request}" gives ${got}, not ${ex.response}`);
}

// SemVer 2.0.0, as semver.org publishes it.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const versioning = (tags) => (tags.length === 0 ? 'unreleased' : tags.every((t) => SEMVER.test(t.name.replace(/^v/, ''))) ? 'semver' : 'other');

const refusals = [];
const repositories = snapshot.repositories.map((r, index) => {
  const has = (category) => vocabulary[category].tags.filter((t) => r.topics.includes(t));
  const tiers = has('tier');
  const statuses = has('status');
  const request = {
    identity: vocabulary.identity.tags.every((t) => r.topics.includes(t)) ? 'present' : 'missing',
    tiertags: tiers.length,
    statustags: statuses.length,
    versioning: versioning(r.tags),
  };
  const tier = tiers.length === 1 ? tierField.values[vocabulary.tier.tags.indexOf(tiers[0])] : '';
  const decisions = (tier ? [tier] : tierField.values).map((t) => decide({ ...request, tier: t }));
  const decided = decisions.every((d) => d.outcome === decisions[0].outcome);
  const outcome = decided ? decisions[0].outcome : '';
  if (!decided) {
    refusals.push({ repository: index, refusal: 'tier-unrecorded', detail: `${r.name}: ${app.name} depends on the tier, and no single tier tag is carried` });
  } else if (outcome !== app.otherwise) {
    refusals.push({ repository: index, refusal: outcome, detail: `${r.name}: ${app.meanings[outcome]} (${decisions[0].why})` });
  }
  return {
    index,
    name: r.name,
    archived: r.archived,
    language: r.language,
    topics: r.topics,
    tier,
    status: statuses.length === 1 ? statuses[0] : '',
    tocStage: '',
    request,
    outcome,
    tags: r.tags.length,
  };
});
for (const a of snapshot.tocApplications) {
  const stage = tocStages.find((s) => a.title.toLowerCase().startsWith(`[${s.toLowerCase()}]`));
  // toc/README.md names where an application is filed but not how its decision is recorded, so no stage is read from one.
  refusals.push({ repository: repositories.length, refusal: 'toc-decision-unrecorded', detail: `.github#${a.number} ${stage ? `applies for ${stage}` : 'is not a stage application'}: ${a.title}` });
}

const register = {
  spec: 'uor-community/ecosystem-register/1',
  snapshot: { query: snapshot.query, sha256: sha256(snapshotBytes) },
  norms: [standards, toc].map(({ path, sha256: digest }) => ({ path, sha256: digest })),
  app: { name: app.name, path: promptFile.path, sha256: promptFile.sha256, outcomes: app.outcomes, conformant: app.otherwise },
  vocabulary: { ...Object.fromEntries(Object.entries(vocabulary).map(([k, v]) => [k, v.tags])), tocStages },
  repositories,
  refusals,
};
const text = `${JSON.stringify(register, null, 2)}\n`;
const target = join(here, 'register.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
    process.stderr.write('ecosystem/register.json is not the projection of its pinned sources\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
const conformant = repositories.filter((r) => r.outcome === app.otherwise).length;
process.stdout.write(`${repositories.length} repositories, ${conformant} conformant, ${refusals.length} open claims\n`);
