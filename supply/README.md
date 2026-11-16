# Foundation supply register

`Foundation.Supply.V1` covers what the whole Foundation depends on, and what depends on it. It is projected from pinned sources, never written by hand. It covers every public repository of `ecosystem/snapshot.json`, each pinned in `supply/snapshot.json` at the commit its default branch had when snapshotted.

```sh
node supply/snapshot.mjs heads [--check]                    # default-branch heads -> snapshot.json
node supply/snapshot.mjs registries <sources-dir> [--check] # crates.io, npm, PyPI, ghcr.io -> registries.json
node supply/project.mjs <sources-dir> [--check] [--fetch]   # syft + manifests + registries -> sboms/, register.json
node supply/catalog.mjs [--check]                           # register.json -> app/src/Foundation/Supply/V1/Model.lex.tex, app/src/Supply.lex.tex
```

`<sources-dir>` holds each repository of `snapshot.json`, plus the `specification` (CycloneDX), `spdx-spec` and `purl-spec` checkouts from `sources.json`, each checked out under its name at its pinned commit. `oracles/reproject.mjs` fetches them as `git-urls` sources. With `--fetch`, `project.mjs` fetches each repository that is not already there at its pinned commit just before reading it and removes it after, so only one repository is on disk at a time. `project.mjs` downloads syft and the SPDX 3.0.1 schema into `<sources-dir>/.supply-tools`, and installs spdx/tools-python there in its own venv with `pip --require-hashes --only-binary=:all: -r supply/spdx-tools.requirements.txt`. It needs `npm ci` first, for Ajv, and `python3` with `venv`.

## Oracle and standards

| What | Standard or tool | Pin |
| --- | --- | --- |
| SBOM writer | Anchore syft 1.55.0, one run per tree: `-c supply/syft.yaml dir:<checkout> -q --exclude ./.git/** -o cyclonedx-json@1.7=… -o spdx-json@2.3=… -o spdx-json@3.0=…`. 1.55.0 is the newest release published at least 14 days before 2026-11-15; CycloneDX 1.7 and SPDX 3.0.1 output exist since v1.46.0 (`syft/format/internal/cyclonedxutil/versions.go`, `spdxutil/versions.go`). | release tarball sha256 and checksums-file sha256 in `sources.json`. The binary digest is recorded in the register. |
| CycloneDX | CycloneDX 1.7 JSON (ECMA-424 2nd edition), `schema/bom-1.7.schema.json` with `spdx.schema.json`, `jsf-0.82.schema.json` and `cryptography-defs.schema.json` from CycloneDX/specification tag 1.7.2, JSON Schema draft-07 | commit and per-file sha256 in `sources.json` |
| SPDX 2.3 | SPDX 2.3 JSON, `schemas/spdx-schema.json` of spdx/spdx-spec tag v2.3.1 (JSON Schema 2019-09), and spdx/tools-python 0.8.5 `pyspdxtools -i`. ISO/IEC 5962:2021 is SPDX 2.2.1; SPDX 2.3 extends it. | commit and sha256 in `sources.json`; every wheel of spdx-tools and its dependencies by sha256 in `spdx-tools.requirements.txt` |
| SPDX 3.0.1 | SPDX 3.0.1 JSON-LD, `https://spdx.org/schema/3.0.1/spdx-json-schema.json` (JSON Schema 2020-12), the schema `standards.lock` binds as `SPDX-SCHEMA-3-0-1` | sha256 in `sources.json`, the same as `standards.lock` |
| Validator | Ajv 8.17.1 + ajv-formats 3.0.1, in each schema's own dialect | `package-lock.json`. Formats Ajv does not implement are recorded per format as not asserted. |
| Component ecosystems | Package-URL types (ECMA-427), `purl-types-index.json` of purl-spec v1.1.1 | commit and sha256 |
| License counts | CycloneDX `licenseChoice`: `license.id` (SPDX), `license.name`, `expression` | the CycloneDX schema above |
| Serial number, document namespace | RFC 9562 v5 UUID of `<repo url>@<commit>` in the URL namespace | |
| Image source | OCI image-spec annotation `org.opencontainers.image.source` | read from ghcr.io in `registries.json` |

`supply/syft.yaml` is the only configuration syft reads (`-c`, with every `SYFT_*` variable removed). It includes development dependencies: they are part of a repository's supply chain, and syft 1.55.0 reads a `bun.lock` reproducibly only with them included, because it marks a package dev-only through a graph keyed by name, so with two versions of one name the result follows Go map order. Eight runs on `website` without it gave between 130 and 147 components; with it, 587 every time.

syft draws values from each run, and they are replaced in syft's own bytes so its layout is kept: a file path is cut to the repository root (the checkout's real path becomes `/`), the CycloneDX `serialNumber` and the SPDX 2.3 `documentNamespace` take the v5 UUID, and the CycloneDX `metadata.timestamp` and SPDX 2.3 `creationInfo.created` the commit's committer time. A given tree therefore always gives the same CycloneDX 1.7 and SPDX 2.3 bytes, and `project.mjs --check` re-runs syft to confirm it. The CycloneDX 1.7 bytes are committed as `sboms/<repo>.cdx.json`. The SPDX 2.3 bytes are addressed by their sha256 and size in the register and re-derived by `--check`, but not committed: the committed SBOMs are held under 40 MB, and with development dependencies the CycloneDX 1.7 documents take 21.1 MB and the SPDX 2.3 documents 22.0 MB. That is the open format claim `not-committed` (SC-05); `sources.json` `syft.committed` says which formats are committed.

