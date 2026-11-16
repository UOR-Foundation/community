#!/usr/bin/env node
/**
 * Observe every repository licensing/snapshot.json pins with the oracle, and
 * write what was observed to licensing/scan.json:
 *
 *   - the FSFE REUSE tool at the version sources.json pins: `reuse lint --json`
 *     for its counts and non-compliant lists, `reuse lint --lines` for the
 *     files with invalid SPDX License Expressions (which the tool counts
 *     against compliance but its JSON does not list);
 *   - every tracked Cargo.toml, package.json and pyproject.toml, and the
 *     license each declares in the field its format defines;
 *   - every LICENSE, LICENCE or COPYING file at the root (REUSE 3.3 "Covered
 *     and ignored Files"), identified against the pinned SPDX License List by
 *     the SPDX matching guidelines (licensing/spdx.mjs).
 *
 * Each repository is fetched at its pinned commit into <sources-dir>/<name>,
 * a checkout already there is used only when it is at that commit and clean,
 * and with --prune each is removed once observed, so the whole Foundation is
 * observed in the disk one repository needs. The same commits, tool and list
 * always write the same bytes.
 *
 *   REUSE=<path to reuse> node licensing/scan.mjs <sources-dir> [--prune] [--check]
 *
 * <sources-dir> also holds `spdx-license-list` at the commit sources.json pins.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadList, identify } from './spdx.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const snapshot = JSON.parse(readFileSync(join(here, 'snapshot.json'), 'utf8'));
const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--'));
if (!root) {
  process.stderr.write('usage: scan.mjs <sources-dir> [--prune] [--check]\n');
  process.exit(64);
}
const reuse = process.env.REUSE || 'reuse';
const git = (dir, a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const version = spawnSync(reuse, ['--version'], { encoding: 'utf8' });
if (version.error) throw version.error;
const firstLine = version.stdout.split('\n')[0];
if (firstLine !== `reuse, version ${sources.reuse.version}`) throw new Error(`${reuse} is "${firstLine}", not reuse ${sources.reuse.version}`);

const spdxDir = join(root, sources.spdx.name);
if (git(spdxDir, ['rev-parse', 'HEAD']).trim() !== sources.spdx.commit) throw new Error(`${spdxDir} is not at ${sources.spdx.commit}`);
const list = loadList(spdxDir, sources.spdx);

function checkout({ name, url, commit }) {
  const dir = join(root, name);
  const at = () => git(dir, ['rev-parse', 'HEAD']).trim();
  if (!(existsSync(join(dir, '.git')) && at() === commit && git(dir, ['status', '--porcelain', '--ignored']).trim() === '')) {
    rmSync(dir, { recursive: true, force: true });
    execFileSync('git', ['init', '-q', dir]);
    git(dir, ['fetch', '-q', '--depth', '1', url, commit]);
    git(dir, ['checkout', '-q', '--detach', 'FETCH_HEAD']);
  }
  if (at() !== commit) throw new Error(`${name} is at ${at()}, not the pinned ${commit}`);
  return dir;
}

function lint(dir, format) {
  // The tool exits 1 for a non-compliant project; only a missing or garbled report is a failure.
  const r = spawnSync(reuse, ['lint', format], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, LANGUAGE: 'en', LC_ALL: 'C.UTF-8' } });
  if (r.error) throw r.error;
  if (r.status !== 0 && r.status !== 1) throw new Error(`reuse lint ${format} in ${dir} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

// The license field of each manifest format: Cargo (doc.rust-lang.org/cargo/reference/manifest.html, `license`,
// `license-file`, inherited with `license.workspace = true`), npm (docs.npmjs.com package.json `license`), and
// pyproject.toml (PEP 621 `project.license`, a string by PEP 639 or a table; Poetry `tool.poetry.license`).
function tomlFields(text) {
  const out = [];
  let table = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const head = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (head) { table = head[1].replace(/\s+/g, ''); continue; }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (kv) out.push({ table, key: kv[1], value: kv[2] });
  }
  return out;
}
const tomlString = (v) => { const m = v.match(/^(["'])(.*)\1$/); return m ? m[2] : null; };
const tomlTable = (v, key) => { const m = v.match(new RegExp(`\\b${key}\\s*=\\s*(["'])(.*?)\\1`)); return m ? m[2] : null; };

function manifest(dir, path) {
  const text = readFileSync(join(dir, path), 'utf8');
  const name = basename(path);
  if (name === 'package.json') {
    let j;
    try { j = JSON.parse(text); } catch { return { path, kind: 'npm', package: '', license: '', licenseFile: '', inherits: false, unreadable: true }; }
    const lic = typeof j.license === 'string' ? j.license : j.license?.type ?? (Array.isArray(j.licenses) ? j.licenses.map((l) => l.type ?? l).join(' OR ') : '');
    return { path, kind: 'npm', package: typeof j.name === 'string' ? j.name : '', license: lic ?? '', licenseFile: '', inherits: false, unreadable: false };
  }
  const f = tomlFields(text);
  const get = (table, key) => f.find((x) => x.table === table && x.key === key);
  if (name === 'Cargo.toml') {
    const pkg = get('package', 'name');
    const lic = get('package', 'license') ?? f.find((x) => x.table === 'package.license');
    const inherits = Boolean(f.find((x) => x.table === 'package' && /^license\.workspace$/.test(x.key) && x.value === 'true')
      || (lic && /workspace\s*=\s*true/.test(lic.value)) || f.find((x) => x.table === 'package.license' && x.key === 'workspace'));
    const ws = get('workspace.package', 'license');
    return {
      path, kind: 'cargo', package: pkg ? tomlString(pkg.value) ?? '' : '',
      license: lic && !inherits ? tomlString(lic.value) ?? '' : '',
      workspaceLicense: ws ? tomlString(ws.value) ?? '' : '',
      licenseFile: (() => { const x = get('package', 'license-file'); return x ? tomlString(x.value) ?? '' : ''; })(),
      inherits, unreadable: false,
    };
  }
  const project = get('project', 'name');
  const pl = get('project', 'license');
  const poetry = get('tool.poetry', 'license');
  const plv = pl ? tomlString(pl.value) ?? tomlTable(pl.value, 'text') ?? '' : '';
  return {
    path, kind: 'pyproject', package: project ? tomlString(project.value) ?? '' : '',
    license: plv || (poetry ? tomlString(poetry.value) ?? '' : ''),
    licenseFile: pl ? tomlTable(pl.value, 'file') ?? '' : '', inherits: false, unreadable: false,
  };
}

const LICENSE_FILE = /^(LICENSE|LICENCE|COPYING)([-.].*)?$/i;
const MANIFESTS = new Set(['Cargo.toml', 'package.json', 'pyproject.toml']);
const repositories = [];
for (const pin of snapshot.repositories) {
  const dir = checkout(pin);
  const json = JSON.parse(lint(dir, '--json'));
  if (json.reuse_tool_version !== sources.reuse.version || json.reuse_spec_version !== sources.reuse.specVersion || json.lint_version !== sources.reuse.lintVersion) {
    throw new Error(`${pin.repository}: the report is lint ${json.lint_version} by reuse ${json.reuse_tool_version} for spec ${json.reuse_spec_version}`);
  }
  const invalid = [...new Set(lint(dir, '--lines').split('\n').filter((l) => /: invalid SPDX License Expression '/.test(l)).map((l) => l.slice(0, l.indexOf(': invalid SPDX License Expression')))) ].sort();
  const nc = json.non_compliant;
  const missingLicensing = new Set(nc.missing_licensing_info);
  const missingCopyright = new Set(nc.missing_copyright_info);
  const tracked = git(dir, ['ls-files', '-z']).split('\0').filter(Boolean);
  const manifests = tracked.filter((p) => MANIFESTS.has(basename(p)) && !p.split('/').includes('node_modules')).sort().map((p) => manifest(dir, p));
  const licenseFiles = tracked.filter((p) => !p.includes('/') && LICENSE_FILE.test(p)).sort().map((p) => {
    const bytes = readFileSync(join(dir, p));
    const r = identify(list, bytes.toString('utf8'));
    // A LICENSE file that is a notice rather than a license text may still state its expression with the SPDX
    // short-form identifier (SPDX 2.3.1 Annex E), which REUSE 3.3 reads the same way.
    const tags = [...bytes.toString('utf8').matchAll(/SPDX-License-Identifier:[ \t]*([^\r\n]*)/g)].map((m) => m[1].trim());
    return { path: p, sha256: sha256(bytes), id: r.id, matched: r.matched, candidates: r.candidates, notices: r.notices, identifiers: tags };
  });
  repositories.push({
    repository: pin.repository,
    commit: pin.commit,
    reuse: {
      filesTotal: json.summary.files_total,
      filesWithCopyright: json.summary.files_with_copyright_info,
      filesWithLicense: json.summary.files_with_licensing_info,
      compliant: json.summary.compliant,
      usedLicenses: json.summary.used_licenses,
      badLicenses: nc.bad_licenses,
      deprecatedLicenses: nc.deprecated_licenses,
      licensesWithoutExtension: nc.licenses_without_extension,
      missingLicenses: nc.missing_licenses,
      unusedLicenses: nc.unused_licenses,
      readErrors: nc.read_errors,
      invalidExpressions: invalid,
      // A file with neither is counted, not listed: `reuse annotate --recursive --skip-existing` reaches exactly
      // those, so the draft needs no list of them. A file with one of the two is listed, since it needs the other.
      missingBoth: nc.missing_copyright_info.filter((p) => missingLicensing.has(p)).length,
      missingCopyrightOnly: nc.missing_copyright_info.filter((p) => !missingLicensing.has(p)),
      missingLicensingOnly: nc.missing_licensing_info.filter((p) => !missingCopyright.has(p)),
    },
    licensesDir: tracked.filter((p) => p.startsWith('LICENSES/')).sort(),
    manifests,
    licenseFiles,
  });
  if (args.includes('--prune')) rmSync(dir, { recursive: true, force: true });
  process.stderr.write(`${pin.repository}: ${json.summary.compliant ? 'compliant' : 'not compliant'}\n`);
}

const text = `${JSON.stringify({
  spec: 'uor-community/licensing-scan/1',
  tool: { reuse: sources.reuse.version, lint: sources.reuse.lintVersion, spec: sources.reuse.specVersion },
  spdx: { tag: sources.spdx.tag, commit: sources.spdx.commit },
  snapshot: { path: 'licensing/snapshot.json', sha256: sha256(readFileSync(join(here, 'snapshot.json'))) },
  repositories,
}, null, 1)}\n`;
const target = join(here, 'scan.json');
if (args.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
    process.stderr.write('licensing/scan.json is not what the pinned tool observes at the pinned commits\n');
    process.exit(1);
  }
} else writeFileSync(target, text);
process.stdout.write(`${repositories.length} repositories, ${repositories.filter((r) => r.reuse.compliant).length} REUSE compliant\n`);
