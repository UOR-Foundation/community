# Foundation release and change conventions register

`Foundation.Conventions.V1` is the release and change conventions facet of the Foundation's Prism. It is generated, never written by hand: every public UOR-Foundation repository is observed at its pinned default-branch commit, its tags, manifest versions, last 200 commits and `CHANGELOG.md` are held to the three standards below and to the Foundation's own norms, and each convention gets one outcome per repository.

```sh
ORACLES=<dir> node conventions/scan.mjs <work-dir> <sources-dir> [--check]  # pinned commits + oracles -> scan.json
node conventions/project.mjs <sources-dir> [--check]                       # scan.json + pinned specs and norms -> register.json, drafts/*.md
node conventions/catalog.mjs [--check]                                     # register.json -> app/src/Foundation/Conventions/V1/Model.lex.tex, app/src/Conventions.lex.tex
```

`<sources-dir>` holds `dotgithub`, `semver.org`, `conventionalcommits.org` and `keep-a-changelog` at the commits `sources.json` pins; every file read is held to its digest there. The oracles are installed only into a scratch directory, from the lock, with no install scripts:

```sh
cp conventions/oracles/package.json conventions/oracles/package-lock.json <dir>/ && (cd <dir> && npm ci --ignore-scripts)
```

`scan.mjs` fetches one repository at a time (`git fetch --depth 200 --filter=blob:none` at the commit `licensing/snapshot.json` pins), reads it and deletes it.

## Standards and oracles

| Convention | Standard (pinned) | Projector's own implementation | Oracle (pinned) |
| --- | --- | --- | --- |
| `semver` | Semantic Versioning 2.0.0, `semver/semver.org@88e3357f` `spec/v2.0.0.md` sha256 `9c6ec284…` | the FAQ's ECMAScript regular expression, read from that file; the item 11 comparator | `semver` 7.8.5 `valid()` on every candidate, `compare()` on every series |
| `conventional-commits` | Conventional Commits 1.0.0, `conventional-commits/conventionalcommits.org@7d293dc5` `content/v1.0.0/index.md` sha256 `f30a3f86…` | the header grammar of items 1, 4, 5 and 13; item 6; items 12, 15 and 16 | `conventional-commits-parser` 7.1.3 with the `conventional-changelog-conventionalcommits` 10.4.1 parser options; `@commitlint/lint` 21.2.4 with `@commitlint/config-conventional` 21.2.4, unmodified, and with the Foundation profile |
| `keep-a-changelog` | Keep a Changelog 1.1.0, `olivierlacan/keep-a-changelog@08d0df5a` `source/en/1.1.0/index.html.haml` sha256 `6fd44db3…`, example `CHANGELOG.md` sha256 `663c710d…` | a parser written from the page's principles, its six types and its example's headings | `keep-a-changelog` 3.2.0 `parser()` |
| `changelog-file` | GOVERNANCE.md 8, "Keep `CHANGELOG.md` updated." | `CHANGELOG.md` at the root | none needed |
| `release-notes` | GOVERNANCE.md 8, "Publish release notes for every tagged release." | not observed: GitHub Releases are not read here | none |

Each implementation is held first to its specification's own examples (SemVer items 9 to 11, the Conventional Commits examples, the Keep a Changelog example changelog) and then to its oracle on every observation. A SemVer or Conventional Commits disagreement stops the projection; a Keep a Changelog disagreement is an `oracle-disagreement` claim, since that parser is not the specification. Every clause of each specification is registered with how it is checked: `checked`, `formless` (no text can break it) or `undecidable` (it says what a release or commit means); every undecidable clause is a policy claim.

A tag is `semver`, `v-semver` (the "v" the SemVer FAQ calls a common way to mark a version), `prefixed-semver` (`<component>-[v]<version>`, one series per component), `invalid` (it begins as a version, a digit after an optional "v", and is not one) or `not-a-version`.

## The Foundation's norms

Read from UOR-Foundation/.github at `92da1141…` (the pin of `governance/sources.json`):

