#!/usr/bin/env node
/**
 * Draft the CHAOSS contributions that would close the ISO/IEC 15939 elements
 * neither the CHAOSS templates nor the CHAOSS oracle state. Nothing here is
 * submitted: every output is a draft for Alex to approve.
 *
 * Which contribution an open element needs is decided by the
 * upstream/chaoss-15939/prompt.json decision table, written here from the same
 * rules the drafts apply, so the drafts and the decision app cannot drift:
 *
 *   template   the CHAOSS template has no section for the element; propose one in
 *              chaoss/community community-templates/ (the templates every WG's
 *              revising-metric checklist points to)
 *   revision   the template has the section and this definition lacks it, leaves it
 *              empty, or repeats it; propose a revision in the authoring WG's repository
 *   oracle     the definition cites a GrimoireLab panel the oracle could not single a
 *              computation out of; ask the WG to name the computation, listing what the
 *              panel computes
 *   adopt      the oracle states the element; propose the oracle's value, with its citations
 *
 *   node chaoss/upstream.mjs <checkouts-dir> [--check]
 *
 * The checkouts dir needs chaoss/community at the commit chaoss/upstream-sources.json
 * pins. Writes upstream/chaoss-15939/: contributions.json, community-templates.patch,
 * pull-request.md, issues/<working-group>.md and prompt.json.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const root = args.find((a) => a !== '--check');
if (!root) { process.stderr.write('usage: upstream.mjs <checkouts-dir> [--check]\n'); process.exit(64); }
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const m = read('measurement.json');
const oracle = read('oracle-methods.json');
const register = read('register.json');
const src = read('upstream-sources.json');
if (oracle.measurement !== sha256(readFileSync(join(here, 'measurement.json')))) throw new Error('chaoss/oracle-methods.json is stale');
const community = src.repositories.find((r) => r.name === 'chaoss-community');
const cdir = join(root, community.name);
const at = execFileSync('git', ['-C', cdir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (at !== community.commit) throw new Error(`${community.name} is at ${at}, not ${community.commit}`);

// ---- The decision: which contribution closes an open element. ----
const ELEMENT_TITLE = {
  informationNeed: 'Question', measurableConcept: 'What We Want to Measure', entity: 'Entity', attribute: 'Attribute',
  measurementMethod: 'Measurement Method', scale: 'Scale', unit: 'Unit', baseMeasures: 'Metrics in the Metrics Model',
  measurementFunction: 'Measurement Function', analysisModel: 'Insights Drawn from the Metrics Model', decisionCriteria: 'Decision Criteria',
};
const decide = (templateReason, oracleStatus, oracleReason) => {
  if (oracleStatus === 'resolved') return 'adopt';
  if (templateReason === 'no-template-section') return /^oracle-panel-names|unstated-by-oracle|implementations-disagree|oracle-index-unresolved|oracle-link-unresolved|proposed-binding/.test(oracleReason ?? '') ? 'oracle' : 'template';
  return 'revision';
};
const oracleOf = new Map(oracle.items.map((x) => [x.index, x]));
const o0 = (c) => oracleOf.get(c.item);
const contributions = [];
for (const x of m.items) {
  const o = oracleOf.get(x.index);
  const def = x.kind === 'metric' ? register.metrics.find((r) => r.slug === x.slug) : register.models.find((r) => r.slug === x.slug);
  for (const e of x.entries.filter((y) => y.status === 'open')) {
    const oe = o?.elements.find((y) => y.element === e.element);
    const kind = decide(e.reason, oe?.status, oe?.reason);
    contributions.push({
      item: x.index, slug: x.slug, kind: x.kind, title: x.title, workingGroup: def.workingGroup, source: def.source,
      element: e.element, templateReason: e.reason, oracle: oe ? (oe.status === 'resolved' ? { value: oe.value, cites: oe.cites } : { reason: oe.reason, ...(oe.candidates !== undefined ? { candidates: oe.candidates } : {}) }) : null,
      contribution: kind,
      panels: kind === 'oracle' ? (o.links ?? []).filter((l) => l.dashboard).map((l) => ({ dashboard: l.dashboard, cited: l.source, computations: l.computations })) : undefined,
    });
  }
}
const tally = (k) => contributions.filter((c) => c.contribution === k).length;

// ---- The template change: one pull request to chaoss/community. ----
const metricBlock = `### Measurement Specification

(encouraged, the elements of the ISO/IEC 15939 measurement information model. Write ‘Not specified’ for an element that is not known yet.)

*   **Entity:** the object the metric characterizes, e.g., a repository, an issue, a change request, or a person.
*   **Attribute:** the property of the entity this metric measures.
*   **Measurement Method:** the operations that turn the data points in Data Collection Strategies into a value, e.g., count the change requests closed in the period.
*   **Scale:** nominal, ordinal, interval, or ratio.
*   **Unit:** the unit of the value, in UCUM (The Unified Code for Units of Measure) where one applies, e.g., \`d\` for days, \`1\` for a ratio, \`{commit}\` for a count of commits.
`;
const modelBlocks = {
  after: '## Metrics in the Metrics Model',
  before: `## What We Want to Measure
Provide text that names the property of a project or community that the metrics model, as a whole, measures. This is the measurable concept of ISO/IEC 15939.

`,
  then: `## Measurement Function
Provide text that explains how the values of the metrics in the model are combined into the model's result, e.g., a weighted sum, a ratio, or a rule over thresholds. If the metrics are read side by side and not combined, say so.

## Decision Criteria
Provide the thresholds or targets that tell a reader of the model's result what to do, and where each one comes from. If the model sets none, put ‘None specified’.

`,
};
function edit(path, transform) {
  const before = readFileSync(join(cdir, path), 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${path}: the anchor the draft edits was not found`);
  return { path, before, after };
}
const edits = [
  edit('community-templates/metric-template.md', (t) => t.replace('\n</details></span>\n', `\n${metricBlock}\n</details></span>\n`)),
  edit('community-templates/metrics-model-template.md', (t) => {
    const i = t.indexOf(modelBlocks.after);
    const j = t.indexOf('## Data Insights');
    if (i < 0 || j < 0) return t;
    return t.slice(0, i) + modelBlocks.before + t.slice(i, j) + modelBlocks.then + t.slice(j);
  }),
];
// The patch is git's own diff of the edited files against the pinned commit, so `git apply` takes it unchanged.
const work = mkdtempSync(join(tmpdir(), 'chaoss-templates-'));
let patch = '';
try {
  for (const e of edits) {
    mkdirSync(join(work, 'a', dirname(e.path)), { recursive: true });
    mkdirSync(join(work, 'b', dirname(e.path)), { recursive: true });
    writeFileSync(join(work, 'a', e.path), e.before);
    writeFileSync(join(work, 'b', e.path), e.after);
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', join('a', e.path), join('b', e.path)], { cwd: work, encoding: 'utf8' });
    patch += r.stdout.replace(/^diff --git a\/a\/(\S+) b\/b\/\S+$/m, 'diff --git a/$1 b/$1').replace(/^--- a\/a\//m, '--- a/').replace(/^\+\+\+ b\/b\//m, '+++ b/');
  }
} finally { rmSync(work, { recursive: true, force: true }); }

const byElement = (kind) => Object.entries(contributions.filter((c) => c.contribution === kind).reduce((a, c) => ({ ...a, [c.element]: (a[c.element] ?? 0) + 1 }), {})).map(([k, n]) => `${ELEMENT_TITLE[k]} (${n})`).join(', ');
const pr = `<!-- Draft for chaoss/community. Not submitted: it opens only after Alex approves. Every commit carries Signed-off-by (DCO), as CONTRIBUTING.md requires. -->
# Add ISO/IEC 15939 measurement elements to the metric and metrics model templates

## What this changes

* \`community-templates/metric-template.md\`: a **Measurement Specification** subsection under *Want to Know More?*, beside Data Collection Strategies, Filters and Visualizations, with five one-line fields: Entity, Attribute, Measurement Method, Scale and Unit.
* \`community-templates/metrics-model-template.md\`: **What We Want to Measure** before the metrics list, and **Measurement Function** and **Decision Criteria** after it.

Like the template's other *encouraged* parts, the new fields are optional, and ‘Not specified’ is a valid answer, so no released metric becomes non-conforming.

## Why

CHAOSS metrics answer a question, and ISO/IEC 15939 is the standard that says what else a measure has to state for two tools to compute it the same way. Mapped onto the 15939 information model, the ${m.counts.metrics} released metrics and ${m.counts.models} metrics models state ${m.counts.stated} of their ${m.counts.stated + m.counts.open} elements. ${tally('template') + tally('oracle')} of the ${m.counts.open} open elements have no template section to go in: ${byElement('template')}${tally('oracle') ? `, plus ${tally('oracle')} that GrimoireLab panels cite without singling one computation out` : ''}.

We checked what GrimoireLab ${oracle.release.tag} computes for the metrics whose definitions cite a GrimoireLab panel. It settles ${oracle.counts.resolved} elements; for the rest, a dashboard computes several things and nothing names which one is the metric. These fields let a working group say so once, in the definition.

## How it was produced

The mapping and this draft are generated, not hand-written: [UOR-Foundation/community](https://github.com/UOR-Foundation/community), \`chaoss/measurement.mjs\`, \`chaoss/oracle.mjs\` and \`chaoss/upstream.mjs\`, over the working-group repositories pinned to commits in \`chaoss/sources.json\` and GrimoireLab pinned in \`chaoss/oracle-sources.json\`. Each element cites the file and the sha256 of the text it was read from.

## Checklist

- [ ] Commits signed off (DCO)
- [ ] No HTML added beyond what the template already uses
- [ ] Working groups notified through their revising-metric issues (drafts in \`upstream/chaoss-15939/issues/\`)
`;

// ---- One revising-metric issue per working group, in the WG's own template. ----
const issues = new Map();
const groups = [...new Set(contributions.filter((c) => c.contribution !== 'template').map((c) => c.workingGroup))].sort();
for (const wg of groups) {
  const rows = contributions.filter((c) => c.workingGroup === wg && c.contribution !== 'template');
  const slugs = [...new Set(rows.map((r) => r.slug))];
  const lines = [`<!-- Draft for chaoss/${wg}, in its "Revising a Metric" issue template. Not submitted: it opens only after Alex approves, and after the template pull request in chaoss/community. One issue covers the working group's items; it can be split per metric if the WG prefers. -->`, '', '### Name of the Metric Being Revised', ''];
  for (const s of slugs) { const r = rows.find((y) => y.slug === s); lines.push(`* ${r.title} (\`${r.source.split(':').slice(1).join(':')}\`)`); }
  lines.push('', '### Link to Original Metric Release Issue', '', 'Not specified in the definitions; the working group can add them.', '', '### Specific Metric Details that Require Attention', '');
  for (const s of slugs) {
    const r = rows.filter((y) => y.slug === s);
    lines.push(`#### ${r[0].title}`, '');
    const pr = o0(r[0])?.proposal;
    if (pr) {
      lines.push(`The definition names GrimoireLab Perceval as the tool providing this metric, but no computation. GrimoireLab's own chat panels compute two of its Filters under the same names, and we propose citing them:`, '');
      for (const b of o0(r[0]).bindings) lines.push(`* **${b.proposal.filterText}** → GrimoireLab “${b.label}”: \`${b.series[0].aggregation}(${b.series[0].field})\` over the chat index, as ${b.proposal.panels.map((p) => `\`${p.source.split(':')[1]}\``).join(', ')} compute it.`);
      for (const u of pr.unmatched) lines.push(`* **${u.filter}**: ${u.why}`);
      lines.push('');
    }
    for (const c of r) {
      const name = ELEMENT_TITLE[c.element];
      if (c.contribution === 'adopt') {
        lines.push(`- **${name}:** GrimoireLab ${oracle.release.tag} computes this element; proposed value \`${typeof c.oracle.value === 'string' ? c.oracle.value : c.oracle.value.label || 'see binding'}\`. Sources: ${c.oracle.cites.map((x) => `\`${x.source}\``).join(', ')}.`);
      } else if (c.contribution === 'oracle') {
        if (o0(c).proposal) { lines.push(`- **${name}:** open until the working group names the computations proposed above.`); continue; }
        lines.push(`- **${name}:** the definition cites ${c.panels.map((p) => `\`${p.dashboard.split(':')[1]}\` (${p.computations} computations)`).join(' and ')}, and nothing names which computation is this metric (${c.oracle.reason}). Naming it settles the element.`);
      } else {
        lines.push(`- **${name}:** the template has this section and the definition ${c.templateReason === 'section-absent' ? 'lacks it' : c.templateReason === 'section-empty' ? 'leaves it empty' : 'repeats it'}.`);
      }
    }
    lines.push('');
  }
  lines.push('### Checklist', '', '- [ ] Create the “revising metric” labeled issue in the authoring WG’s repo for comments during review period', '- [ ] Create pull request of revised metric to WG’s repo', '- [ ] Metric adheres to the current metrics template', '');
  issues.set(wg, lines.join('\n'));
}

// ---- The decision app, from the rules above. ----
const prompt = {
  schema: 'prism/prompt/1',
  goal: 'Decide which CHAOSS contribution closes an ISO/IEC 15939 element a CHAOSS metric or metrics model leaves open, so each upstream draft asks a working group for exactly what is missing and nothing the oracle already states.',
  pattern: 'decisionTable',
  repository: 'UOR-Foundation/community',
  app: {
    name: 'chaoss-15939-contribution',
    title: 'CHAOSS measurement contribution',
    purpose: 'Decide, for one open 15939 element, whether to adopt the value GrimoireLab computes, ask the working group to name the computation a cited panel runs, propose a template section, or propose a revision of the definition.',
    fields: [
      { name: 'section', kind: 'choice', values: ['none', 'absent', 'empty', 'ambiguous'], means: 'the CHAOSS template state of the element: none (the template has no section for it), absent, empty or ambiguous (the definition lacks, leaves empty or repeats the section)' },
      { name: 'oracle', kind: 'choice', values: ['resolved', 'unsingled', 'uncited'], means: 'what GrimoireLab states: resolved (every computation agrees on the element), unsingled (the definition cites a panel, and its computations disagree or are unnamed), uncited (the definition cites no GrimoireLab panel)' },
    ],
    outcomes: ['adopt', 'oracle', 'template', 'revision'],
    meanings: {
      adopt: 'propose the value GrimoireLab computes, with its file and line citations',
      oracle: 'ask the working group to name which computation of the cited panel is the metric',
      template: 'propose the element as a section of the chaoss/community template',
      revision: 'propose a revision of the definition in its working group repository',
    },
    rules: [
      { when: [{ field: 'oracle', op: 'is', value: 'resolved' }], then: 'adopt', why: 'chaoss/oracle.mjs: an element every selected GrimoireLab computation agrees on is stated with its citations' },
      { when: [{ field: 'section', op: 'is', value: 'none' }, { field: 'oracle', op: 'is', value: 'unsingled' }], then: 'oracle', why: 'chaoss/oracle.mjs: a cited panel whose computations disagree or are unnamed leaves the element open until the WG names one' },
      { when: [{ field: 'section', op: 'is', value: 'none' }, { field: 'oracle', op: 'is', value: 'uncited' }], then: 'template', why: 'chaoss/measurement.mjs CROSSWALK: no CHAOSS template section carries the element' },
    ],
    otherwise: 'revision',
    otherwiseWhy: '03-revising-metric.md: a definition that lacks, leaves empty or repeats a template section does not adhere to the template, and is revised in its WG repository',
  },
  // The CHAOSS brand, as UOR-Foundation/grimoirelab-discord locks it (logos and palette from chaoss/community at the pinned commit).
  brand: read('brand.lock.json'),
  obligations: [
    { standard: 'Developer Certificate of Origin 1.1', subject: 'Commit sign-off', text: 'Every commit of an upstream pull request carries Signed-off-by from a person who can certify the DCO, as the CHAOSS CONTRIBUTING.md files require.', evidence: ['wg-metrics-development/CONTRIBUTING.md, DCO and Sign-Off for contributions'] },
    { standard: 'CHAOSS Revising a Metric issue template', subject: 'Working group process', text: 'A metric revision starts as a revising-metric issue in the authoring working group before any pull request.', evidence: ['.github/ISSUE_TEMPLATE/03-revising-metric.md', 'upstream/chaoss-15939/issues/'] },
    { standard: 'CHAOSS metric template', subject: 'Template conformance', text: 'Template additions are optional, encouraged parts with no HTML beyond what the template already uses.', evidence: ['community-templates/metric-template.md', 'upstream/chaoss-15939/community-templates.patch'] },
    { standard: 'CHAOSS Code of Conduct', subject: 'Participation', text: 'Every draft and its discussion follow the CHAOSS Code of Conduct.', evidence: ['https://github.com/chaoss/.github/blob/main/CODE_OF_CONDUCT.md'] },
  ],
};
// Every contribution the drafts carry is the decision the app makes for its inputs.
const sectionOf = (r) => ({ 'no-template-section': 'none', 'section-absent': 'absent', 'section-empty': 'empty', 'section-ambiguous': 'ambiguous' })[r];
const oracleOfC = (c) => (c.oracle?.value !== undefined ? 'resolved' : /^oracle-panel-names|unstated-by-oracle|implementations-disagree|oracle-index-unresolved|oracle-link-unresolved|proposed-binding/.test(c.oracle?.reason ?? '') ? 'unsingled' : 'uncited');
for (const c of contributions) {
  const inputs = { section: sectionOf(c.templateReason), oracle: oracleOfC(c) };
  const rule = prompt.app.rules.find((r) => r.when.every((w) => inputs[w.field] === w.value));
  const answer = rule ? rule.then : prompt.app.otherwise;
  if (answer !== c.contribution) throw new Error(`${c.slug} ${c.element}: the decision table says ${answer}, the draft says ${c.contribution}`);
}

const out = join(repo, 'upstream/chaoss-15939');
const outputs = new Map([
  [join(out, 'contributions.json'), JSON.stringify({ spec: 'uor-community/chaoss-15939-contributions/1', status: 'draft-not-submitted', measurement: sha256(readFileSync(join(here, 'measurement.json'))), oracle: sha256(readFileSync(join(here, 'oracle-methods.json'))), templates: { repository: 'chaoss/community', commit: community.commit }, counts: Object.fromEntries(['adopt', 'oracle', 'template', 'revision'].map((k) => [k, tally(k)])), contributions }, null, 1) + '\n'],
  [join(out, 'community-templates.patch'), patch],
  [join(out, 'pull-request.md'), pr],
  [join(out, 'prompt.json'), JSON.stringify(prompt, null, 2) + '\n'],
  ...[...issues].map(([wg, text]) => [join(out, 'issues', `${wg}.md`), text]),
]);
let stale = 0;
for (const [p, text] of outputs) {
  if (check) { if (!existsSync(p) || readFileSync(p, 'utf8') !== text) { process.stderr.write(`${p.slice(repo.length + 1)} is not the draft of the current mapping\n`); stale++; } }
  else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); }
}
if (stale) process.exit(1);
process.stdout.write(`${contributions.length} open elements: ${['adopt', 'oracle', 'template', 'revision'].map((k) => `${tally(k)} ${k}`).join(', ')}; ${issues.size} working-group issues\n`);
