# REUSE remediation draft: community

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/community at `1ef75b03a425abf09064f92db4fed0dd6bb23f62`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 865 files, 10 with copyright, 0 with licensing information; compliant: false

## License expression

`MIT OR Apache-2.0`, as the repository declares it.

The policy (https://github.com/UOR-Foundation/.github@92da114114fc9b76cbf2c5168e29d409b62ddde8:governance/GOVERNANCE.md#sha256:96caf3ce9c8a574b5672fcab72648dea6085354ca6bf2eada05e5746f079f574, section 13) sets `MIT`. REUSE compliance is drafted for the license the repository declares; changing that license is a separate decision of the owners.

## LICENSES/

```sh
reuse download Apache-2.0
reuse download MIT
```

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 855 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='The UOR Foundation' --year=2026 --license='MIT OR Apache-2.0' --fallback-dot-license --skip-existing --skip-global --recursive .
```

### 10 files with a copyright notice but no licensing information

```sh
reuse annotate --license='MIT OR Apache-2.0' --fallback-dot-license -- chaoss/brand.lock.json oracles/grimoirelab/chronicler-discord/chronicler/events/core/discord.py oracles/grimoirelab/chronicler-discord/tests/test_discord.py oracles/grimoirelab/perceval-discord/perceval/backends/core/discord.py oracles/grimoirelab/perceval-discord/tests/test_discord.py remediation/observations.json remediation/register.json site/fonts/OFL-Archivo.txt site/fonts/OFL-Geist.txt upstream/chaoss-15939/prompt.json
```

## Check

```sh
reuse lint
```

## Open

- `remediation/project.mjs` carries an invalid SPDX License Expression that must be corrected by hand.
- `remediation/register.json` carries an invalid SPDX License Expression that must be corrected by hand.
