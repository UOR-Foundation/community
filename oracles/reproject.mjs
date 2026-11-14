#!/usr/bin/env node
/**
 * Re-project one register from its pinned sources and fail if any output
 * differs from the committed bytes.
 *
 *   node oracles/reproject.mjs <area> <sources-dir>
 *   node oracles/reproject.mjs --matrix        # the areas, as JSON, for CI
 *   node oracles/reproject.mjs --tools <area>  # the tool versions, for the cache key
 *
 * Sources of kind git-commits are fetched at the exact commit each one pins;
 * git re-derives the commit id on fetch, so a fetched tree is its address. A
 * checkout already at the pinned commit is reused, and any other state is
 * refetched. Nothing is fetched by branch or tag.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'oracles', 'registers.json'), 'utf8'));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
const entry = (area) => {
  const found = manifest.registers.find((r) => r.area === area);
  if (!found) throw new Error(`no register ${area} in oracles/registers.json`);
  return found;
};

const [first, second] = process.argv.slice(2);

if (first === '--matrix') {
  process.stdout.write(JSON.stringify(manifest.registers.map((r) => ({ area: r.area, sources: [].concat(r.sources.file).join('\n'), inputs: r.inputs.join('\n') }))));
  process.exit(0);
}

if (first === '--tools') {
  for (const tool of entry(second).tools) {
    // Some tools (pdftotext -v) print their version on stderr.
    const r = spawnSync(tool[0], tool.slice(1), { encoding: 'utf8' });
    if (r.error) throw r.error;
    const out = `${r.stdout}${r.stderr}`.trim();
    process.stdout.write(`${tool.join(' ')}: ${out.split('\n')[0]}\n`);
  }
  process.exit(0);
}

if (!first || !second) {
  process.stderr.write('usage: reproject.mjs <area> <sources-dir> | --matrix | --tools <area>\n');
  process.exit(64);
}

const register = entry(first);
const sources = second;
mkdirSync(sources, { recursive: true });

if (register.sources.kind === 'git-commits') {
  // A register may read several pin files; a repository may be fetched with its history, or under another remote name.
  const pins = [].concat(register.sources.file).flatMap((f) => JSON.parse(readFileSync(join(root, f), 'utf8')).repositories);
  for (const { name, commit, history, remote } of pins) {
    const dir = join(sources, name);
    const at = () => run('git', ['-C', dir, 'rev-parse', 'HEAD']).trim();
    if (existsSync(join(dir, '.git')) && at() === commit) continue;
    rmSync(dir, { recursive: true, force: true });
    run('git', ['init', '-q', dir]);
    run('git', ['-C', dir, 'fetch', '-q', ...(history ? [] : ['--depth', '1']), register.sources.base + (remote ?? name), commit]);
    run('git', ['-C', dir, 'checkout', '-q', '--detach', 'FETCH_HEAD']);
    if (at() !== commit) throw new Error(`${name} is at ${at()}, not the pinned ${commit}`);
  }
} else {
  throw new Error(`unknown source kind ${register.sources.kind}`);
}

for (const command of register.check) {
  const [cmd, ...args] = command.map((a) => a.replace('{sources}', sources));
  process.stdout.write(`$ ${[cmd, ...args].join(' ')}\n`);
  run(cmd, args, { stdio: 'inherit' });
}
