/**
 * Write a projected register as LexLean: a type module (one structure per
 * record kind, one inductive per enumeration, and the validity functions) and
 * a catalog module (one definition per record, one list per kind, and the
 * theorem that the register is valid, proved by decide).
 *
 * A register is declared once, as data: its kinds, their fields and the
 * references between them. Every reference field is checked to name a record
 * of its kind, every record is checked to be numbered in order, and every
 * count is checked against the release; a register adds only its own domain
 * checks. A projector that uses this writes no LexLean by hand, and the same
 * declaration and records always write the same bytes.
 *
 * Field types: 'String', 'Nat', 'Bool', { ref: '<Kind>' }, { enum: '<Enum>' }.
 */

export const str = (s) => JSON.stringify(String(s)).replace(/\\u[0-9a-f]{4}/gi, (u) => u);
export const camel = (s) => {
  const w = String(s).split(/[^A-Za-z0-9]+/).filter(Boolean);
  return w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x[0].toLowerCase() + x.slice(1))).join('');
};
export const pascal = (s) => { const c = camel(s); return c[0].toUpperCase() + c.slice(1); };
// The layout `lexlean fmt` writes: a bracketed list or a match stays on one line when that line fits in WIDTH
// columns, and otherwise puts one item or branch on each line. Writing that layout here keeps generated modules
// canonical, so `lexlean fmt --check` passes on them unchanged.
const WIDTH = 100;
const bracket = (lead, items, tail = '') => {
  const one = `${lead}[${items.join(', ')}]${tail}`;
  return items.length === 0 || one.length <= WIDTH ? one : `${lead}[\n${items.map((i) => `    ${i}`).join(',\n')}\n  ]${tail}`;
};
/** A match body: `match(scrutinee, [[pattern, result], ...])`. */
export const match = (scrutinee, branches) => ({ scrutinee, branches });
const bodyLine = (body, tail) => {
  if (typeof body === 'string') return `  body: ${body}${tail}`;
  const arms = body.branches.map(([p, r]) => `| ${p} => ${r}`);
  const one = `  body: (match ${body.scrutinee} ${arms.join(' ')})${tail}`;
  return one.length <= WIDTH ? one : `  body: (match ${body.scrutinee}\n${arms.map((a) => `    ${a}`).join('\n')})${tail}`;
};
/** One LexLean definition, laid out as `lexlean fmt` writes it. `params` is a list of `name : Type`. */
export const def = (name, params, type, body, rec) =>
  `definition{\n  name: ${name},\n${bracket('  parameters: ', params, ',')}\n  result: ${type},\n${bodyLine(body, rec ? ',' : '')}${rec ? `\n  recursive_argument: ${rec}` : ''}\n}\n`;
const and = (xs) => xs.reduceRight((rest, x) => (rest === null ? x : `(${x} && ${rest})`), null) ?? 'true';
const CHUNK = 48;
const countOf = (kind) => `${camel(kind.list)}Count`;

/** The type module: enumerations, structures, the Release, and registerValid. */
export function typesModule(decl) {
  const { module, title, enums = {}, kinds, release = [], definitions = [], checks = [], imports = [] } = decl;
  const byName = new Map(kinds.map((k) => [k.name, k]));
  const out = [`\\begin{lexlean}{${module}}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\useglossary{prism.arch@1.0.0}\n${imports.map((m) => `\\importmodule{${m}}\n`).join('')}\\title{${title}}\n\\begin{semanticmodule}`];
  for (const [name, values] of Object.entries(enums)) {
    out.push(`inductive{\n  name: ${name},\n  type_parameters: [],\n  parameters: [],\n${bracket('  constructors: ', values.map((v) => `{name: ${camel(v)}, fields: []}`))}\n}\n`);
  }
  const typeOf = (t) => (typeof t === 'string' ? t : t.ref ? 'Nat' : t.enum);
  const struct = (name, fields) => `structure{\n  name: ${name},\n  type_parameters: [],\n  parameters: [],\n${bracket('  fields: ', fields.map(([n, t]) => `{name: ${n}, type: ${typeOf(t)}}`))}\n}\n`;
  out.push(struct('Release', [...kinds.map((k) => [countOf(k), 'Nat']), ...release]));
  for (const k of kinds) out.push(struct(k.name, [['index', 'Nat'], ...k.fields]));
  // The register's own definitions come before the kind validators, so a kind's checks may call them.
  out.push(...definitions);
  for (const k of kinds) {
    const refs = [...new Set(k.fields.filter(([, t]) => t.ref).map(([, t]) => t.ref))];
    for (const r of refs) if (!byName.has(r)) throw new Error(`${k.name} refers to the undeclared kind ${r}`);
    const bounds = refs.map((r) => `${countOf(byName.get(r))} : Nat`);
    const v = camel(k.name);
    const per = [
      `((project ${v} index) =? position)`,
      ...k.fields.filter(([, t]) => t.ref).map(([n, t]) => `((project ${v} ${n}) <? ${countOf(byName.get(t.ref))})`),
      ...(k.checks ?? []).map((c) => c.replaceAll('$', v)),
    ];
    const recur = `(${camel(k.list)}Valid (position + 1)${refs.map((r) => ` ${countOf(byName.get(r))}`).join('')} rest)`;
    out.push(def(`${camel(k.list)}Valid`, ['position : Nat', ...bounds, `values : (List ${k.name})`], 'Bool',
      match('values', [['List.nil', 'true'], [`List.cons ${v} rest`, and([...per, recur])]]), 'values'));
    out.push(def(`${camel(k.list)}Total`, [`values : (List ${k.name})`], 'Nat', match('values', [['List.nil', '0'], [`List.cons ${v} rest`, `(1 + (${camel(k.list)}Total rest))`]]), 'values'));
  }
  const params = ['release : Release', ...kinds.map((k) => `${camel(k.list)} : (List ${k.name})`)];
  const whole = and([
    ...kinds.map((k) => `((${camel(k.list)}Total ${camel(k.list)}) =? (project release ${countOf(k)}))`),
    ...kinds.map((k) => {
      const refs = [...new Set(k.fields.filter(([, t]) => t.ref).map(([, t]) => t.ref))];
      return `(${camel(k.list)}Valid 0${refs.map((r) => ` (${camel(byName.get(r).list)}Total ${camel(byName.get(r).list)})`).join('')} ${camel(k.list)})`;
    }),
    ...checks,
  ]);
  out.push(def('registerValid', params, 'Bool', whole).replace(/\n$/, ''));
  out.push('\\end{semanticmodule}\n\\end{lexlean}\n');
  return out.join('\n');
}

