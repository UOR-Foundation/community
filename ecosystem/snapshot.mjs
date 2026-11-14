#!/usr/bin/env node
/**
 * Snapshot the UOR Foundation's public repositories into ecosystem/snapshot.json:
 * the repository set from the GitHub search query in sources.json, each
 * repository's topic tags, archival and primary language, its release tags read
 * with anonymous `git ls-remote` (a tag is its name and the commit it names),
 * and the TOC application issues of UOR-Foundation/.github. Only fields that
 * the register reads are kept, so a snapshot changes only when the ecosystem
 * does. The projector pins the snapshot by its sha256.
 *
 * Only public repositories are read: the register is published, and a private
 * repository's name is not the Foundation's to publish.
 *
 *   node ecosystem/snapshot.mjs [--check]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const ghSearch = (path, q) =>
  run('gh', ['api', '-X', 'GET', path, '-f', `q=${q}`, '-f', 'per_page=100', '--paginate', '--jq', '.items[]'])
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const repos = ghSearch('search/repositories', sources.ecosystem.query)
  .filter((r) => r.visibility === 'public' && !r.private)
  .map((r) => {
    const refs = run('git', ['ls-remote', '--tags', `https://github.com/${r.full_name}.git`]).split('\n').filter(Boolean);
    const byName = new Map();
    for (const line of refs) {
      const [commit, ref] = line.split('\t');
      const peeled = ref.endsWith('^{}');
      const name = ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
      if (peeled || !byName.has(name)) byName.set(name, commit);
    }
    return {
      name: r.name,
      archived: r.archived,
      fork: r.fork,
      language: r.language ?? '',
      topics: [...(r.topics ?? [])].sort(),
      tags: [...byName].map(([name, commit]) => ({ name, commit })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    };
  })
  .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));

const tocApplications = ghSearch('search/issues', sources.toc.query)
  .map((i) => ({ number: i.number, title: i.title, state: i.state, stateReason: i.state_reason ?? '' }))
  .sort((a, b) => a.number - b.number);

const text = `${JSON.stringify({ spec: 'uor-community/ecosystem-snapshot/1', query: sources.ecosystem.query, tocQuery: sources.toc.query, repositories: repos, tocApplications }, null, 2)}\n`;
const target = join(here, 'snapshot.json');
if (process.argv[2] === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
    process.stderr.write('ecosystem/snapshot.json differs from the live ecosystem; re-snapshot and re-project\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
process.stdout.write(`${repos.length} public repositories, ${tocApplications.length} TOC applications\n`);
