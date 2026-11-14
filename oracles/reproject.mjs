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

// git-commits: `repositories` lists of {name, commit[, history, remote]} under one base URL, from one or more pin files.
// git-urls: every {name, url, commit} object anywhere in the file, each fetched from its own URL.
const pinsOf = (kind, files) => {
  if (kind === 'git-commits') return [].concat(files).flatMap((f) => JSON.parse(readFileSync(join(root, f), 'utf8')).repositories).map((p) => ({ ...p, url: register.sources.base + (p.remote ?? p.name) }));
  const found = new Map();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.name === 'string' && typeof v.url === 'string' && typeof v.commit === 'string') {
        const seen = found.get(v.name);
        if (seen && (seen.url !== v.url || seen.commit !== v.commit)) throw new Error(`${files} pins ${v.name} twice`);
        found.set(v.name, { name: v.name, url: v.url, commit: v.commit });
      }
      Object.values(v).forEach(walk);
    }
  };
  for (const f of [].concat(files)) walk(JSON.parse(readFileSync(join(root, f), 'utf8')));
  return [...found.values()];
};
if (register.sources.kind === 'git-commits' || register.sources.kind === 'git-urls') {
  for (const { name, commit, url, history } of pinsOf(register.sources.kind, register.sources.file)) {
    const dir = join(sources, name);
    const at = () => run('git', ['-C', dir, 'rev-parse', 'HEAD']).trim();
    if (existsSync(join(dir, '.git')) && at() === commit) continue;
    rmSync(dir, { recursive: true, force: true });
    run('git', ['init', '-q', dir]);
    run('git', ['-C', dir, 'fetch', '-q', ...(history ? [] : ['--depth', '1']), url, commit]);
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
