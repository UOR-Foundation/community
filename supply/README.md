# Foundation supply register

`Foundation.Supply.V1` covers what the whole Foundation depends on, and what depends on it. It is projected from pinned sources, never written by hand. It covers every public repository of `ecosystem/snapshot.json`, each pinned in `supply/snapshot.json` at the commit its default branch had when snapshotted.

```sh
node supply/snapshot.mjs heads [--check]                    # default-branch heads -> snapshot.json
node supply/snapshot.mjs registries <sources-dir> [--check] # crates.io, npm, PyPI, ghcr.io -> registries.json
node supply/project.mjs <sources-dir> [--check]             # syft + manifests + registries -> sboms/, register.json
node supply/catalog.mjs [--check]                           # register.json -> app/src/Foundation/Supply/V1/Model.lex.tex, app/src/Supply.lex.tex
```

`<sources-dir>` holds each repository of `snapshot.json`, plus the `specification` (CycloneDX) and `purl-spec` checkouts from `sources.json`, each checked out under its name at its pinned commit. `oracles/reproject.mjs` fetches them as `git-urls` sources. `project.mjs` downloads syft into `<sources-dir>/.supply-tools`. It needs `npm ci` first, for Ajv.

## Oracle and standards

| What | Standard or tool | Pin |
| --- | --- | --- |
| SBOM | CycloneDX 1.6 JSON (ECMA-424), written by Anchore syft 1.38.0 `dir:<checkout> -o cyclonedx-json@1.6 --exclude ./.git/**` | release tarball sha256 and checksums-file sha256 in `sources.json`. The binary digest is recorded in the register. |
| SBOM validity | `schema/bom-1.6.schema.json` (with `spdx.schema.json`, `jsf-0.82.schema.json`) from CycloneDX/specification tag 1.6.1 | commit and per-file sha256 in `sources.json` |
| Validator | Ajv 8.17.1 + ajv-formats 3.0.1, JSON Schema draft-07 | `package-lock.json`. `idn-email` and `iri-reference` are formats Ajv does not implement. They are recorded as not asserted. |
| Component ecosystems | Package-URL types (ECMA-427), `purl-types-index.json` of purl-spec v1.1.1 | commit and sha256 |
| License counts | CycloneDX `licenseChoice`: `license.id` (SPDX), `license.name`, `expression` | the schema above |
| Serial number | RFC 9562 v5 UUID of `<repo url>@<commit>` in the URL namespace | |
| Image source | OCI image-spec annotation `org.opencontainers.image.source` | read from ghcr.io in `registries.json` |

syft draws two values from each run: `serialNumber` and `metadata.timestamp`. These are replaced in syft's own bytes, with the v5 UUID and the commit's committer time. A given tree therefore always gives the same SBOM bytes, and `project.mjs --check` re-runs syft to confirm it.

## Register (`register.json`)

Two other consumers read the register: the reorg workstream and the security threat model. The fields they need are these:

- `repositories[]`: `name`, `commit`, `sbom` (`path`, `sha256`, `bytes`, or `null` if the SBOM did not validate), `components`, `purlTypes`, `licenses`.
- `edges[]`: `{from, to, kind, evidence}`. `from` depends on `to`. Both are repository names of the ecosystem register. `kind` is one of the following:
  - `package`: a manifest or lockfile names a package that `to` declares as its own.
  - `git`: a git URL, `actions/checkout` `repository:` or workflow URL into `to`.
  - `submodule`: an entry in `.gitmodules`.
  - `action`: `uses: UOR-Foundation/<to>/...@ref`.
  - `image`: a ghcr.io image whose OCI source is `to`.
  - `vendored`: a manifest inside `from` whose `repository` names `to`.

  `evidence` lists every `path:line` the edge was read from.
- `packages[]`: each package that a Foundation manifest declares as its own, meaning its manifest names the repository it sits in. Each entry records `registry` (`published`, `absent`, `elsewhere` or `unread`), the version, downloads as the registry publishes them (crates.io all-time, npm last month, PyPI none), and `externalDependents`. Only crates.io publishes reverse dependencies, so only crates have that list.
- `refusals[]` and `packageClaims[]`: the open claims.

## What is checked

`registerValidHolds` is proved by `decide` in `prismpm verify` (SC-01). It checks that:

- every edge's endpoints are repositories of the register, and no edge is a self-edge;
- every repository has a valid SBOM that catalogues at least one component, or an open claim;
- per repository, the counts by purl type sum to its component total, and its license counts sum to its license entries;
- the component totals sum to the release total;
- every package that is not published as the Foundation's, and is not a private name that no registry holds, has an open claim.

SC-02 holds the catalog to the register: each repository at its commit, each committed SBOM re-hashed (FIPS 180-4) to the digest the catalog declares, and the syft, schema and purl-index digests. SC-03 (open) holds the claims, which are typed refusals rather than guesses:

- `sbom-invalid` and `sbom-empty`;
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
