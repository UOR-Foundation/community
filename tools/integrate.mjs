#!/usr/bin/env node
/**
 * Merge workstream branches into the current branch, resolving the files that
 * every workstream edits by rule rather than by hand:
 *
 *   app/lexlean.toml   entrypoints are the sorted union; any other difference refuses
 *   model/ids.toml     [[id]] rows are the union by id; one id with two statements refuses
 *   app/lexlean.lock   regenerated afterwards by `lexlean lock` (the SDK owns its bytes)
 *   CONFORMANCE.md     regenerated afterwards by `xtask check-model --write`
 *
 * Any other conflicted path stops the run with the branch named, so a human or
 * its workstream resolves it. Nothing is guessed.
 *
 *   node tools/integrate.mjs <ref>...
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const stage = (n, p) => git('show', `:${n}:${p}`);
const REGENERATED = new Set(['app/lexlean.lock', 'CONFORMANCE.md']);

function entrypoints(text) {
  const m = text.match(/^entrypoints = (\[.*\])$/m);
  if (!m) throw new Error('lexlean.toml has no single-line entrypoints');
  return JSON.parse(m[1]);
}
function lexleanToml(ours, theirs) {
  const strip = (t) => t.replace(/^entrypoints = .*$/m, '');
  if (strip(ours) !== strip(theirs)) throw new Error('app/lexlean.toml differs outside entrypoints');
  const all = [...new Set([...entrypoints(ours), ...entrypoints(theirs)])].sort();
  return ours.replace(/^entrypoints = .*$/m, `entrypoints = ${JSON.stringify(all).replace(/","/g, '", "')}`);
}

function rows(text) {
  const [head, ...blocks] = text.split(/^(?=\[\[id\]\]$)/m);
  return { head, blocks: blocks.map((b) => b.replace(/\n*$/, '\n')) };
}
const idOf = (b) => (b.match(/^id = "([^"]+)"$/m) || [])[1];
function idsToml(ours, theirs, base) {
  const o = rows(ours);
  const t = rows(theirs);
  const b0 = new Map(rows(base).blocks.map((b) => [idOf(b), b]));
  if (o.head !== t.head) throw new Error('model/ids.toml differs before its first row');
  const seen = new Map(o.blocks.map((b) => [idOf(b), b]));
  const out = [...o.blocks];
  for (const b of t.blocks) {
    const id = idOf(b);
    if (!seen.has(id)) { seen.set(id, b); out.push(b); }
    else if (seen.get(id) !== b) {
      // Three-way per row: a side that left the row as the merge base had it yields to the side that changed it.
      if (seen.get(id) === b0.get(id)) { out[out.indexOf(seen.get(id))] = b; seen.set(id, b); }
      else if (b !== b0.get(id)) throw new Error(`model/ids.toml: ${id} changed on both branches`);
    }
  }
  return o.head + out.join('\n');
}

const RULES = { 'app/lexlean.toml': lexleanToml, 'model/ids.toml': idsToml };
for (const ref of process.argv.slice(2)) {
  try { git('merge', '--no-edit', '-q', ref); console.log(`${ref}: clean`); continue; } catch {}
  const conflicted = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
  const unknown = conflicted.filter((p) => !RULES[p] && !REGENERATED.has(p));
  if (unknown.length) {
    git('merge', '--abort');
    throw new Error(`${ref}: resolve by hand: ${unknown.join(' ')}`);
  }
  for (const p of conflicted) {
    writeFileSync(p, REGENERATED.has(p) ? stage(2, p) : RULES[p](stage(2, p), stage(3, p), stage(1, p)));
    git('add', p);
  }
  git('commit', '-q', '--no-edit');
  console.log(`${ref}: resolved ${conflicted.join(' ')}`);
}
console.log('now regenerate: (cd app && lexlean lock) in the pinned SDK, then cargo run -q -p xtask -- check-model --write');
