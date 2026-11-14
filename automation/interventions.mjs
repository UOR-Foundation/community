#!/usr/bin/env node
/**
 * The intervention runner: one pass over interventions/register.json, doing
 * exactly what uor-intervention-admission (intervention-admission.prompt.json,
 * OASIS XACML 3.0) permits for each proposal, and nothing else. It writes no
 * rule of its own.
 *
 * Before it acts it re-derives what it reads: interventions/project.mjs --check
 * must pass (the register is the projection of the pinned corpus and the
 * policy), every chart's signal is re-answered by uor-intervention-signal and
 * every proposal's admission by uor-intervention-admission through the pinned
 * builder (automation/builder.mjs), and a difference refuses the run.
 *
 * What it can do:
 *   record      a CloudEvents 1.0 record per proposal, to --events and the job summary;
 *   agent-task  an agent-task issue in UOR-Foundation/community, only for a proposal
 *               automation/intervention-approvals.json approves by id.
 * What it never does: anything a contributor, participant or partner reads. A
 * proposal that reaches people is always denied, and its draft is listed in the
 * job summary for Alex, who decides whether to send it.
 *
 *   node automation/interventions.mjs [--dry-run] [--events <file.jsonl>]
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, load } from './builder.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const dry = argv.includes('--dry-run');
const eventsFile = opt('--events');
const HOME = 'UOR-Foundation/community';

// ---- Re-derived on read.
execFileSync('node', [join(root, 'interventions/project.mjs'), '--check'], { stdio: ['ignore', 'ignore', 'inherit'] });
const register = JSON.parse(readFileSync(join(root, 'interventions/register.json'), 'utf8'));
const approvals = new Set(JSON.parse(readFileSync(join(here, 'intervention-approvals.json'), 'utf8')).approvals.map((a) => a.proposal));
const signal = load('intervention-signal.prompt.json');
const admission = load('intervention-admission.prompt.json');
const charts = new Map();
for (const ch of register.charts) {
  const s = decide(signal, ch.request);
  if (s.outcome !== ch.signal) throw new Error(`${ch.id}: the register says ${ch.signal}, uor-intervention-signal answers ${s.outcome}`);
  charts.set(ch.id, { ...ch, decision: s });
}

// ---- Telemetry: CloudEvents 1.0.
const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : 'urn:uor:interventions:local';
let seq = 0;
const summary = (text) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
function record(subject, data) {
  const event = { specversion: '1.0', id: `${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-${++seq}`, source: runUrl, type: 'org.uorfoundation.community.intervention', subject, time: new Date().toISOString(), datacontenttype: 'application/json', data };
  const line = JSON.stringify(event);
  console.log(line);
  if (eventsFile) appendFileSync(eventsFile, `${line}\n`);
}

// ---- GitHub: only ever this repository's own issues.
const repo = process.env.GITHUB_REPOSITORY;
const gh = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', input, maxBuffer: 1 << 28 });
let openTasks;
function agentTask(p, ch) {
  if (repo !== HOME) return `not opened: agent tasks are opened only in ${HOME}`;
  const title = `agent-task: investigate ${ch.label} ${p.signal === 'rise' ? 'rising' : 'falling'} in ${p.subject} (${p.week.split('/')[0]})`;
  openTasks ??= JSON.parse(gh(['--paginate', '--slurp', `repos/${repo}/issues?state=open&labels=agent-task&per_page=100`])).flat();
  if (openTasks.some((i) => i.title === title)) return 'agent task already open';
  if (dry) return 'opened an agent task (dry run)';
  const body = `${p.text}\n\nProposal \`${p.id}\`, approved in automation/intervention-approvals.json.\nChart: \`${ch.id}\`\nDecided by ${runUrl}\n\nThe scheduled agent loop picks this up (automation/AUTOMATION.md, A3 and I1).`;
  try {
    gh(['-X', 'POST', `repos/${repo}/issues`, '--input', '-'], JSON.stringify({ title, body, labels: ['agent-task'] }));
    return 'opened an agent task';
  } catch (e) {
    return `opening the agent task failed: ${String(e.stderr ?? e.message).trim().split('\n').pop()}`;
  }
}

summary(`### Interventions${dry ? ' (dry run)' : ''}\n\nCorpus cut ${register.corpus.cut}; ${register.counts.charts} charts: ${Object.entries(register.counts.signal).map(([k, v]) => `${v} ${k}`).join(', ')}.\n\n| proposal | subject | chart | signal | reach | admission | action |\n|---|---|---|---|---|---|---|\n`);
const drafts = [];
const waiting = [];
for (const p of register.proposals) {
  const ch = charts.get(p.chart);
  if (!ch) throw new Error(`${p.id} names chart ${p.chart}, which the register does not draw`);
  const a = decide(admission, { signal: ch.signal, reach: p.reach, approval: approvals.has(p.id) ? 'exact' : 'none' });
  if (a.outcome !== p.admission) throw new Error(`${p.id}: the register says ${p.admission}, uor-intervention-admission answers ${a.outcome}`);
  if (a.outcome === 'permit' && p.reach === 'people') throw new Error(`${p.id}: a proposal that reaches people was permitted; the runner never acts on one`);
  let action = 'none';
  if (a.outcome === 'permit' && p.reach === 'record') action = 'recorded';
  if (a.outcome === 'permit' && p.reach === 'agent-task') action = agentTask(p, ch);
  if (a.outcome === 'deny' && p.reach === 'people') { action = 'drafted for Alex'; drafts.push(p); }
  if (a.outcome === 'deny' && p.reach === 'agent-task') { action = 'awaiting approval'; waiting.push(p); }
  record(p.subject, { proposal: p.id, action: p.action, chart: ch.id, label: ch.label, week: p.week, signal: ch.decision, admission: a, did: action });
  summary(`| \`${p.id}\` | ${p.subject} | ${ch.label} | ${ch.signal} | ${p.reach} | ${a.outcome} (${a.rule}) | ${action} |\n`);
}
for (const e of register.effects) record(e.proposal, { effect: e });
if (drafts.length) summary(`\n#### Drafts for Alex\n\nNothing below was sent. Each is a suggestion Alex may send, change or drop.\n\n${drafts.map((p) => `- \`${p.id}\` (${p.action}, ${p.subject}): ${p.text}`).join('\n')}\n`);
if (waiting.length) summary(`\n#### Agent tasks awaiting approval\n\nAn agent task opens only once automation/intervention-approvals.json approves its id.\n\n${waiting.map((p) => `- \`${p.id}\` ${p.subject}: ${p.text}`).join('\n')}\n`);
