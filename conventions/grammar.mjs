/**
 * The three conventions, implemented from their own texts and nothing else.
 * Every pattern either is read from the pinned specification at run time (the
 * SemVer regular expression, the Conventional Commits specification items, the
 * Keep a Changelog change types) or transcribes one sentence of it, cited
 * beside it. conventions/scan.mjs runs the published oracles beside these and
 * conventions/project.mjs refuses to project when the two disagree.
 */

// ---- Semantic Versioning 2.0.0 (semver.org spec/v2.0.0.md).

/** The FAQ's regular expression in the flavour the FAQ says is ECMAScript compatible, read from the spec text. */
export function semverRegex(text, heading, flavour) {
  const at = text.indexOf(heading);
  if (at < 0) throw new Error(`the SemVer text has no "${heading}"`);
  const faq = text.slice(at).split('\n### ')[0];
  const said = faq.search(new RegExp(flavour.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')));
  if (said < 0) throw new Error(`the SemVer FAQ no longer names a regular expression ${flavour}`);
  // The fenced block that follows the sentence naming the flavour.
  const block = faq.slice(said).match(/```\n([^\n]+)\n```/);
  if (!block) throw new Error('the SemVer FAQ names the flavour but no expression follows');
  return { source: block[1], regex: new RegExp(block[1]) };
}

/** The FAQ answer on a leading "v", which the tag classification cites. */
export function vPrefixAnswer(text, heading) {
  const at = text.indexOf(heading);
  if (at < 0) throw new Error(`the SemVer text has no "${heading}"`);
  const body = text.slice(at + heading.length).split('\n### ')[0].replace(/\s+/g, ' ').trim();
  if (!/is not a semantic version/.test(body) || !/prefixing a semantic version with a "v"/.test(body)) throw new Error('the SemVer FAQ on "v1.2.3" no longer says what the classification cites');
  return body;
}

const ident = (s) => (/^\d+$/.test(s) ? { n: BigInt(s) } : { s });
/** Item 11: precedence. Negative, zero or positive; build metadata does not figure. */
export function compareSemver(re, a, b) {
  const x = a.match(re);
  const y = b.match(re);
  if (!x || !y) throw new Error(`compareSemver: ${!x ? a : b} is not a version`);
  for (let i = 1; i <= 3; i++) {
    const d = BigInt(x[i]) - BigInt(y[i]);
    if (d !== 0n) return d < 0n ? -1 : 1;
  }
  // 11.3: a pre-release version has lower precedence than the normal version.
  if (!x[4] || !y[4]) return x[4] === y[4] ? 0 : x[4] ? -1 : 1;
  const p = x[4].split('.').map(ident);
  const q = y[4].split('.').map(ident);
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    const u = p[i];
    const v = q[i];
    // 11.4.1 numerically; 11.4.2 lexically in ASCII sort order; 11.4.3 numeric is lower than alphanumeric.
    if ('n' in u && 'n' in v) { if (u.n !== v.n) return u.n < v.n ? -1 : 1; } else if ('n' in u) return -1;
    else if ('n' in v) return 1;
    else if (u.s !== v.s) return u.s < v.s ? -1 : 1;
  }
  // 11.4.4: a larger set of pre-release fields has a higher precedence, if all the preceding are equal.
  return Math.sign(p.length - q.length);
}

/**
 * A git tag names a version in one of three ways, or not at all:
 *   semver           the tag is a SemVer string;
 *   v-semver         "v" then a SemVer string, the prefix the FAQ calls a common way to indicate a version;
 *   prefixed-semver  "<component>-" then, optionally "v", then a SemVer string (one series per component);
 *   invalid          the tag begins as a version does (a digit, optionally after "v") and is not one;
 *   not-a-version    anything else.
 */
export function classifyTag(re, tag) {
  if (re.test(tag)) return { verdict: 'semver', series: '', version: tag };
  if (tag.startsWith('v') && re.test(tag.slice(1))) return { verdict: 'v-semver', series: '', version: tag.slice(1) };
  for (let i = tag.indexOf('-'); i > 0; i = tag.indexOf('-', i + 1)) {
    const rest = tag.slice(i + 1);
    const v = rest.startsWith('v') ? rest.slice(1) : rest;
    if (re.test(v)) return { verdict: 'prefixed-semver', series: tag.slice(0, i), version: v };
  }
  if (/^v?\d/.test(tag)) return { verdict: 'invalid', series: '', version: '' };
  return { verdict: 'not-a-version', series: '', version: '' };
}

// ---- Conventional Commits 1.0.0 (conventionalcommits.org content/v1.0.0/index.md).

/** The numbered items of "## Specification", each joined onto one line. */
export function ccItems(text) {
  const at = text.indexOf('\n## Specification\n');
  if (at < 0) throw new Error('the Conventional Commits text has no Specification section');
  const section = text.slice(at).split('\n## ')[1];
  const items = [];
  for (const line of section.split('\n')) {
    if (/^1\. /.test(line)) items.push(line.slice(3).trim());
    else if (items.length && line.trim() && !/^#/.test(line)) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

// Items 1, 4, 5 and 13: <type>[(<scope>)][!]: <description>. A type is a noun (a word); a scope is a noun in
// parenthesis; "!" stands immediately before ":"; the description immediately follows ": ", so it is not empty
// and does not begin with a space.
export const CC_HEADER = /^(\w+)(?:\(([^()\r\n]+)\))?(!)?: (\S.*)$/;

/**
 * The checks the specification's text makes decidable on a commit message:
 *   header             items 1, 4, 5, 13 on the first line;
 *   body-blank-line    item 6, the body begins one blank line after the description;
 *   breaking-footer    items 12 and 15 with 16: a BREAKING CHANGE (or BREAKING-CHANGE) footer is uppercase and is
 *                      followed by a colon, a space and a description.
 * Items 2, 3, 11 and 14 say what a commit means or how an implementor reads it, and items 7 to 10 permit a
 * free-form body and optional footers, so no message can break them by its form.
 */
export function ccMessage(message) {
  const lines = message.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const header = lines[0];
  const m = header.match(CC_HEADER);
  const violations = [];
  if (!m) violations.push('header');
  if (lines.length > 1 && lines[1] !== '') violations.push('body-blank-line');
  const tail = lines.slice(1);
  const afterBlank = tail.filter((_, i) => i > 0 && tail[i - 1] === '');
  if (afterBlank.some((l) => /^breaking[ -]change\s*:/i.test(l) && !/^BREAKING[ -]CHANGE: \S/.test(l))) violations.push('breaking-footer');
  return {
    header,
    type: m ? m[1] : '',
    scope: m ? m[2] ?? '' : '',
    breaking: Boolean(m && m[3]) || afterBlank.some((l) => /^BREAKING[ -]CHANGE: \S/.test(l)),
    description: m ? m[4] : '',
    violations,
  };
}

// ---- Keep a Changelog 1.1.0 (keep-a-changelog source/en/1.1.0/index.html.haml, and its example CHANGELOG.md).

/** The six types of changes, read from the page's "Types of changes" list. */
export function kacTypes(page) {
  const at = page.indexOf('Types of changes');
  if (at < 0) throw new Error('the Keep a Changelog page has no "Types of changes"');
  const list = page.slice(at).split(/\n\s*\.effort|\n\s*%h3/)[0];
  const types = [...list.matchAll(/%code (\w+)/g)].map((m) => m[1]);
  if (types.length !== 6) throw new Error(`the Keep a Changelog page lists ${types.length} types of changes`);
  return types;
}

/** The guiding principles, read from the page. */
export function kacPrinciples(page) {
  const at = page.indexOf('Guiding Principles');
  const list = page.slice(at).split(/%h4/)[0];
  return [...list.matchAll(/%li\s*\n\s*([^\n]+)/g)].map((m) => m[1].replace(/<\/?em>/g, '').replace(/#\{link_to "([^"]+)"[^}]*\}/g, '$1').trim());
}

const calendar = (d) => {
  const [y, mo, da] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, da));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === da;
};

/**
 * Parse a changelog as the page and its example write one: "## [Unreleased]" at the top, a heading
 * "## [<version>] - <YYYY-MM-DD>" (with " [YANKED]" for a yanked release) for each version, latest first, the
 * changes grouped under "### <type>" by the six types, every version linkable, and Semantic Versioning mentioned.
 * Returns the releases read and every check with whether it holds.
 */
export function kacParse(re, types, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const h2 = [];
  const h3 = [];
  const refs = new Set();
  let fence = false;
  for (const [i, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if (/^## /.test(line)) h2.push({ line: i + 1, text: line.slice(3).trim() });
    else if (/^### /.test(line)) h3.push({ line: i + 1, text: line.slice(4).trim(), under: h2.length - 1 });
    const ref = line.match(/^ {0,3}\[([^\]]+)\]:\s*\S/);
    if (ref) refs.add(ref[1].trim().toLowerCase());
  }
  const releases = [];
  const malformed = [];
  let unreleased = -1;
  for (const [k, h] of h2.entries()) {
    if (/^\[?unreleased\]?$/i.test(h.text)) { if (unreleased < 0) unreleased = k; continue; }
    const m = h.text.match(/^\[([^\]]+)\] - (\d{4}-\d{2}-\d{2})( \[YANKED\])?$/) ?? h.text.match(/^([^\s[\]]+) - (\d{4}-\d{2}-\d{2})( \[YANKED\])?$/);
    if (!m) { malformed.push(`line ${h.line}: "## ${h.text}"`); continue; }
    releases.push({ version: m[1], date: m[2], yanked: Boolean(m[3]), bracketed: h.text.startsWith('['), line: h.line });
  }
  const badDates = releases.filter((r) => !calendar(r.date)).map((r) => `${r.version} ${r.date}`);
  const nonSemver = releases.filter((r) => !re.test(r.version)).map((r) => r.version);
  const order = [];
  for (let i = 1; i < releases.length; i++) {
    const [a, b] = [releases[i - 1], releases[i]];
    if (a.date < b.date) order.push(`${a.version} (${a.date}) before ${b.version} (${b.date})`);
    else if (re.test(a.version) && re.test(b.version) && compareSemver(re, a.version, b.version) <= 0) order.push(`${a.version} before ${b.version}`);
  }
  const badTypes = h3.filter((h) => !types.includes(h.text)).map((h) => `line ${h.line}: "### ${h.text}"`);
  const unlinked = [...(unreleased >= 0 && /^\[/.test(h2[unreleased].text) ? ['Unreleased'] : []), ...releases.filter((r) => r.bracketed).map((r) => r.version)].filter((v) => !refs.has(v.toLowerCase()));
  const unbracketed = releases.filter((r) => !r.bracketed).map((r) => r.version);
  const checks = [
    ['unreleased-first', unreleased === 0, unreleased < 0 ? 'no Unreleased section' : unreleased > 0 ? `Unreleased is section ${unreleased + 1}` : ''],
    ['version-headings', malformed.length === 0, malformed.join('; ')],
    ['iso-8601-dates', badDates.length === 0, badDates.join('; ')],
    ['semver-versions', nonSemver.length === 0, nonSemver.join('; ')],
    ['latest-first', order.length === 0, order.join('; ')],
    ['change-types', badTypes.length === 0, badTypes.join('; ')],
    ['linkable', unlinked.length === 0 && unbracketed.length === 0, [...unbracketed.map((v) => `${v} is not a link label`), ...unlinked.map((v) => `[${v}] has no link reference`)].join('; ')],
    ['semver-mentioned', /Semantic Versioning|semver\.org/.test(text), ''],
    ['has-releases', releases.length > 0, releases.length ? '' : 'no version section'],
  ];
  return { releases, unreleased: unreleased >= 0, h3: h3.length, checks: checks.map(([check, holds, detail]) => ({ check, holds, detail })) };
}
