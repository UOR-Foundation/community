# REUSE remediation draft: research

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/research at `bfccda396aab1aea5dee649fbe5180499d236cec`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 95 files, 9 with copyright, 0 with licensing information; compliant: false

## License expression

`MIT`, as the repository declares it.

## LICENSES/

```sh
reuse download MIT
```

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 86 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='The UOR Foundation' --year=2026 --license=MIT --fallback-dot-license --skip-existing --skip-global --recursive .
```

### 9 files with a copyright notice but no licensing information

```sh
reuse annotate --license=MIT --fallback-dot-license -- atlas-embeddings/lean4/AtlasEmbeddings.lean atlas-embeddings/lean4/AtlasEmbeddings/ActionFunctional.lean atlas-embeddings/lean4/AtlasEmbeddings/Arithmetic.lean atlas-embeddings/lean4/AtlasEmbeddings/Atlas.lean atlas-embeddings/lean4/AtlasEmbeddings/CategoricalFunctors.lean atlas-embeddings/lean4/AtlasEmbeddings/Completeness.lean atlas-embeddings/lean4/AtlasEmbeddings/E8.lean atlas-embeddings/lean4/AtlasEmbeddings/Embedding.lean atlas-embeddings/lean4/AtlasEmbeddings/Groups.lean
```

## Check

```sh
reuse lint
```
