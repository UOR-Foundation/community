/**
 * Read the pinned sources: the three specifications and the Foundation's own
 * release and change norms. Every file is read from git at the commit
 * conventions/sources.json pins and held to the digest recorded there. A norm
 * is a sentence of STANDARDS.md, GOVERNANCE.md or CONTRIBUTING.md, matched
 * verbatim; when a sentence no longer reads as pinned the projector stops
 * rather than guess what it now requires.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { semverRegex, vPrefixAnswer, ccItems, kacTypes, kacPrinciples } from './grammar.mjs';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function pinned(dir, source, path, digest) {
  const at = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (at !== source.commit) throw new Error(`${dir} is at ${at}, not the pinned ${source.commit}`);
  const bytes = execFileSync('git', ['-C', dir, 'show', `${source.commit}:${path}`], { maxBuffer: 1 << 28 });
  const s = sha256(bytes);
  if (digest && s !== digest) throw new Error(`${source.url}@${source.commit}:${path} is sha256:${s}, not the pinned ${digest}`);
  return { ref: `${source.url}@${source.commit}:${path}`, sha256: s, text: bytes.toString('utf8').replace(/\r\n/g, '\n') };
}

const section = (doc, heading) => {
  const at = doc.text.indexOf(`\n${heading}\n`);
  if (at < 0) throw new Error(`${doc.ref} has no "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  const rest = doc.text.slice(at + heading.length + 2);
  const end = rest.search(new RegExp(`\\n#{1,${level}} `));
  return end < 0 ? rest : rest.slice(0, end);
};
const must = (doc, heading, sentence) => {
  const text = heading ? section(doc, heading) : doc.text;
  if (!text.includes(sentence)) throw new Error(`${doc.ref}${heading ? ` "${heading}"` : ''} no longer says "${sentence}"`);
  return sentence;
};

export function readNorms(dir, sources) {
  const { semver: sv, conventionalCommits: cc, keepAChangelog: kac } = sources.standards;
  const semverText = pinned(join(dir, 'semver.org'), sv, sv.path, sv.sha256);
  const ccText = pinned(join(dir, 'conventionalcommits.org'), cc, cc.path, cc.sha256);
  const kacPage = pinned(join(dir, 'keep-a-changelog'), kac, kac.path, kac.sha256);
  const kacExample = pinned(join(dir, 'keep-a-changelog'), kac, kac.example, kac.exampleSha256);
  const p = sources.policy;
  const policy = join(dir, p.name);
  const standards = pinned(policy, p, p.standards.path, p.standards.sha256);
  const governance = pinned(policy, p, p.governance.path, p.governance.sha256);
  const contributing = pinned(policy, p, p.contributing.path, p.contributing.sha256);

  const re = semverRegex(semverText.text, sv.regexHeading, sv.regexFlavour);
  const vPrefix = vPrefixAnswer(semverText.text, sv.prefixHeading);
  // The specification's numbered items, and the examples it gives of valid versions (items 9 and 10) and of
  // precedence (item 11), each read from the text between its title and the BNF grammar.
  const specAt = semverText.text.indexOf('Semantic Versioning Specification (SemVer)\n---');
  const specEnd = semverText.text.indexOf('Backus–Naur Form Grammar');
  if (specAt < 0 || specEnd < specAt) throw new Error('the SemVer text no longer has its specification section');
  const spec = semverText.text.slice(specAt, specEnd);
  const semverItems = [];
  for (const line of spec.split('\n')) {
    if (/^1\. /.test(line)) semverItems.push(line.slice(3).trim());
    else if (semverItems.length && line.trim() && !/^\s+1\. |^\s+Example:/.test(line) && !/^ {3,}/.test(line)) semverItems[semverItems.length - 1] += ` ${line.trim()}`;
  }
  const flat = spec.replace(/\s+/g, ' ');
  const validExamples = [...flat.matchAll(/Examples: ((?:\S+, )+\S+)\.(?: |$)/g)].flatMap((m) => m[1].split(', ')).map((v) => v.replace(/\\-/g, '-'));
  const chains = [...flat.matchAll(/Example: ((?:\S+ < )+\S+?)\.(?: |$)/g)].map((m) => m[1].split(' < '));
  if (semverItems.length !== 11 || chains.length !== 3 || validExamples.length < 8) throw new Error(`the SemVer specification reads as ${semverItems.length} items, ${chains.length} precedence examples and ${validExamples.length} version examples`);
  const items = ccItems(ccText.text);
  const types = kacTypes(kacPage.text);
  const principles = kacPrinciples(kacPage.text);
  // The specification's own examples of a commit message: every fenced block under "## Examples".
  const examples = [...section(ccText, '## Examples').matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);

  // ---- The Foundation's norms: which convention each requires, and where.
  const norms = [];
  const norm = (doc, sec, statement, convention, requirement, condition) => norms.push({ document: `${doc.ref}#sha256:${doc.sha256}`, section: sec, statement, convention, requirement, condition });
  const scope = must(standards, '', 'This document summarizes the naming, versioning, and tagging conventions enforced across all UOR Foundation repositories.');
  norm(standards, 'Naming Conventions', `${scope} ${must(standards, '## Naming Conventions', '- Commit messages: [Conventional Commits v1.0.0](https://www.conventionalcommits.org/).').slice(2)}`, 'conventional-commits', 'mandatory', '');
  norm(governance, '7.3', `${must(governance, '### 7.3 Commit Messages', 'Use [Conventional Commits](https://www.conventionalcommits.org/):')} type(scope): description`, 'conventional-commits', 'mandatory', '');
  norm(contributing, 'Commit Message Standard', must(contributing, '## Commit Message Standard', 'All commits follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/):'), 'conventional-commits', 'mandatory', '');
  norm(standards, 'Versioning', must(standards, '## Versioning', 'All Tier 1 and 2 repositories follow [Semantic Versioning 2.0.0](https://semver.org/):'), 'semver', 'conditional', 'tier-1-core or tier-2-impl');
  norm(governance, '8', must(governance, '## 8. Version Management & Releases', '- Use [Semantic Versioning](https://semver.org/) for Tier 1-2 repositories.').slice(2), 'semver', 'conditional', 'tier-1-core or tier-2-impl');
  // "Keep CHANGELOG.md updated" names the file and carries no tier; it does not name Keep a Changelog's format.
  norm(governance, '8', must(governance, '## 8. Version Management & Releases', '- Keep `CHANGELOG.md` updated.').slice(2), 'changelog-file', 'mandatory', '');
  const releaseNotes = must(governance, '## 8. Version Management & Releases', '- Publish release notes for every tagged release.').slice(2);
  norm(governance, '8', releaseNotes, 'release-notes', 'mandatory', '');

  // ---- The Foundation's commit profile: CONTRIBUTING.md's table over @commitlint/config-conventional.
  const table = section(contributing, '## Commit Message Standard');
  const row = (el) => {
    const r = table.split('\n').find((l) => l.startsWith(`| **${el}** |`));
    if (!r) throw new Error(`CONTRIBUTING.md has no ${el} row`);
    const [required, values] = r.split('|').slice(2, -1).map((c) => c.trim());
    return { required, values };
  };
  const type = row('type');
  const scopeRow = row('scope');
  const description = row('description');
  const profileTypes = [...type.values.matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
  const max = description.values.match(/max (\d+) chars/);
  if (type.required !== 'Yes' || !profileTypes.length || description.required !== 'Yes' || !max || !/no trailing period/.test(description.values) || !/lowercase/.test(description.values) || !/Imperative mood/.test(description.values)) throw new Error('CONTRIBUTING.md "Commit Message Standard" no longer reads as pinned');
  const example = table.match(/Example: `([^`]+)`/)?.[1] ?? '';
  const profile = {
    document: `${contributing.ref}#sha256:${contributing.sha256}`,
    types: profileTypes,
    scope: scopeRow.required,
    maxDescription: Number(max[1]),
    description: description.values,
    example,
    // type-enum and subject-max-length are the table's; config-conventional already holds subject-full-stop
    // ("no trailing period") and type-empty / subject-empty ("Yes" required). "lowercase" is read as
    // config-conventional's subject-case, which the table's own example ("add E7 augmentation construction",
    // an uppercase letter after the first word) satisfies; reading it as every letter lowercase would refuse
    // the table's example. "Imperative mood" is not decidable on text and is carried as a policy claim.
    rules: { 'type-enum': [2, 'always', profileTypes], 'subject-max-length': [2, 'always', Number(max[1])] },
  };
  return {
    documents: [semverText, ccText, kacPage, kacExample, standards, governance, contributing].map(({ ref, sha256: s }) => ({ ref, sha256: s })),
    semver: { regex: re.regex, source: re.source, vPrefix, items: semverItems, chains, validExamples },
    cc: { items, examples },
    kac: { types, principles, example: kacExample.text },
    norms,
    releaseNotes,
    profile,
  };
}
