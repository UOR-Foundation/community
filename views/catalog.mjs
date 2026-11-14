#!/usr/bin/env node
/**
 * Write every surface of the stakeholder views from views/register.json and
 * chaoss/register.json, so nothing a stakeholder reads is written by hand:
 *
 *   app/src/Viewpoints.lex.tex  ISO/IEC/IEEE 42010 stakeholders, concerns,
 *                               viewpoints and views, and viewsValidHolds;
 *   site/views/                 one HTML page and one Markdown twin per view,
 *                               an index, and llms.txt;
 *   views/discord.json          the read-only Discord digest: Discord API v10
 *                               execute-webhook bodies, within Discord's limits.
 *
 * A stakeholder's view holds the metrics models and decisions that address its
 * concerns. An agent that acts on behalf of a principal (PROV-O) also sees the
 * principal's decisions: those are the norms it carries out. Open claims follow
 * what they are about. The same registers always write the same bytes.
 *
 *   node views/catalog.mjs [--check]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const json = (p) => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const reg = json('views/register.json');
const chaoss = json('chaoss/register.json');
const { site } = json('views/sources.json');
const V = 'Foundation.Viewpoint.V1.Model';

// Indices, in register order.
const stakeholders = reg.stakeholders;
const sIndex = new Map(stakeholders.map((s, i) => [s.slug, i]));
const mIndex = new Map(chaoss.models.map((m, i) => [m.slug, i]));
const dIndex = new Map(reg.decisions.map((d, i) => [d.app, i]));
const subjectIndex = (kind, subject) => {
  const map = { measurementModel: mIndex, decisionModel: dIndex, stakeholder: sIndex }[kind];
  if (!map.has(subject)) throw new Error(`${kind} ${subject} is not declared`);
  return map.get(subject);
};
const concerns = reg.concerns.map((c, i) => ({ ...c, index: i, s: sIndex.get(c.stakeholder), n: subjectIndex(c.kind, c.subject) }));
const claims = reg.refusals.map((c, i) => ({ ...c, index: i, n: subjectIndex(c.kind, c.subject) }));
const registerClaims = chaoss.refusals.map((c, i) => ({ ...c, index: i, model: mIndex.get(c.slug) }));

const uniq = (xs) => [...new Set(xs)].sort((a, b) => a - b);
const views = stakeholders.map((s, i) => {
  const own = concerns.filter((c) => c.s === i);
  const principal = s.actedOnBehalfOf ? sIndex.get(s.actedOnBehalfOf) : null;
  const models = uniq(own.filter((c) => c.kind === 'measurementModel').map((c) => c.n));
  const decisions = uniq([
    ...own.filter((c) => c.kind === 'decisionModel').map((c) => c.n),
    ...(principal === null ? [] : concerns.filter((c) => c.s === principal && c.kind === 'decisionModel').map((c) => c.n)),
  ]);
  return {
    index: i,
    stakeholder: s,
    principal,
    concerns: own.map((c) => c.index),
    models,
    decisions,
    registerClaims: registerClaims.filter((c) => models.includes(c.model)).map((c) => c.index),
    claims: claims
      .filter((c) => (c.kind === 'stakeholder' && c.n === i) || (c.kind === 'measurementModel' && models.includes(c.n)) || (c.kind === 'decisionModel' && decisions.includes(c.n)))
      .map((c) => c.index),
  };
});
const unviewed = claims.filter((c) => !views.some((v) => v.claims.includes(c.index)));

// ---------------------------------------------------------------- LexLean
const str = (s) => JSON.stringify(String(s));
const nats = (xs) => xs.reduceRight((rest, x) => `(cons ${x} ${rest})`, '(nil Nat)');
const list = (type, names) => names.reduceRight((rest, n) => `(cons (${n}) ${rest})`, `(nil ${V}::${type})`);
const pascal = (s) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
// lexlean fmt's canonical form: one line when it fits in 100 columns.
const def = (name, type, body) => {
  const line = `definition{name: ${name}, parameters: [], result: ${type}, body: ${body}}`;
  return line.length <= 100 ? `${line}\n` : `definition{\n  name: ${name},\n  parameters: [],\n  result: ${type},\n  body: ${body}\n}\n`;
};
const ctor = (type, name) => `(ctor ${V}::${type}.${name})`;
const sourceRef = (id) => reg.sources.find((x) => x.id === id);

const lean = [];
lean.push(`\\begin{lexlean}{Viewpoints}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\useglossary{prism.arch@1.0.0}\n\\importmodule{${V}}\n\\title{Stakeholder views}\n\\begin{semanticmodule}`);
const sNames = stakeholders.map((s, i) => {
  const name = `stakeholder${pascal(s.slug)}`;
  const src = sourceRef(s.source);
  lean.push(def(name, `${V}::Stakeholder`, `(record ${V}::Stakeholder {index := ${i}, slug := ${str(s.slug)}, name := ${str(s.name)}, kind := ${ctor('StakeholderKind', s.kind)}, principal := ${s.actedOnBehalfOf ? sIndex.get(s.actedOnBehalfOf) : i}, source := ${str(`${src.ref}#sha256:${src.sha256}`)}, quote := ${str(s.quote)}})`));
  return name;
});
const dNames = reg.decisions.map((d, i) => {
  const name = `decision${pascal(d.app)}`;
  lean.push(def(name, `${V}::Decision`, `(record ${V}::Decision {index := ${i}, app := ${str(d.app)}, pattern := ${str(d.pattern)}, source := ${str(d.path)}, sourceDigest := ${str(`sha256:${d.sha256}`)}})`));
  return name;
});
const cNames = concerns.map((c) => {
  const name = `concern${c.index}`;
  lean.push(def(name, `${V}::Concern`, `(record ${V}::Concern {index := ${c.index}, stakeholder := ${c.s}, kind := ${ctor('SubjectKind', c.kind)}, subject := ${c.n}, text := ${str(c.text)}})`));
  return name;
});
const vpNames = views.map((v) => {
  const name = `viewpoint${pascal(v.stakeholder.slug)}`;
  lean.push(def(name, `${V}::Viewpoint`, `(record ${V}::Viewpoint {index := ${v.index}, stakeholder := ${v.index}, concerns := ${nats(v.concerns)}})`));
  return name;
});
const vNames = views.map((v) => {
  const name = `view${pascal(v.stakeholder.slug)}`;
  lean.push(def(name, `${V}::View`, `(record ${V}::View {index := ${v.index}, viewpoint := ${v.index}, models := ${nats(v.models)}, decisions := ${nats(v.decisions)}, registerClaims := ${nats(v.registerClaims)}, claims := ${nats(v.claims)}})`));
  return name;
});
const clNames = claims.map((c) => {
  const name = `viewClaim${c.index}`;
  lean.push(def(name, `${V}::OpenClaim`, `(record ${V}::OpenClaim {index := ${c.index}, kind := ${ctor('SubjectKind', c.kind)}, subject := ${c.n}, name := ${str(c.detail)}, reason := ${str(c.refusal)}})`));
  return name;
});
const range = (n) => [...Array(n).keys()];
lean.push(def('bounds', `${V}::Bounds`, `(record ${V}::Bounds {stakeholders := ${stakeholders.length}, models := ${chaoss.models.length}, decisions := ${reg.decisions.length}, concerns := ${concerns.length}, registerClaims := ${chaoss.refusals.length}, claims := ${claims.length}})`));
lean.push(def('stakeholders', `(List ${V}::Stakeholder)`, list('Stakeholder', sNames)));
lean.push(def('decisions', `(List ${V}::Decision)`, list('Decision', dNames)));
lean.push(def('concerns', `(List ${V}::Concern)`, list('Concern', cNames)));
lean.push(def('viewpoints', `(List ${V}::Viewpoint)`, list('Viewpoint', vpNames)));
lean.push(def('views', `(List ${V}::View)`, list('View', vNames)));
lean.push(def('viewClaims', `(List ${V}::OpenClaim)`, list('OpenClaim', clNames)));
lean.push(def('modelIndices', '(List Nat)', nats(range(chaoss.models.length))));
lean.push(def('decisionIndices', '(List Nat)', nats(range(reg.decisions.length))));
lean.push(def('stakeholderIndices', '(List Nat)', nats(range(stakeholders.length))));
lean.push(`theorem{\n  name: viewsValidHolds,\n  parameters: [],\n  statement: ((${V}::viewsValid (bounds) (stakeholders) (decisions) (concerns) (viewpoints) (views) (viewClaims) (modelIndices) (decisionIndices) (stakeholderIndices)) = true),\n  proof: decide{}\n}`);
lean.push('\\end{semanticmodule}\n\\end{lexlean}\n');

// ---------------------------------------------------------------- Pages
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const md = (s) => String(s).replace(/([\\`*_[\]<>|])/g, '\\$1');
const github = (ref) => {
  const m = ref.match(/^([^@]+)@([0-9a-f]{40}):(.+)$/);
  return m ? `https://github.com/${m[1].includes('/') ? m[1] : `chaoss/${m[1]}`}/blob/${m[2]}/${m[3]}` : ref;
};
// A quoted table row reads as "Role: duty".
const showQuote = (q) => q.replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ': ');
const repoBlob = (path) => `https://github.com/UOR-Foundation/community/blob/main/${path}`;
const KIND = { person: 'Person', organization: 'Organization', softwareApplication: 'SoftwareApplication' };
const PATTERN = { decisionTable: 'DMN 1.5 decision table', policyDecision: 'XACML 3.0 policy', stateMachine: 'UML 2.5.1 state machine' };
const REASON = {
  'member-not-released': 'names a metric CHAOSS has not released',
  'role-maps-to-no-stakeholder': 'names a role no Foundation stakeholder holds',
  'model-states-no-user-story': 'states no user story, so no stakeholder is named',
  'stakeholder-has-no-concern': 'no model or decision yet addresses this stakeholder',
};
const digest = createHash('sha256').update(JSON.stringify(reg)).update(JSON.stringify(chaoss)).digest('hex');

function viewData(v) {
  const s = v.stakeholder;
  const src = sourceRef(s.source);
  const byModel = (n) => concerns.filter((c) => c.s === v.index && c.kind === 'measurementModel' && c.n === n);
  const byDecision = (n) => concerns.filter((c) => c.s === v.index && c.kind === 'decisionModel' && c.n === n);
  return {
    s,
    src,
    principal: v.principal === null ? null : stakeholders[v.principal],
    models: v.models.map((n) => ({ m: chaoss.models[n], stories: byModel(n).map((c) => c.text) })),
    decisions: v.decisions.map((n) => ({ d: reg.decisions[n], needs: byDecision(n).map((c) => c.text) })),
    claims: [
      ...v.registerClaims.map((i) => ({ about: chaoss.models[registerClaims[i].model].title, text: `${registerClaims[i].detail}: ${REASON[registerClaims[i].refusal] ?? registerClaims[i].refusal}` })),
      ...v.claims.map((i) => ({ about: claimSubject(claims[i]), text: claims[i].kind === 'stakeholder' ? REASON[claims[i].refusal] : `${claims[i].detail}: ${REASON[claims[i].refusal] ?? claims[i].refusal}` })),
    ],
  };
}
function claimSubject(c) {
  if (c.kind === 'measurementModel') return chaoss.models[c.n].title;
  if (c.kind === 'decisionModel') return reg.decisions[c.n].title;
  return stakeholders[c.n].name;
}

const head = (title, description) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="stylesheet" href="../brand/fonts.css">
<link rel="stylesheet" href="../brand/hologram-warm.css">
<link rel="stylesheet" href="views.css">
</head>
<body>
<main>
`;
const foot = `<footer><p>Generated by <a href="${repoBlob('views/catalog.mjs')}">views/catalog.mjs</a> from the model; checked by the Lean kernel as <code>viewsValidHolds</code>. Register digest <code>sha256:${digest}</code>.</p></footer>
</main>
</body>
</html>
`;

function page(v) {
  const x = viewData(v);
  const out = [head(`${x.s.name}: community model view`, `The ${x.s.name} view of the UOR Foundation community model: its metrics models, decisions and open claims.`)];
  out.push(`<nav><a href="./">All views</a></nav>\n<h1>${esc(x.s.name)}</h1>\n`);
  out.push(`<p class="who">Schema.org <code>${KIND[x.s.kind]}</code>${x.principal ? `, PROV-O <code>actedOnBehalfOf</code> <a href="${x.principal.slug}.html">${esc(x.principal.name)}</a>` : ''}. Named in <a href="${esc(github(x.src.ref))}">${esc(x.src.ref.replace(/@[0-9a-f]{40}/, (c) => c.slice(0, 8)))}</a>:</p>\n<blockquote>${esc(showQuote(x.s.quote))}</blockquote>\n`);
  out.push(`<h2>Metrics models <span class="n">${x.models.length}</span></h2>\n`);
  if (!x.models.length) out.push('<p class="none">No CHAOSS metrics model names this stakeholder.</p>\n');
  for (const { m, stories } of x.models) {
    out.push(`<section><h3><a href="${esc(github(m.source))}">${esc(m.title)}</a></h3>\n<p class="meta">${m.members.length} metrics, ${m.localMeasures.length} own measures, <code>${esc(m.workingGroup)}</code></p>\n<ul>${stories.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>\n`);
  }
  out.push(`<h2>Decisions <span class="n">${x.decisions.length}</span></h2>\n`);
  if (!x.decisions.length) out.push('<p class="none">No decision app names this stakeholder yet.</p>\n');
  for (const { d, needs } of x.decisions) {
    out.push(`<section><h3><a href="${esc(repoBlob(d.path))}">${esc(d.title)}</a></h3>\n<p class="meta">${PATTERN[d.pattern] ?? esc(d.pattern)}, <code>${esc(d.app)}</code></p>\n${needs.length ? `<ul>${needs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : `<p class="meta">Carried out on behalf of ${esc(x.principal.name)}.</p>`}</section>\n`);
  }
  out.push(`<h2>Open claims <span class="n">${x.claims.length}</span></h2>\n`);
  if (!x.claims.length) out.push('<p class="none">None.</p>\n');
  else out.push(`<ul>${x.claims.map((c) => `<li><b>${esc(c.about)}</b>: ${esc(c.text)}</li>`).join('')}</ul>\n`);
  out.push(foot);
  return out.join('');
}

function twin(v) {
  const x = viewData(v);
  const out = [`# ${md(x.s.name)}\n\nSchema.org ${KIND[x.s.kind]}${x.principal ? `, PROV-O actedOnBehalfOf ${md(x.principal.name)}` : ''}. Named in ${github(x.src.ref)}:\n\n> ${md(showQuote(x.s.quote))}\n`];
  out.push(`\n## Metrics models (${x.models.length})\n`);
  for (const { m, stories } of x.models) out.push(`\n### ${md(m.title)}\n\n${github(m.source)}\n\n${stories.map((t) => `- ${md(t)}`).join('\n')}\n`);
  out.push(`\n## Decisions (${x.decisions.length})\n`);
  for (const { d, needs } of x.decisions) out.push(`\n### ${md(d.title)}\n\n${PATTERN[d.pattern] ?? d.pattern}, ${repoBlob(d.path)}\n${needs.length ? `\n${needs.map((t) => `- ${md(t)}`).join('\n')}\n` : ''}`);
  out.push(`\n## Open claims (${x.claims.length})\n\n${x.claims.map((c) => `- ${md(c.about)}: ${md(c.text)}`).join('\n') || 'None.'}\n`);
  return out.join('');
}

function index() {
  const out = [head('Community model views', 'Every stakeholder view of the UOR Foundation community model: ISO/IEC/IEEE 42010 viewpoints generated from the Prism model.')];
  out.push('<nav><a href="../">App</a></nav>\n<h1>Community model views</h1>\n');
  out.push(`<p>One ISO/IEC/IEEE 42010 view per stakeholder the Foundation's governance names. Each holds the CHAOSS metrics models and decisions that address that stakeholder's concerns, and the claims still open about them.</p>\n<table>\n<thead><tr><th scope="col">Stakeholder</th><th scope="col">Models</th><th scope="col">Decisions</th><th scope="col">Open</th></tr></thead>\n<tbody>\n`);
  for (const v of views) out.push(`<tr><th scope="row"><a href="${v.stakeholder.slug}.html">${esc(v.stakeholder.name)}</a></th><td>${v.models.length}</td><td>${v.decisions.length}</td><td>${v.registerClaims.length + v.claims.length}</td></tr>\n`);
  out.push('</tbody>\n</table>\n');
  if (unviewed.length) out.push(`<h2>Open claims no view holds <span class="n">${unviewed.length}</span></h2>\n<ul>${unviewed.map((c) => `<li><b>${esc(claimSubject(c))}</b>: ${esc(c.detail)}: ${esc(REASON[c.refusal] ?? c.refusal)}</li>`).join('')}</ul>\n`);
  out.push(foot);
  return out.join('');
}

const llms = [`# Community model views\n\n> One ISO/IEC/IEEE 42010 view per UOR Foundation stakeholder, generated from the Prism model. Register sha256:${digest}.\n\n## Views\n\n`];
for (const v of views) llms.push(`- [${v.stakeholder.name}](${site}views/${v.stakeholder.slug}.md): ${v.models.length} metrics models, ${v.decisions.length} decisions, ${v.registerClaims.length + v.claims.length} open claims\n`);

const css = `/* Generated by views/catalog.mjs. Brand variables only; nothing under 14 px. */
body { margin: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans, system-ui, sans-serif); font-size: 16px; line-height: 1.55; }
main { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h1, h2, h3 { font-family: var(--font-display, inherit); line-height: 1.25; }
h1 { font-size: 1.75rem; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.25rem; margin: 2rem 0 0.5rem; border-top: 1px solid var(--border); padding-top: 1rem; }
h3 { font-size: 1rem; margin: 1rem 0 0.25rem; }
a { color: var(--foreground); text-underline-offset: 0.15em; }
a:hover { color: var(--brand); }
nav, .meta, .who, .none, footer { color: var(--muted-foreground); font-size: 14px; }
blockquote { margin: 0.5rem 0; padding: 0.5rem 1rem; border-left: 3px solid var(--brand); background: var(--card); }
code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 14px; overflow-wrap: anywhere; }
.n { color: var(--muted-foreground); font-weight: 400; }
ul { padding-left: 1.25rem; }
li { margin: 0.25rem 0; }
table { width: 100%; border-collapse: collapse; font-size: 15px; }
th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
td { text-align: right; font-variant-numeric: tabular-nums; }
footer { margin-top: 3rem; border-top: 1px solid var(--border); padding-top: 1rem; overflow-wrap: anywhere; }
`;

// ---------------------------------------------------------------- Discord
// Discord API v10 limits: 10 embeds and 6000 embed characters per message, a
// title of 256 and a description of 4096. allowed_mentions parses nothing, so
// the digest can never ping anyone.
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const embeds = views.map((v) => {
  const x = viewData(v);
  const lines = [
    `**${x.models.length}** metrics models, **${x.decisions.length}** decisions, **${x.claims.length}** open claims`,
    ...x.models.map(({ m }) => `• ${m.title.replace(/^Metrics Model:\s*/i, '')}`),
    ...x.decisions.map(({ d }) => `▸ ${d.title}`),
  ];
  return { title: clip(x.s.name, 256), url: `${site}views/${x.s.slug}.html`, description: clip(lines.join('\n'), 4096) };
});
const size = (e) => e.title.length + e.description.length;
const messages = [];
for (const e of embeds) {
  const last = messages[messages.length - 1];
  if (last && last.embeds.length < 10 && last.embeds.reduce((n, x) => n + size(x), 0) + size(e) <= 6000) last.embeds.push(e);
  else messages.push({ embeds: [e] });
}
messages.forEach((m, i) => {
  m.content = clip(`Community model views${messages.length > 1 ? ` (${i + 1}/${messages.length})` : ''}: ${site}views/ · register sha256:${digest.slice(0, 12)}`, 2000);
  m.allowed_mentions = { parse: [] };
});
for (const m of messages) {
  const total = m.embeds.reduce((n, e) => n + size(e), 0);
  if (m.content.length > 2000 || m.embeds.length > 10 || total > 6000 || m.embeds.some((e) => e.title.length > 256 || e.description.length > 4096)) {
    process.stderr.write('discord-digest-over-limit: a message exceeds the Discord API v10 limits\n');
    process.exit(1);
  }
}
const discord = { spec: 'uor-community/discord-digest/1', api: 'discord/v10/execute-webhook', digest: `sha256:${digest}`, messages: messages.map(({ content, embeds: e, allowed_mentions }) => ({ content, embeds: e, allowed_mentions })) };

// ---------------------------------------------------------------- write
const outputs = new Map([
  ['app/src/Viewpoints.lex.tex', lean.join('\n')],
  ['site/views/index.html', index()],
  ['site/views/views.css', css],
  ['site/views/llms.txt', llms.join('')],
  ['views/discord.json', `${JSON.stringify(discord, null, 1)}\n`],
  ...views.flatMap((v) => [
    [`site/views/${v.stakeholder.slug}.html`, page(v)],
    [`site/views/${v.stakeholder.slug}.md`, twin(v)],
  ]),
]);
const stale = [];
if (process.argv[2] === '--check') {
  for (const [path, text] of outputs) if (!existsSync(join(repo, path)) || readFileSync(join(repo, path), 'utf8') !== text) stale.push(path);
  const dir = join(repo, 'site/views');
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (!outputs.has(`site/views/${f}`)) stale.push(`site/views/${f} (not generated)`);
  if (stale.length) {
    process.stderr.write(`not the catalog of views/register.json:\n  ${stale.join('\n  ')}\n`);
    process.exit(1);
  }
} else {
  mkdirSync(join(repo, 'site/views'), { recursive: true });
  for (const [path, text] of outputs) writeFileSync(join(repo, path), text);
}
process.stdout.write(`${views.length} views, ${concerns.length} concerns, ${claims.length + chaoss.refusals.length} open claims, ${messages.length} Discord message(s)\n`);
