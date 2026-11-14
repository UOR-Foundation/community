#!/usr/bin/env node
/**
 * Project the stakeholder register: who the community model's stakeholders are
 * and which of their concerns each metrics model and decision addresses.
 *
 * Stakeholders are the roles stakeholders.json quotes from the pinned sources
 * in sources.json; a quote missing from its source, or a source whose bytes
 * differ from the pin, stops the projection. Concerns are ISO/IEC/IEEE 42010
 * concerns taken from two places:
 *   - the user stories ("As a <role>, I want ...") in each CHAOSS metrics
 *     model's definition, read from the same checkout and digest that
 *     chaoss/register.json records;
 *   - the stakeholders each prism/prompt/1 decision in this repository names.
 * Each role is mapped through roles.json. A role nothing maps, or a model that
 * states no user story, is a typed refusal carried as an open claim; nothing
 * is guessed. The same inputs always project the same bytes.
 *
 *   node views/project.mjs <checkouts-dir> [--check]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const [root, flag] = process.argv.slice(2);
if (!root) {
  process.stderr.write('usage: project.mjs <checkouts-dir> [--check]\n');
  process.exit(64);
}

const sources = json(join(here, 'sources.json'));
const { stakeholders } = json(join(here, 'stakeholders.json'));
const { roles } = json(join(here, 'roles.json'));
const chaoss = json(join(repo, 'chaoss', 'register.json'));
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(65);
};

function headAt(dir) {
  const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim();
  return head.startsWith('ref:') ? readFileSync(join(dir, '.git', head.slice(5)), 'utf8').trim() : head;
}

// Every source document, checked against its pin, as text.
const documents = new Map();
const pinned = [];
for (const doc of sources.documents) {
  const dir = join(root, doc.checkout);
  if (doc.commit && headAt(dir) !== doc.commit) fail(`${doc.checkout} is not at the pinned ${doc.commit}`);
  const path = join(dir, doc.path);
  const bytes = readFileSync(path);
  const digest = sha256(bytes);
  if (doc.sha256 && digest !== doc.sha256) fail(`${doc.url} is sha256:${digest}, not the pinned ${doc.sha256}`);
  const text = doc.text === 'pdftotext' ? execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' }) : bytes.toString('utf8');
  documents.set(doc.id, squash(text));
  pinned.push({ id: doc.id, ref: doc.commit ? `${doc.repository}@${doc.commit}:${doc.path}` : doc.url, sha256: digest });
}

const slugs = new Set(stakeholders.map((s) => s.slug));
for (const s of stakeholders) {
  if (!documents.has(s.source)) fail(`${s.slug} cites no declared source ${s.source}`);
  if (!documents.get(s.source).includes(squash(s.quote))) fail(`${s.slug}: the quote is not in ${s.source}`);
  if (s.actedOnBehalfOf && !slugs.has(s.actedOnBehalfOf)) fail(`${s.slug} acts for no declared stakeholder`);
}
for (const r of roles) for (const s of r.stakeholders) if (!slugs.has(s)) fail(`role "${r.phrase}" maps to no stakeholder ${s}`);

// The longest phrase that is the whole role or its first words.
const phrases = roles.map((r) => ({ ...r, phrase: r.phrase.toLowerCase() })).sort((a, b) => b.phrase.length - a.phrase.length);
function holders(role) {
  const r = role.toLowerCase();
  const hit = phrases.find((p) => r === p.phrase || r.startsWith(`${p.phrase} `));
  return hit ? hit.stakeholders : null;
}

const concerns = [];
const refusals = [];
function refuse(kind, subject, refusal, detail) {
  if (!refusals.some((r) => r.subject === subject && r.refusal === refusal && r.detail === detail)) refusals.push({ kind, subject, refusal, detail });
}
function concern(kind, subject, role, text) {
  const who = holders(role);
  if (!who) {
    refuse(kind, subject, 'role-maps-to-no-stakeholder', role);
    return;
  }
  for (const stakeholder of who) concerns.push({ stakeholder, kind, subject, role, text });
}

// User stories of every metrics model, from the bytes the register pinned.
const STORY = /^(\s*)(?:[-*+]|\d+\.)\s+(?:\*\*)?(As an?\s+(.+?)(?:\*\*)?\s*(?:,|\bI\b).*)$/i;
for (const model of chaoss.models) {
  const [, name, commit, path] = model.source.match(/^([^@]+)@([0-9a-f]{40}):(.+)$/);
  const dir = join(root, name);
  if (headAt(dir) !== commit) fail(`${name} is not at the pinned ${commit}`);
  const bytes = readFileSync(join(dir, path));
  if (sha256(bytes) !== model.sha256) fail(`${model.slug}: the definition differs from the register's digest`);
  const parts = bytes.toString('utf8').replace(/\r\n/g, '\n').split(/^(#{1,6}\s+.*)$/m);
  const stories = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (!/user stor/i.test(parts[i])) continue;
    let open = null;
    for (const line of parts[i + 1].split('\n')) {
      const m = line.match(STORY);
      if (m) {
        open = { indent: m[1].length, role: squash(m[3].replace(/\*/g, '')), text: squash(m[2].replace(/\*/g, '')) };
        stories.push(open);
      } else if (open && /^\s*(?:[-*+]|\d+\.)\s+/.test(line) && line.match(/^\s*/)[0].length > open.indent) {
        open.text += `${open.text.endsWith(':') ? ' ' : '; '}${squash(line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/\*/g, ''))}`;
      } else if (line.trim() && !/^\s/.test(line)) open = null;
    }
  }
  if (!stories.length) refuse('measurementModel', model.slug, 'model-states-no-user-story', model.title);
  for (const s of stories) concern('measurementModel', model.slug, s.role, s.text);
}

