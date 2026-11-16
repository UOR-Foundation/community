# REUSE remediation draft: uor-jcs-nfc

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/uor-jcs-nfc at `303591128094362857791930fdc12b73875d1ff6`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 10 files, 1 with copyright, 0 with licensing information; compliant: false

## License expression

`Apache-2.0`, as the repository declares it.

The policy (https://github.com/UOR-Foundation/.github@92da114114fc9b76cbf2c5168e29d409b62ddde8:governance/GOVERNANCE.md#sha256:96caf3ce9c8a574b5672fcab72648dea6085354ca6bf2eada05e5746f079f574, section 13) sets `MIT`. REUSE compliance is drafted for the license the repository declares; changing that license is a separate decision of the owners.

## LICENSES/

```sh
reuse download Apache-2.0
```

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 9 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='<COPYRIGHT HOLDER>' --license=Apache-2.0 --fallback-dot-license --skip-existing --skip-global --recursive .
```

### 1 files with a copyright notice but no licensing information

```sh
reuse annotate --license=Apache-2.0 --fallback-dot-license -- NOTICE
```

## Check

```sh
reuse lint
```

## Open

- No LICENSE file names a copyright holder. `<COPYRIGHT HOLDER>` stands for the holder until the Foundation names it.