/** The catalog module: every record of the register, and the theorem that it is valid. */
export function catalogModule(decl, records, releaseValues = {}) {
  const { module, catalog, catalogTitle, kinds, enums = {} } = decl;
  const M = module;
  const value = (t, x, where) => {
    if (t === 'String') return str(x);
    if (t === 'Nat') { if (!Number.isInteger(x) || x < 0) throw new Error(`${where} is not a Nat: ${x}`); return String(x); }
    if (t === 'Bool') return x ? 'true' : 'false';
    if (t.ref) { if (!Number.isInteger(x)) throw new Error(`${where} is not a reference: ${x}`); return String(x); }
    if (t.enum) { if (!enums[t.enum].includes(x)) throw new Error(`${where}: ${x} is not a ${t.enum}`); return `(ctor ${M}::${t.enum}.${camel(x)})`; }
    throw new Error(`unknown field type at ${where}`);
  };
  const rec = (type, pairs) => `(record ${M}::${type} {${pairs.map(([n, v]) => `${n} := ${v}`).join(', ')}})`;
  const out = [`\\begin{lexlean}{${catalog}}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\useglossary{prism.arch@1.0.0}\n\\importmodule{${M}}\n\\title{${catalogTitle}}\n\\begin{semanticmodule}`];
  out.push(def('release', [], `${M}::Release`, rec('Release', [
    ...kinds.map((k) => [countOf(k), String(records[k.list].length)]),
    ...(decl.release ?? []).map(([n, t]) => [n, value(t, releaseValues[n], `release.${n}`)]),
  ])));
  for (const k of kinds) {
    const names = records[k.list].map((r, i) => {
      const name = `${camel(k.name)}${i}`;
      out.push(def(name, [], `${M}::${k.name}`, rec(k.name, [['index', String(i)], ...k.fields.map(([n, t]) => [n, value(t, r[n], `${k.list}[${i}].${n}`)])])));
      return name;
    });
    // A list is written in runs of CHUNK records, each ending in the next run's definition, because LexLean
    // reads a module through a JSON parser whose nesting limit a long cons chain would exceed.
    const run = (start) => `${camel(k.list)}From${start}`;
    for (let start = Math.floor(Math.max(names.length - 1, 0) / CHUNK) * CHUNK; start >= 0; start -= CHUNK) {
      const tail = start + CHUNK < names.length ? `(${run(start + CHUNK)})` : `(nil ${M}::${k.name})`;
      out.push(def(run(start), [], `(List ${M}::${k.name})`, names.slice(start, start + CHUNK).reduceRight((rest, n) => `(cons (${n}) ${rest})`, tail)));
    }
    out.push(def(camel(k.list), [], `(List ${M}::${k.name})`, `(${run(0)})`));
  }
  out.push(`theorem{\n  name: registerValidHolds,\n  parameters: [],\n  statement: ((${M}::registerValid (release)${kinds.map((k) => ` (${camel(k.list)})`).join('')}) = true),\n  proof: decide{}\n}`);
  out.push('\\end{semanticmodule}\n\\end{lexlean}\n');
  return out.join('\n');
}
