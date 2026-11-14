#!/usr/bin/env node
/**
 * Write one repository's pull-request changes from remediation/register.json
 * into a checkout of that repository, exactly as the change set states them.
 * Only changes the uor-remediation-write app routes to a pull request are
 * written; a file the checkout already holds is refused, never overwritten.
 *
 *   node remediation/write-pr.mjs <repository> <checkout-dir>
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [name, dir] = process.argv.slice(2);
if (!name || !dir) {
  process.stderr.write('usage: write-pr.mjs <repository> <checkout-dir>\n');
  process.exit(64);
}
const register = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const repo = register.repositories.find((r) => r.name === name);
if (!repo) throw new Error(`${name} is not in remediation/register.json`);
const files = repo.now.filter((c) => c.by === 'pull-request' && c.kind === 'file');
if (!files.length) throw new Error(`${name} has no pull-request change`);
for (const c of files) {
  if (typeof c.content !== 'string') throw new Error(`${name}: ${c.path} has no content`);
  const target = join(dir, c.path);
  if (existsSync(target)) throw new Error(`${name}: ${c.path} already exists in the checkout`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, c.content);
  process.stdout.write(`${c.path}\n`);
}
