# REUSE remediation draft: uor-addr

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/uor-addr at `20a1c5723fc8f5d645972c8d6f5c57459846302e`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 251 files, 3 with copyright, 0 with licensing information; compliant: false

## License expression

`Apache-2.0`, as the repository declares it.

The policy (https://github.com/UOR-Foundation/.github@92da114114fc9b76cbf2c5168e29d409b62ddde8:governance/GOVERNANCE.md#sha256:96caf3ce9c8a574b5672fcab72648dea6085354ca6bf2eada05e5746f079f574, section 13) sets `MIT`. REUSE compliance is drafted for the license the repository declares; changing that license is a separate decision of the owners.

## LICENSES/

```sh
reuse download Apache-2.0
```

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 248 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='<COPYRIGHT HOLDER>' --license=Apache-2.0 --fallback-dot-license --skip-existing --skip-global --recursive .
```

### 3 files with a copyright notice but no licensing information

```sh
reuse annotate --license=Apache-2.0 --fallback-dot-license -- data/ucd/15.1.0/CompositionExclusions.txt data/ucd/15.1.0/DerivedNormalizationProps.txt data/ucd/15.1.0/NormalizationTest.txt
```

## Check

```sh
reuse lint
```

## Open

- No LICENSE file names a copyright holder. `<COPYRIGHT HOLDER>` stands for the holder until the Foundation names it.
