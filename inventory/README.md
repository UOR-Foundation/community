# Asset register (`Foundation.Asset.V1`)

The UOR Foundation's assets, services and relationships. Each one has a stable
id, a Schema.org class and an SPDX license where a source states one. Every
fact comes from an observation pinned by commit or by sha256. The register
holds no secrets and no access rights. Those belong to the security register,
which keys its threats to the ids below.

```
node inventory/snapshot.mjs <clones-dir> [--check]    # observe → inventory/snapshot.json
node inventory/project.mjs <checkouts-dir> [--check]  # project → inventory/register.json
node inventory/catalog.mjs [--check]                  # declare → app/src/Assets.lex.tex
```

`<clones-dir>` holds every repository of `sources.json` `repositories`, by
name. A blob-less clone that has the pinned commit is enough. `<checkouts-dir>`
holds the three `checkouts` (`.github`, `website`, `community`). Each `--check`
re-derives its output and exits nonzero when the output drifts. For the
snapshot, drift means anything other than the observation time.

## Ids

An id is `<scheme>:<name>`. The name is the authority's own name for the
thing, so an id stays the same across re-snapshots for as long as the thing
exists. Assets are numbered in id order (byte order). The rank of an id among
all ids is its position, and `registerValid` checks that, so no id can repeat.

| Scheme | Kind | Schema.org | Name | Example |
| --- | --- | --- | --- | --- |
| `org:` | organization | Organization | a slug of the name the source gives | `org:uor-foundation`, `org:supabase` |
| `repo:` | repository | SoftwareSourceCode | GitHub repository name, as `ecosystem/register.json` lists it | `repo:website`, `repo:.github` |
| `community:` | community | Organization | `github/<organization>` | `community:github/UOR-Foundation` |
| `chat:` | community | Service | `discord/<guild id>` | `chat:discord/1342910418754076732` |
| `domain:` | domain | WebSite | the fully qualified host name, in lower case | `domain:uor.foundation`, `domain:mcp.uor.foundation` |
| `package:` | package | SoftwareApplication | `<registry>/<package name>`, where the registry is `crates.io`, `npm`, `pypi` or `ghcr.io/uor-foundation` | `package:crates.io/uor-addr`, `package:npm/@uor-foundation/uor-addr`, `package:ghcr.io/uor-foundation/prismpm-sdk` |
| `service:` | service | Service, WebSite, WebApplication or Dataset | a slug declared in `declared.json` | `service:lexlean-verifier` |
| `document:` | document | CreativeWork or ImageObject | `<repository>/<path>` at the pinned commit | `document:.github/governance/The_UOR_Foundation_Bylaws.pdf` |

The Discord guild is typed `Service` because Schema.org has no class for an
online community. A community space is a service the Foundation provides on
another organization's platform, and `org:discord` is that platform's provider.

Every asset in `register.json` has `index`, `id`, `kind`, `type`, `name`,
`url`, `license`, `source` (the pinned observation it rests on), and
`repository`. `repository` is the index of the `repo:` asset that implements,
publishes or holds the asset, or -1. These detail lists refer to assets by
index:

- `domains`: one RDAP and DNS observation per host. It records the ICANN
  registrable domain (Public Suffix List), the platform site, why the host is
  the Foundation's (`registrable-domain`, `github-pages`, `pages-cname`,
  `platform`), the DNS RCODE and A, AAAA and CNAME answers, the RDAP server,
  status, registrar, expiry and nameservers, and `registration`, the asset that
  holds the registration.
- `packages`: registry, version, published, owners as the registry publishes
  them, origin (an owner listing, the npm organization, a website install
  instruction, or a workflow), and the stated source repository.
- `services`: provider (`org:uor-foundation`), URL, HTTP status of an
  unredirected GET, and whether it is deployed (2xx or 3xx).
- `relationships`: the Schema.org relation (`memberOf`, `sponsor`, `funder`,
  `provider`, or `unstated`) and the source's own words.
- `documents`: repository, commit, path, sha256, and, for brand files, the
  digest `brand.lock` records.
- `communities`: platform, channel count and the invites that lead to it.
- `refusals`: the open claims, one per asset and refusal.

## Sources and standards

Repositories are read by reference to `ecosystem/register.json` and are not
re-snapshotted. The website, `.github` and this repository are read at the
commits `sources.json` pins. The Discord guild comes from
`observations/responses/discord/guild.json` and `governance/discord.json`. The
services, relationships and platform hosts no authority reports on its own
are in `declared.json`. Each entry there carries a quote that must occur in
its file at the pinned commit. Each standard is read at a pinned version, and
the snapshot records its sha256: Schema.org 30.1, the SPDX License List at
`31846481`, the Public Suffix List at `dfe55f35`, the IANA RDAP bootstrap
(RFC 9224) and RDAP JSON Values (RFC 9083) registries, OCI image annotations
v1.1.1, SemVer 2.0.0 and RFC 9110 status classes. The 90-day expiry window is
the Foundation's own policy, not a standard's.

## Open claims (refusals)

| Refusal | Meaning |
| --- | --- |
| `homepage-unobserved` | GitHub did not answer for the repository resource anonymously, so its homepage is unread |
| `source-repository-unregistered` | the source a registry or image states is not a public repository of the ecosystem register |
| `install-target-unpublished` | a Foundation file tells readers to install a name the registry does not hold, so anyone could register that name |
| `image-not-public`, `image-unversioned` | a workflow names an image that cannot be pulled anonymously, or that has no SemVer release stating its source |
| `service-without-repository`, `service-without-url`, `service-not-deployed` | a public service that no public repository implements, that has no address, or that does not answer |
| `host-unresolved` | a referenced Foundation host returns a DNS error |
| `rdap-unavailable`, `rdap-value-unregistered`, `registration-expiring` | RDAP cannot vouch for the registration, or the registration ends within 90 days |
| `relation-unstated` | the source names the organization but states no Schema.org relation |
| `digest-mismatch` | a brand file is not the bytes `brand.lock` records |

## Gate evidence

Planted defect: the `source-repository-unregistered` refusal of
`package:crates.io/atlas-embeddings` was dropped from `register.json` and the
catalog was regenerated. `cargo test -p repo-conformance --test assets` then
failed AS-03 with `the unresolved asset 44 is claimed`, the `resolved` check of
`registerValid` evaluated false, and `node inventory/project.mjs <checkouts>
--check` exited 1. Restoring the register restored all three.
