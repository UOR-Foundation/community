# REUSE remediation draft: 5-Levels-of-UOR

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/5-Levels-of-UOR at `86dde40a976d2a7a7be16b31b6a509698e8eb5bb`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 2 files, 0 with copyright, 0 with licensing information; compliant: false

## License expression

Undetermined.

## LICENSES/

No change.

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 2 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='<COPYRIGHT HOLDER>' --license='<EXPRESSION>' --fallback-dot-license --skip-existing --skip-global --recursive .
```

## Check

```sh
reuse lint
```

## Open

- The license expression is not determined by the repository: its manifests and LICENSE texts are absent, unidentified or disagree (see the open claims in licensing/register.json). `<EXPRESSION>` stands for it until it is decided.
- No LICENSE file names a copyright holder. `<COPYRIGHT HOLDER>` stands for the holder until the Foundation names it.