// Every decision prompt in this repository.
function glob(pattern) {
  const parts = pattern.split('/');
  let found = [repo];
  for (const part of parts) {
    const re = new RegExp(`^${part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    found = found.flatMap((d) => (existsSync(d) && !d.endsWith('.json') ? readdirSync(d).filter((n) => re.test(n)).sort().map((n) => join(d, n)) : []));
  }
  return found;
}
const decisions = [];
for (const file of [...new Set(sources.prompts.flatMap(glob))]) {
  const bytes = readFileSync(file);
  const p = JSON.parse(bytes.toString('utf8'));
  if (p.schema !== 'prism/prompt/1') continue;
  decisions.push({ app: p.app.name, title: p.app.title, pattern: p.pattern, path: relative(repo, file), sha256: sha256(bytes), prompt: p });
}
decisions.sort((a, b) => (a.app < b.app ? -1 : a.app > b.app ? 1 : 0));
for (const d of decisions) for (const s of d.prompt.stakeholders) concern('decisionModel', d.app, s.name, s.text);
// 42010 identifies each stakeholder by its concerns; one with none is open.
for (const s of stakeholders) if (!concerns.some((c) => c.stakeholder === s.slug)) refuse('stakeholder', s.slug, 'stakeholder-has-no-concern', s.name);

const register = {
  spec: 'uor-community/stakeholder-register/1',
  sources: pinned,
  stakeholders,
  decisions: decisions.map(({ prompt, ...d }) => d),
  concerns,
  refusals,
  counts: { stakeholders: stakeholders.length, decisions: decisions.length, concerns: concerns.length, refusals: refusals.length },
};
const text = `${JSON.stringify(register, null, 1)}\n`;
const target = join(here, 'register.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) fail('views/register.json is not the projection of its pinned sources');
} else writeFileSync(target, text);
process.stdout.write(`${stakeholders.length} stakeholders, ${decisions.length} decisions, ${concerns.length} concerns, ${refusals.length} open claims\n`);
