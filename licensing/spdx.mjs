/**
 * The two SPDX procedures the licensing register needs, written to their
 * specifications and nothing more:
 *
 *   parseExpression  SPDX Specification 2.3.1 Annex D, license expressions;
 *   identify         SPDX Specification 2.3.1 Annex B, the License List
 *                    Matching Guidelines, applied to the legacy text
 *                    templates of the pinned license-list-data (B.15.3).
 *
 * A text is identified only when exactly one non-deprecated listed license's
 * template matches all of it; anything else is returned unidentified with
 * the candidates that came closest, never guessed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Annex D: tokens, then compound := simple | simple WITH exception | compound AND/OR compound | ( compound ). */
export function parseExpression(text) {
  const tokens = String(text).match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const fail = (why) => { throw new Error(`"${text}" is not an SPDX license expression: ${why}`); };
  const simple = () => {
    const t = tokens[at++];
    if (t === undefined) fail('it ends early');
    if (t === '(') {
      const inner = or();
      if (tokens[at++] !== ')') fail('a parenthesis is not closed');
      return inner;
    }
    if (['AND', 'OR', 'WITH', ')'].includes(t)) fail(`${t} where an identifier belongs`);
    const ref = /^(DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+$/.test(t);
    if (!ref && !/^[A-Za-z0-9.-]+\+?$/.test(t)) fail(`${t} is not an idstring`);
    let node = ref ? { ref: t } : { id: t.replace(/\+$/, ''), orLater: t.endsWith('+') };
    if (peek() === 'WITH') {
      at++;
      const e = tokens[at++];
      if (!e || !/^[A-Za-z0-9.-]+$/.test(e)) fail('WITH names no exception');
      node = { ...node, exception: e };
    }
    return node;
  };
  const and = () => { let l = simple(); while (peek() === 'AND') { at++; l = { and: [l, simple()] }; } return l; };
  const or = () => { let l = and(); while (peek() === 'OR') { at++; l = { or: [l, and()] }; } return l; };
  const tree = or();
  if (at !== tokens.length) fail(`${tokens[at]} follows a complete expression`);
  return tree;
}

/** Every license identifier, LicenseRef and exception an expression names, in order. */
export function leaves(tree, out = []) {
  if (tree.and || tree.or) for (const t of tree.and ?? tree.or) leaves(t, out);
  else out.push(tree);
  return out;
}

const DASHES = /[\u2010-\u2015\u2212\u2e3a\u2e3b\ufe58\ufe63\uff0d]/g;
const QUOTES = /["'`\u00b4\u2018-\u201f\u2032-\u2037\u00ab\u00bb]+/g;

/** The pinned list's templates, texts and equivalent words, read once. */
export function loadList(dir, paths) {
  const licenses = JSON.parse(readFileSync(join(dir, paths.licenses), 'utf8')).licenses;
  const equivalents = readFileSync(join(dir, paths.equivalentWords), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(',').map((w) => w.trim().toLowerCase()));
  const templates = new Set(readdirSync(join(dir, paths.templates)));
  return { dir, paths, licenses, equivalents, templates };
}

function normalizer(list) {
  // B.9: each line of equivalentwords.txt is one word; every variant is written as its line's first word.
  const swaps = list.equivalents.flatMap(([first, ...rest]) => rest.map((w) => [new RegExp(/^\w+$/.test(w) ? `\\b${w}\\b` : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ` ${first} `]));
  return (s) => {
    let t = s.toLowerCase(); // B.5
    t = t.replace(DASHES, '-').replace(QUOTES, "'"); // B.6.3, B.6.4
    t = t.replace(/\u00a9/g, '(c)'); // B.10
    t = t.replace(/https:\/\//g, 'http://'); // B.14
    for (const [re, to] of swaps) t = t.replace(re, to);
    return t.replace(/\s+/g, ' ').trim(); // B.4
  };
}

// B.7: a comment indicator every non-blank line carries is not license text.
function uncomment(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const p of ['//', '#', ';', '--', '*']) {
    const body = lines.filter((l) => l.trim());
    if (body.length && body.every((l) => l.trimStart().startsWith(p))) return lines.map((l) => l.trimStart().startsWith(p) ? l.trimStart().slice(p.length) : l).join('\n');
  }
  return lines.join('\n');
}

// B.11: the copyright notices above the license text are not part of it.
const NOTICE = /^\s*(copyright\b|\(c\)|\u00a9|all rights reserved)/i;
// A reported notice is one in the form REUSE 3.3 "Format of Copyright Notices" gives: a prefix, a year, a holder.
// A line of license prose that merely begins with the word ("copyright license to reproduce...") is not one.
const DATED = /^\s*(?:copyright\s*(?:\(c\)|\u00a9)?|\u00a9|\(c\))\s*\d{4}\b.*\S/i;
function withoutNotices(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || NOTICE.test(lines[i]))) i++;
  // Notices are reported wherever a line starts with one (MIT puts its notice under the title); only the leading
  // ones are removed, since a template places any later one in a variable of its own.
  return { notices: lines.filter((l) => DATED.test(l)).map((l) => l.trim()), body: lines.slice(i).join('\n') };
}

// B.15.3: <<beginOptional>> ... <<endOptional>> is omittable (B.3.5, B.12, B.13), <<var;...;match="ERE">> replaceable
// (B.3.4, B.8, B.11). The template is compiled to a program of literal, variable and optional steps and run against
// the text with all whitespace removed: B.4 makes a space between two tokens present or absent, never more, so with
// it removed each literal is one exact string. A failed (step, position) is remembered, so a template with many
// optionals and wide variables is matched in polynomial time, never by blind backtracking.
const squeeze = (s) => s.replace(/\s+/g, '');
function compile(template, norm) {
  const program = [];
  const opens = [];
  let rest = template;
  const lit = (s) => { const t = squeeze(norm(s)); if (t) program.push({ op: 'lit', s: t }); };
  while (rest.length) {
    let at = rest.indexOf('<<');
    if (at < 0) { lit(rest); break; }
    // A literal '<' just before a marker ("<<<var;...") belongs to the text, as in GPL-3.0's "<https://...>".
    while (rest[at + 2] === '<') at++;
    lit(rest.slice(0, at));
    rest = rest.slice(at);
    if (rest.startsWith('<<beginOptional>>')) { opens.push(program.length); program.push({ op: 'opt', end: -1 }); rest = rest.slice(17); }
    else if (rest.startsWith('<<endOptional>>')) {
      if (!opens.length) throw new Error('a template optional is closed twice');
      program[opens.pop()].end = program.length;
      rest = rest.slice(15);
    } else if (rest.startsWith('<<var;')) {
      const m = rest.indexOf(';match="');
      const end = rest.indexOf('">>', m);
      if (m < 0 || end < 0) throw new Error('a template variable has no match');
      // The variable's ERE is applied to squeezed text, so its own whitespace may match nothing.
      const ere = rest.slice(m + 8, end).replace(/\\s\+/g, '\\s*').replace(/ [?*+]/g, '').replace(/ /g, '');
      program.push({ op: 'var', re: new RegExp(`^(?:${ere})$`, 'is') });
      rest = rest.slice(end + 3);
    } else { lit('<<'); rest = rest.slice(2); }
  }
  if (opens.length) throw new Error('a template optional is not closed');
  return program;
}
// The widest variable the pinned templates declare is .{0,5000}; none reaches further.
const VAR_REACH = 5000;
function run(program, text) {
  const failed = new Set();
  const n = text.length + 1;
  const step = (pc, pos) => {
    if (pc === program.length) return pos === text.length;
    const key = pc * n + pos;
    if (failed.has(key)) return false;
    const ins = program[pc];
    let ok = false;
    if (ins.op === 'lit') ok = text.startsWith(ins.s, pos) && step(pc + 1, pos + ins.s.length);
    else if (ins.op === 'opt') ok = step(pc + 1, pos) || step(ins.end, pos);
    else {
      const next = program[pc + 1];
      const limit = Math.min(text.length, pos + VAR_REACH);
      for (let end = pos; end <= limit && !ok; end++) {
        if (next && next.op === 'lit') { end = text.indexOf(next.s, end); if (end < 0 || end > limit) break; }
        ok = ins.re.test(text.slice(pos, end)) && step(pc + 1, end);
      }
    }
    if (!ok) failed.add(key);
    return ok;
  };
  return step(0, 0);
}

/** Identify one license text against the pinned list. */
export function identify(list, rawText) {
  const norm = list.norm ?? (list.norm = normalizer(list));
  const { notices, body } = withoutNotices(uncomment(rawText));
  const text = norm(body);
  const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
  // Only templates whose reference text shares most of its words with this one are run in full.
  const close = list.licenses.filter((l) => !l.isDeprecatedLicenseId && list.templates.has(`${l.licenseId}.template.txt`)).map((l) => {
    const ref = list.words?.get(l.licenseId) ?? (() => {
      const w = new Set(norm(readFileSync(join(list.dir, list.paths.texts, `${l.licenseId}.txt`), 'utf8')).split(/[^a-z0-9]+/).filter(Boolean));
      (list.words ??= new Map()).set(l.licenseId, w);
      return w;
    })();
    let both = 0;
    for (const w of ref) if (words.has(w)) both++;
    return { id: l.licenseId, dice: (2 * both) / (ref.size + words.size || 1) };
  }).filter((c) => c.dice >= 0.5).sort((a, b) => b.dice - a.dice || (a.id < b.id ? -1 : 1)).slice(0, 8);
  const matched = close.filter((c) => {
    const program = (list.programs ??= new Map()).get(c.id) ?? (() => {
      const p = compile(readFileSync(join(list.dir, list.paths.templates, `${c.id}.template.txt`), 'utf8'), norm);
      list.programs.set(c.id, p);
      return p;
    })();
    return run(program, squeeze(text));
  }).map((c) => c.id).sort();
  return { id: matched.length === 1 ? matched[0] : '', matched, candidates: close.slice(0, 3).map((c) => c.id), notices };
}
