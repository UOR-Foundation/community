#!/usr/bin/env node
/**
 * Observe what the remediation decision apps ask of each repository in
 * ecosystem/snapshot.json, by anonymous git alone, into remediation/observations.json:
 *
 *   the default branch and the commit it names, every other branch name,
 *   the paths at that commit that GOVERNANCE.md 6.1 names (and every root file
 *   that shares a required file's stem, as evidence), the CI workflows under
 *   .github/workflows with the job ids each runs on pull_request, the default
 *   branch's commit subjects counted against Conventional Commits 1.0.0, its
 *   first and last commit dates, and the copyright line of an existing LICENSE.
 *
 * Branch protection is not readable this way: GitHub serves it only to an
 * authenticated reader with admin rights. It is recorded as unobserved, and the
 * projector writes the protection a tier requires as a desired state instead.
 *
 * Every repository is pinned by the commit its default branch named when read,
 * so the projection replays from these bytes.
 *
 *   node remediation/observe.mjs <clones-dir> [--check]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [clones, flag] = process.argv.slice(2);
if (!clones) {
  process.stderr.write('usage: observe.mjs <clones-dir> [--check]\n');
  process.exit(64);
}
const snapshot = JSON.parse(readFileSync(join(here, '..', 'ecosystem', 'snapshot.json'), 'utf8'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

// Conventional Commits 1.0.0, items 1 to 5 of the specification.
const CONVENTIONAL = /^[A-Za-z]+(\([^()\s][^()]*\))?!?: \S/;
// GOVERNANCE.md 7.2 names the branch types; STANDARDS.md the {type}/{issue#}-{short-description} shape.
const BRANCH = /^(feat|fix|docs|chore)\/[0-9]+-\S+$/;
const STEMS = ['README', 'LICENSE', 'CONTRIBUTING', 'CODE_OF_CONDUCT', 'SECURITY', 'CODEOWNERS'];

// The job ids a workflow runs when a pull request is opened, read from the YAML's top two levels.
function workflow(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const top = (key) => {
    const at = lines.findIndex((l) => new RegExp(`^["']?${key}["']?\\s*:`).test(l));
    if (at < 0) return null;
    const inline = lines[at].replace(/^[^:]+:\s*/, '').replace(/\s+#.*$/, '');
    const body = [];
    for (const l of lines.slice(at + 1)) {
      if (/^\S/.test(l) && !/^#/.test(l)) break;
      body.push(l);
    }
    return { inline, body };
  };
  const on = top('on') ?? top('true');
  const triggers = on
    ? [on.inline, ...on.body.filter((l) => /^ {2}[\w-]+\s*:?/.test(l)).map((l) => l.trim().replace(/:.*$/, ''))].join(' ')
    : '';
  const jobs = top('jobs');
  const ids = jobs ? jobs.body.filter((l) => /^ {2}[\w-]+\s*:\s*$/.test(l)).map((l) => l.trim().replace(/:\s*$/, '')) : [];
  const names = jobs ? jobs.body.filter((l) => /^ {4}name\s*:/.test(l)).length : 0;
  const matrix = jobs ? jobs.body.some((l) => /^\s+matrix\s*:/.test(l)) : false;
  return { pullRequest: /\bpull_request(_target)?\b/.test(triggers), jobs: ids, renamed: names > 0, matrix };
}

const repositories = snapshot.repositories.map((r) => {
  const url = `https://github.com/UOR-Foundation/${r.name}.git`;
  const dir = join(clones, r.name);
  if (!existsSync(dir)) run('git', ['clone', '-q', '--bare', '--filter=blob:none', url, dir]);
  else run('git', ['fetch', '-q', '--prune', 'origin', '+refs/heads/*:refs/heads/*'], dir);
  const head = run('git', ['ls-remote', '--symref', url, 'HEAD']).match(/^ref: refs\/heads\/(\S+)\tHEAD$/m);
  const branch = head ? head[1] : '';
  if (!branch) return { name: r.name, empty: true };
  const commit = run('git', ['rev-parse', `refs/heads/${branch}`], dir).trim();
  const heads = run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], dir).split('\n').filter(Boolean).sort();
  const paths = run('git', ['ls-tree', '-r', '--name-only', commit], dir).split('\n').filter(Boolean);
  const evidence = paths.filter((p) => STEMS.some((s) => new RegExp(`^(\\.github/|docs/)?${s}([.-][^/]*)?$`, 'i').test(p))).sort();
  const workflows = paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).sort().map((p) => ({
    path: p,
    ...workflow(run('git', ['cat-file', 'blob', `${commit}:${p}`], dir)),
  }));
  const subjects = run('git', ['log', '--format=%s', commit], dir).split('\n').filter(Boolean);
  const dates = run('git', ['log', '--format=%cs', commit], dir).split('\n').filter(Boolean);
  const license = paths.includes('LICENSE') ? run('git', ['cat-file', 'blob', `${commit}:LICENSE`], dir) : '';
  const copyright = (license.match(/^\s*Copyright\b.*$/m) || [''])[0].trim();
  return {
    name: r.name,
    defaultBranch: branch,
    commit,
    files: {
      readme: paths.includes('README.md'),
      license: paths.includes('LICENSE'),
      contributing: paths.includes('CONTRIBUTING.md'),
      conduct: paths.includes('CODE_OF_CONDUCT.md'),
      security: paths.includes('SECURITY.md'),
      codeowners: paths.includes('.github/CODEOWNERS'),
      ci: workflows.length > 0,
    },
    evidence,
    workflows,
    branches: heads.filter((h) => h !== branch).map((h) => ({ name: h, conforming: BRANCH.test(h) })),
    commits: { total: subjects.length, conventional: subjects.filter((s) => CONVENTIONAL.test(s)).length },
    firstCommit: dates[dates.length - 1] ?? '',
    lastCommit: dates[0] ?? '',
    copyright,
    protection: 'unobserved',
  };
});

const text = `${JSON.stringify({ spec: 'uor-community/remediation-observations/1', repositories }, null, 2)}\n`;
const target = join(here, 'observations.json');
if (flag === '--check') {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
    process.stderr.write('remediation/observations.json differs from the repositories; re-observe and re-project\n');
    process.exit(1);
  }
} else {
  mkdirSync(here, { recursive: true });
  writeFileSync(target, text);
}
process.stdout.write(`${repositories.length} repositories observed\n`);