syft 1.55.0 does not write SPDX 3.0.1 reproducibly: the `@graph` order and the numbering of its local identifiers (`SPDXRef:Relationship-N`, `SPDXRef:Organization-N`) change between two runs on the same tree, while the element counts do not. Each SPDX 3.0.1 document is therefore validated and counted on every run, a second run of each tree confirms the bytes differ, and the format carries the open claim `not-reproducible` (SC-05) instead of a committed file.

A partial clone reads the same: `uor-r4` was projected from a `--filter=blob:limit=1m` sparse checkout that leaves out its 250 blobs over 1 MB. syft 1.38.0 gave that checkout the committed CycloneDX 1.6 SBOM byte for byte, and the 250 left-out files, written at their own paths in three batches, gave 0 components under both syft 1.38.0 and 1.55.0 (default configuration); none of them is a manifest `manifests.mjs` reads, nor a JavaScript lockfile, the only kind `syft.yaml` changes the reading of.

## Register (`register.json`)

Two other consumers read the register: the reorg workstream and the security threat model. The fields they need are these:

- `repositories[]`: `name`, `commit`, `sbom` (the CycloneDX 1.7 file: `path`, `sha256`, `bytes`, or `null` if it did not validate), `serializations` (one per format: `format`, `valid`, `reproducible`, `path` or `null` when not committed, `sha256` of a reproducible document, `bytes`, `elements`), `components`, `purlTypes`, `licenses`.
- `edges[]`: `{from, to, kind, evidence}`. `from` depends on `to`. Both are repository names of the ecosystem register. `kind` is one of the following:
  - `package`: a manifest or lockfile names a package that `to` declares as its own.
  - `git`: a git URL, `actions/checkout` `repository:` or workflow URL into `to`.
  - `submodule`: an entry in `.gitmodules`.
  - `action`: `uses: UOR-Foundation/<to>/...@ref`.
  - `image`: a ghcr.io image whose OCI source is `to`.
  - `vendored`: a manifest inside `from` whose `repository` names `to`.

  `evidence` lists every `path:line` the edge was read from.
- `packages[]`: each package that a Foundation manifest declares as its own, meaning its manifest names the repository it sits in. Each entry records `registry` (`published`, `absent`, `elsewhere` or `unread`), the version, downloads as the registry publishes them (crates.io all-time, npm last month, PyPI none), and `externalDependents`. Only crates.io publishes reverse dependencies, so only crates have that list.
- `refusals[]`, `packageClaims[]` and `formatClaims[]`: the open claims.

## What is checked

`registerValidHolds` is proved by `decide` in `prismpm verify` (SC-01). It checks that:

- every edge's endpoints are repositories of the register, and no edge is a self-edge;
- every repository has a valid SBOM that catalogues at least one component, or an open claim;
- per repository, the counts by purl type sum to its component total, and its license counts sum to its license entries;
- the component totals sum to the release total;
- every package that is not published as the Foundation's, and is not a private name that no registry holds, has an open claim;
- every repository has exactly one serialization per SBOM format; one that does not validate has a repository claim, a valid one that is not committed has a format claim, and the committed bytes sum to the release's `sbomBytes`.

SC-02 holds the catalog to the register: each repository at its commit, each committed SBOM re-hashed (FIPS 180-4) to the digest the catalog declares, and the syft, schema and purl-index digests. SC-04 holds every serialization: three per repository, each committed CycloneDX 1.7 file re-hashed to its declared digest and size and opening as that edition, every reproducible serialization addressed by a digest, no uncommitted format left as a file, and the schemas and spdx-tools declared. SC-05 (open) holds the format claims. SC-03 (open) holds the other claims, which are typed refusals rather than guesses:

- `sbom-invalid` (CycloneDX 1.7), `spdx-invalid` (SPDX 2.3, schema or pyspdxtools), `spdx3-invalid` (SPDX 3.0.1) and `sbom-empty`;
- `purl-type-unregistered`;
- `packages-unlinked`: a publishable manifest that names no repository, so no registry entry can be verified as the Foundation's;
- `reference-outside-register`: a `UOR-Foundation/<x>` that is not a public repository;
- `image-source-undeclared`;
- `sdk-image-outside-foundation`: a `prismpm.lock` SDK image outside `ghcr.io/uor-foundation`;
- `package-ambiguous`;
- `manifest-unreadable`;
- package claims: `unpublished`, `name-held-elsewhere`, `private-name-held-elsewhere`, `published-from-other-repository`, `registry-unread`.

## Freshness

`snapshot.mjs heads --check` fails as soon as any default branch moves, and that is expected: the register describes the pinned commits. The fix is to re-snapshot, re-project and re-catalog. `registries --check` compares only what decides the register, which is each name's status, linked repository and image source. Download counts are kept "as published at `fetchedAt`".

## Planted defect

2026-11-15: the planted defect was a one-byte change to `supply/sboms/F1.cdx.json` (`"version":1` became `2`). It made `cargo test -p repo-conformance --test supply` fail at SC-02 with "supply/sboms/F1.cdx.json has the digest the catalog declares". Restoring the file made the test pass again. The Lean gate (a self-edge in `register.json` that is then re-catalogued) still has to be planted under the SDK image.

2026-11-15, SC-04: a one-byte change to `supply/sboms/F1.cdx.json` (`"version":1` became `2`) made the same test fail at SC-04 with "supply/sboms/F1.cdx.json has the digest and size the catalog declares", and a stray `supply/sboms/F1.spdx.json` made it fail with "supply/sboms/F1.spdx.json is not committed, so no file stands in for it". Restoring the tree made it pass again.
