# Foundation licensing register

`Foundation.Licensing.V1` is the open-source licensing facet of the Foundation's Prism. It is generated, never written by hand: every public UOR-Foundation repository is observed with the FSFE REUSE tool, every license it declares is resolved against the SPDX License List, and each declaration is checked against the Foundation's own license policy.

```sh
node licensing/snapshot.mjs [--check]                       # ecosystem/snapshot.json -> snapshot.json: each repository at its default-branch commit
REUSE=<reuse> node licensing/scan.mjs <dir> [--prune] [--check]  # pinned commits + reuse + SPDX list -> scan.json
node licensing/project.mjs <dir> [--check]                  # scan.json + pinned list and policy -> register.json, drafts/*.md
node licensing/catalog.mjs [--check]                        # register.json -> app/src/Foundation/Licensing/V1/Model.lex.tex, app/src/Licensing.lex.tex
```

`<dir>` holds `spdx-license-list`, `dotgithub` and `website` at the commits `sources.json` pins. `scan.mjs` fetches each repository there at its pinned commit and, with `--prune`, removes it once observed. The tool is installed from hashes:

```sh
python3 -m venv .reuse && .reuse/bin/pip install --require-hashes --no-deps -r licensing/requirements.txt
```

## Standards and oracles

| What | Standard | Oracle |
| --- | --- | --- |
| Every file carries copyright and licensing information; every license used has its text in `LICENSES/`, and nothing else is there | REUSE Specification 3.3 (FSFE), sha256 `0b033840…` | `reuse` 6.3.0 from PyPI, wheel sha256 `be6b598a…`, `reuse lint --json` and `--lines` |
| A declared identifier exists, and is OSI-approved, FSF-libre or deprecated | SPDX License List 3.29.0, `spdx/license-list-data` tag `v3.29.0` (`31ba1a50…`), `json/licenses.json` sha256 `47d1cc68…` | The list itself; it is also the list `reuse` 6.3.0 bundles |
| A declared expression parses | SPDX Specification 2.3.1 Annex D | `licensing/spdx.mjs` `parseExpression` |
| A LICENSE file is the text of a listed license | SPDX Specification 2.3.1 Annex B (matching guidelines B.3 to B.14) on the list's legacy templates (B.15.3) | `licensing/spdx.mjs` `identify`; exactly one non-deprecated template must match all of the text |
| A notice-style LICENSE states an expression | SPDX Specification 2.3.1 Annex E, `SPDX-License-Identifier:` | read verbatim |
| The license a manifest declares | Cargo `license` / `license-file` / `license.workspace`, npm `license`, PEP 621 / PEP 639 `project.license`, Poetry `tool.poetry.license` | read from every tracked manifest |

## The Foundation's policy

Read from UOR-Foundation/.github at `92da1141…` and UOR-Foundation/website at `1008c3b0…`:

- GOVERNANCE.md 13: the default license is MIT across Foundation repositories; exceptions need owner approval and documentation; the one named exception is UOR-Framework, Apache-2.0.
- GOVERNANCE.md 6.1: a `LICENSE` is required at every tier.
- CONTRIBUTING.md "License": a contribution is offered under the repository's license, MIT by default. No source states a DCO or a CLA (`dcoRule` and `claRule` are false in the release).
- website `src/about/content.ts`: the specification crate `uor foundation` is published under "Apache 2.0"; `src/site/copy.ts`: the code is "MIT or Apache 2.0". Both phrases are turned back into SPDX expressions by the site's own `spdxWords` mapping (`src/docs/content.ts`), inverted against the list.

Each declaration is checked against the rule for its repository (the exception when one names it, the default otherwise) and against the website's code statement. A mismatch is an open claim citing the declaring file and the rule's document, commit and digest.

## What is checked

`registerValidHolds` is proved by `decide` in `prismpm verify` (LC-01). It checks that:

- every reference resolves, so every declared identifier is a `License` record, and the projector makes those only from entries of the pinned list;
- a repository is compliant exactly when the tool counts no missing, bad, deprecated or unused license, none without an extension, no read error and no invalid expression, and every file has copyright and licensing information (`ProjectReport.is_compliant` in reuse 6.3.0), and the file counts are within the total;
- every non-compliant repository, every repository with no LICENSE file, and every one whose LICENSE text cannot be identified is named by an open claim of that kind;
- every declaration the policy or the website does not allow is named by an open claim; one said to conform names exactly the one license its rule sets;
- the release counts the compliant repositories.

LC-02 holds that the catalog declares the tool version and wheel digest, the list version and digests, the scan, snapshot and source digests and every repository commit. LC-03 is the open claims.

## Drafts

`drafts/<repository>.md` is the exact REUSE remediation of each repository, as data: the `reuse download` and `git rm` for `LICENSES/`, the `reuse annotate` commands, and `reuse lint` to confirm. Files with neither a notice nor licensing information are reached by one `reuse annotate --recursive --skip-existing --skip-global .`, which walks the same Covered Files `reuse lint` does and passes over any file that already has REUSE information; files that have one of the two are listed by name. The license is the one the repository declares; where it is undetermined, or no LICENSE names a copyright holder, the draft says so and leaves a placeholder rather than choosing. Nothing is applied anywhere.

The drafts were checked by applying them, in throwaway checkouts at the pinned commits, to atlas-12288, nest-uor, OOO, uor-addr and calculator-example: after the drafted commands `reuse lint` reported each compliant. (calculator-example's draft uses its declared `MIT OR Apache-2.0`; its non-verbatim LICENSE-APACHE stays an open claim.) On compression, `reuse annotate` ran for over 20 minutes on its multi-megabyte generated sources and that run was stopped, so the larger repositories' drafts have not been applied.

## Findings at the pinned commits

- 0 of 31 repositories are REUSE compliant; of 57,118 Covered Files, 574 carry a copyright notice and 717 licensing information.
- 69 declarations differ from GOVERNANCE.md 13: most repositories declare `MIT OR Apache-2.0`, which no exception documents, and UOR-Framework, the one named Apache-2.0 exception, declares MIT in its workspace and LICENSE.
- The website states that the specification crate `uor-foundation` is published under Apache-2.0; UOR-Framework's `foundation/Cargo.toml` inherits MIT.
- 5 repositories have no LICENSE (GOVERNANCE.md 6.1), 4 declare no license at all, 5 have declarations that disagree, and calculator-example and PrismPM carry a LICENSE-APACHE that is not the verbatim Apache-2.0 text (SPDX B.3.2: "within Derivative Works that You distribute" is shortened).
- No source states a DCO or a CLA.

## Planted defect

2026-11-15. `repositories[2].compliant` was set to `true` in `register.json` (atlas-12288, which the tool reports with 147 files lacking information) and the catalog regenerated. `cargo test -p repo-conformance --test licensing` failed LC-03 ("every non-compliant repository is one reuse-noncompliant claim"), and `node licensing/project.mjs <dir> --check` failed ("register.json is not the projection of its pinned sources"). In `registerValid` the same edit makes `agree (project repository compliant) (noFindings repository)` false, so `decide` cannot prove `registerValidHolds`; that run awaits the SDK image. After `register.json` was restored, both checks and the tests passed again.
