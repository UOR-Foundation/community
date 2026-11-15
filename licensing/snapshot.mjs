#!/usr/bin/env node
/**
 * Pin every public repository of ecosystem/snapshot.json at the commit its
 * default branch names now, read with anonymous `git ls-remote <url> HEAD`.
 * licensing/snapshot.json is then a list of {name, url, commit} that
 * oracles/reproject.mjs fetches exactly, so the licensing register is always
 * projected from those trees and never from a branch.
 *
 *   node licensing/snapshot.mjs [--check]
 *
 * --check re-reads the heads and fails when any has moved: the register is
 * stale, not wrong, and is re-pinned by running this without --check.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const ecoBytes = readFileSync(join(here, '..', sources.ecosystem.snapshot));
const eco = JSON.parse(ecoBytes.toString('utf8'));

const repositories = eco.repositories.map((r) => {
  const url = `https://github.com/UOR-Foundation/${r.name}.git`;
  const head = execFileSync('git', ['ls-remote', url, 'HEAD'], { encoding: 'utf8' }).split('\n').find((l) => l.endsWith('\tHEAD'));
  if (!head) throw new Error(`${r.name} has no HEAD`);
  return { name: `repo-${r.name}`, repository: r.name, url, commit: head.split('\t')[0] };
});

const text = `${JSON.stringify({
  spec: 'uor-community/licensing-snapshot/1',
  ecosystemSnapshot: { path: sources.ecosystem.snapshot, sha256: createHash('sha256').update(ecoBytes).digest('hex') },
  repositories,
}, null, 2)}\n`;
const target = join(here, 'snapshot.json');
if (process.argv[2] === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
    process.stderr.write('licensing/snapshot.json no longer names every default-branch head; re-pin and re-project\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
process.stdout.write(`${repositories.length} repositories pinned\n`);
