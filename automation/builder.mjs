/**
 * The decision apps of automation/, as the Prism-DevRel builder at the commit
 * apps/set.json pins compiles them: each prompt is re-checked by the builder's
 * checkedSpec (every example, and every property over the whole request space;
 * a prompt that fails refuses the run), and each answer is prism-code's
 * `respond`, the dispatch the compiled guest is checked against. The builder is
 * addressed by its commit, so a checkout of it is reused as is (apps/build.sh).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

async function builder() {
  if (process.env.PRISM_BUILDER) return dirname(process.env.PRISM_BUILDER);
  const set = JSON.parse(readFileSync(join(root, 'apps/set.json'), 'utf8')).builder;
  const dir = join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME, '.cache'), 'prism-devrel', set.commit);
  if (!existsSync(join(dir, 'builder/cli.mjs'))) {
    mkdirSync(dir, { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
    git('init', '-q');
    git('fetch', '-q', '--depth', '1', `https://github.com/${set.repository}`, set.commit);
    git('checkout', '-q', 'FETCH_HEAD');
  }
  const at = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (at !== set.commit) throw new Error(`builder checkout is ${at}, not ${set.commit}`);
  return join(dir, 'builder');
}

const b = await builder();
const { checkedSpec } = await import(join(b, 'model.mjs'));
const { judge, respond } = await import(join(b, 'vendor/prism-code/src/journey/spec.mjs'));

/** The checked spec of one prompt in automation/. */
export const load = (file) => checkedSpec(JSON.parse(readFileSync(join(here, file), 'utf8')).app);

/** One answer, with the request text and the rule that gave it. */
export const decide = (spec, request) => {
  const text = spec.fields.map((f) => request[f.name]).join(' ');
  const outcome = respond(spec, new TextEncoder().encode(text));
  const { rule } = judge(spec, request);
  if (outcome === 'invalid') throw new Error(`${spec.name} refuses ${text}`);
  return { app: spec.name, request: text, outcome, rule: rule ?? 'otherwise' };
};
