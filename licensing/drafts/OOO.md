# REUSE remediation draft: OOO

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/OOO at `d0bdb29bdfeba50590bf42b4f9071e0d4bbc2dc6`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 4 files, 0 with copyright, 0 with licensing information; compliant: false

## License expression

`MIT`, as the repository declares it.

## LICENSES/

```sh
reuse download MIT
```

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 4 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='UOR Foundation' --year=2025 --license=MIT --fallback-dot-license --skip-existing --skip-global --recursive .
```

## Check

```sh
reuse lint
```