- STANDARDS.md, "conventions enforced across all UOR Foundation repositories": Conventional Commits v1.0.0; GOVERNANCE.md 7.3; CONTRIBUTING.md "All commits follow". Mandatory in every repository.
- STANDARDS.md "All Tier 1 and 2 repositories follow Semantic Versioning 2.0.0"; GOVERNANCE.md 8. Mandatory at Tier 1 and 2; no repository carries a tier topic (`ecosystem/register.json`), so it is `conditional` everywhere.
- GOVERNANCE.md 8 "Keep `CHANGELOG.md` updated": the file is mandatory everywhere. No norm names Keep a Changelog, so its format is recommended.
- GOVERNANCE.md 8 "Publish release notes for every tagged release": mandatory, unobserved.
- CONTRIBUTING.md "Commit Message Standard" is the Foundation profile: `type-enum` [feat, fix, docs, style, refactor, test, chore, proof, ci, perf] and `subject-max-length` 72 over config-conventional. "lowercase" is config-conventional's `subject-case`, which the table's own example satisfies; "Imperative mood" is undecidable.

Agent-authored commits follow PROV-O as `governance/agents.json` records it: a commit is attributed to a software agent when its author, or a `Co-authored-by` trailer, is a listed agent or a GitHub App (`[bot]`). They are counted separately.

## What is checked

`registerValidHolds` is proved by `decide` in `prismpm verify` (CV-01). It checks that every repository has one outcome per convention, in order; each outcome's measured and failing counts are its repository's for that convention's measure and its status is the one they decide; its requirement is the strongest the norms set (conditional when the norm's tier is unrecorded); every mandatory or conditional outcome that is unmet or unobserved is named by an open claim; the commit, tag, manifest and changelog counts reconcile with their records; and the release totals are the sums. CV-02 holds that the catalog declares every source, input, oracle and commit. CV-03 is the open claims.

## Findings at the pinned commits

- 746 of 2,560 commits (29%) conform to Conventional Commits 1.0.0; 2 of 31 repositories conform throughout (MNIST, kappa-distribution). 1,817 commits (71%) are agent-attributed, and 567 of them conform. commitlint with config-conventional passes 512 and ignores 381 (merge commits and the like); the Foundation profile passes 420.
- 118 of 130 tags name a SemVer version (104 with "v", 14 per component); 4 do not and begin as one (OOO's three timestamp tags, uor-r4 `v0.1`); every one of the 52 manifest versions is SemVer. compression declares 0.6.0 (highest tag 0.5.0) and PrismPM's npm `prism-code` 0.9.1 (highest `prism-code-v` tag 0.8.0) with no tag.
- 5 of 31 repositories have a root `CHANGELOG.md` and none is in the Keep a Changelog 1.1.0 form; F1's fails 2 of 10 checks. UOR-Framework tags v1.0.0 to v7.0.0 while its crates and changelog are at 0.5.x.
- Keep a Changelog 2.0.0 (2026-06-07) is published; this register implements 1.1.0, whose format 2.0.0 says is unchanged.
- 67 open claims: 29 Conventional Commits, 26 `CHANGELOG.md`, 2 SemVer (conditional), 10 release notes unobserved. 16 policy claims.

## Drafts

`drafts/<repository>.md` is each repository's remediation, as data: the rules its commits violate and the Foundation profile as a commitlint configuration; its non-SemVer tags and versions (published tags are never moved); and a Keep a Changelog skeleton with one section per tagged version, dated by the tagged commit, or the checks its changelog fails. Nothing is applied anywhere.

## Planted defects

2026-11-15. The status of OOO's Conventional Commits outcome in `register.json` was set to `met` (0 of 6 commits conform) and the catalog regenerated. `cargo test -p repo-conformance --test conventions` failed CV-03 ("every mandatory or conditional outcome that is unmet or unobserved is one claim", 66 against 67) and CV-01, and `node conventions/project.mjs <dir> --check` failed ("conventions/register.json is not the projection of its pinned sources"). In `registerValid` the edit makes `statusFits` false (`met` with 6 failing), so `decide` cannot prove `registerValidHolds`; that run awaits the SDK image. The same edit fails the same condition in a Python transcription of `registerValid` run on the register. After the register was restored, all checks passed.

2026-11-15. In `grammar.mjs`'s comparator, a numeric pre-release identifier was ranked above an alphanumeric one (SemVer 11.4.3 reversed). `project.mjs` stopped: "the comparator does not put 1.0.0-alpha.1 before 1.0.0-alpha.beta, as SemVer item 11 does". Restored, it projected the same bytes.
