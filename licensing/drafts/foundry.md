# REUSE remediation draft: foundry

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/foundry at `9ccde14c10202a7c67cdc63e539918cfdc10a428`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 4276 files, 9 with copyright, 0 with licensing information; compliant: false

## License expression

Undetermined.

## LICENSES/

No change.

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 4267 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='The UOR Foundation' --year=2026 --license='<EXPRESSION>' --fallback-dot-license --skip-existing --skip-global --recursive .
```

### 9 files with a copyright notice but no licensing information

```sh
reuse annotate --license='<EXPRESSION>' --fallback-dot-license -- site/fonts/OFL-Archivo.txt site/fonts/OFL-Geist.txt studio/shell/builtin-themes.LICENSE.txt studio/shell/chat-contracts.LICENSE.txt studio/shell/fonts/OFL-Archivo.txt studio/shell/fonts/OFL-Geist.txt studio/vendor/dyad/NOTICE studio/vendor/hologram-brand-kit/fonts/OFL-Archivo.txt studio/vendor/hologram-brand-kit/fonts/OFL.txt
```

## Check

```sh
reuse lint
```

## Open

- The license expression is not determined by the repository: its manifests and LICENSE texts are absent, unidentified or disagree (see the open claims in licensing/register.json). `<EXPRESSION>` stands for it until it is decided.
