#!/usr/bin/env node
/**
 * Collect the GitHub telemetry the security register reads, for every
 * repository of the ecosystem register (or the ones named), into
 * security/telemetry.json:
 *
 * - traffic: GitHub's 14-day daily views and clones, with unique counts, the
 *   referrers and the popular paths (repository traffic API; needs push access);
 * - own: per day, the Foundation's own Actions jobs that ran a checkout step,
 *   which each clone the repository once;
 * - forks: every fork, with its owner's account type and creation time.
 *
 * GitHub reports clone counts, not clients, so a day's unique cloners minus the
 * Foundation's own checkout jobs is what the Foundation's CI does not explain;
 * it is never attributed to anyone (open claim OC-CLONES). A repository whose
 * traffic the token cannot read is recorded as unread, never as zero.
 *
 *   node security/observe.mjs [owner/name ...]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.GITHUB_TOKEN;
// curl honours the runner's and the session's proxy settings, which Node's fetch does not.
const get = (path) => {
  const args = ['-sS', '-w', '\n%{http_code}', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  const out = execFileSync('curl', [...args, `https://api.github.com/${path}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const at = out.lastIndexOf('\n');
  const status = Number(out.slice(at + 1));
  return { status, body: status === 200 ? JSON.parse(out.slice(0, at)) : null };
};
const day = (t) => t.slice(0, 10);

const ecosystem = JSON.parse(readFileSync(join(root, 'ecosystem', 'register.json'), 'utf8'));
const named = process.argv.slice(2);
const repos = named.length ? named : ecosystem.repositories.map((r) => `UOR-Foundation/${r.name}`);

const observed = [];
for (const repo of repos) {
  const views = get(`repos/${repo}/traffic/views`);
  const clones = get(`repos/${repo}/traffic/clones`);
  if (views.status !== 200 || clones.status !== 200) {
    observed.push({ repository: repo, traffic: 'unread', status: Math.max(views.status, clones.status) });
    continue;
  }
  const days = clones.body.clones.map((c) => day(c.timestamp));
  const own = Object.fromEntries(days.map((d) => [d, 0]));
  // One query per day keeps every query under the API's 1000-run search cap.
  for (const d of days) {
    for (let page = 1; ; page++) {
      const runs = get(`repos/${repo}/actions/runs?per_page=100&page=${page}&created=${d}`).body?.workflow_runs ?? [];
      for (const run of runs) {
        const jobs = get(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100&filter=all`).body?.jobs ?? [];
        for (const job of jobs) {
          if (job.started_at && day(job.started_at) in own && (job.steps ?? []).some((s) => /checkout/i.test(s.name ?? ''))) own[day(job.started_at)] += 1;
        }
      }
      if (runs.length < 100) break;
    }
  }
  const forks = [];
  for (let page = 1; ; page++) {
    const batch = get(`repos/${repo}/forks?per_page=100&page=${page}`).body ?? [];
    forks.push(...batch.map((f) => ({ created: f.created_at, ownerType: f.owner.type })));
    if (batch.length < 100) break;
  }
  observed.push({
    repository: repo,
    traffic: 'read',
    views: views.body.views.map((v) => ({ day: day(v.timestamp), count: v.count, uniques: v.uniques })),
    clones: clones.body.clones.map((c) => ({ day: day(c.timestamp), count: c.count, uniques: c.uniques, ownCheckoutJobs: own[day(c.timestamp)] })),
    referrers: get(`repos/${repo}/traffic/popular/referrers`).body ?? [],
    forks: forks.sort((a, b) => a.created.localeCompare(b.created)),
  });
  process.stderr.write(`${repo}: ${clones.body.uniques} unique cloners, ${Object.values(own).reduce((a, b) => a + b, 0)} own checkout jobs\n`);
}

// Naming repositories refreshes only them: the others keep their last observation.
const kept = named.length && existsSync(join(root, 'security', 'telemetry.json')) ? (JSON.parse(readFileSync(join(root, 'security', 'telemetry.json'), 'utf8')).repositories ?? []).filter((r) => !repos.includes(r.repository)) : [];
const telemetry = {
  spec: 'uor-community/security-telemetry/1',
  about: 'GitHub telemetry for the security register, written by security/observe.mjs. A day\'s unique cloners minus the Foundation\'s own checkout jobs is what its CI does not explain; nothing here attributes a clone to anyone.',
  collected: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  repositories: [...kept, ...observed].sort((a, b) => a.repository.localeCompare(b.repository)),
};
writeFileSync(join(root, 'security', 'telemetry.json'), JSON.stringify(telemetry, null, 1) + '\n');
