# REUSE remediation draft: uor-matmul

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/uor-matmul at `3cc5882f210667f9ac00fd8c02c5b5957b493f5d`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 683 files, 1 with copyright, 0 with licensing information; compliant: false

## License expression

Undetermined.

## LICENSES/

No change.

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 682 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='Alex Flom' --year=2026 --license='<EXPRESSION>' --fallback-dot-license --skip-existing --skip-global --recursive .
```

### 1 files with a copyright notice but no licensing information

```sh
reuse annotate --license='<EXPRESSION>' --fallback-dot-license -- oracles/numpy/1x100000x1.expected.bin
```

## Check

```sh
reuse lint
```

## Open

- The license expression is not determined by the repository: its manifests and LICENSE texts are absent, unidentified or disagree (see the open claims in licensing/register.json). `<EXPRESSION>` stands for it until it is decided.
