# REUSE remediation draft: prism

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/prism at `507995bab43c0cb06ec244c96e6fc25b3f502204`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 81 files, 0 with copyright, 0 with licensing information; compliant: false

## License expression

`MIT`, as the repository declares it.

## LICENSES/

```sh
reuse download MIT
```

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 81 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='The UOR Foundation' --year=2026 --license=MIT --fallback-dot-license --skip-existing --skip-global --recursive .
```

## Check

```sh
reuse lint
```
