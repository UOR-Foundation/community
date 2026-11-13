#!/usr/bin/env node
/**
 * Bind oracle.lock.json to the bytes it vouches for: the wrapper's digest
 * (verify.sh) and each local corpus's digest. A corpus digest is the SHA-256
 * of its sorted "<sha256>  <path>\n" lines, the shape `sha256sum` prints, so
 * it can be re-derived without this script. An upstream corpus is addressed
 * by the commit its authority pins and needs no digest here.
 *
 *   node oracles/grimoirelab/lock.mjs [--check]
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function treeDigest(dir) {
  const lines = walk(dir)
    .map((p) => `${sha256(readFileSync(p))}  ${relative(dir, p).split('\\').join('/')}\n`)
    .sort();
  return sha256(lines.join(''));
}

const path = join(here, 'oracle.lock.json');
const before = readFileSync(path, 'utf8');
const lock = JSON.parse(before);
for (const oracle of lock.oracles) {
  oracle.wrapper_sha256 = sha256(readFileSync(join(root, oracle.executable)));
  if (oracle.corpus.revision === undefined) {
    oracle.corpus.sha256 = treeDigest(join(root, oracle.corpus.path));
  }
}
const after = JSON.stringify(lock, null, 2) + '\n';

if (process.argv[2] === '--check') {
  if (before !== after) {
    process.stderr.write('oracle.lock.json does not match the wrapper or corpus bytes; run node oracles/grimoirelab/lock.mjs\n');
    process.exit(1);
  }
} else {
  writeFileSync(path, after);
}
