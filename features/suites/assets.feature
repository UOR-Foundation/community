Feature: assets

  The asset register: every asset, service and relationship of the UOR Foundation,
  given a stable id, typed by Schema.org and licensed by SPDX where a source states one.
  inventory/snapshot.mjs observes the pinned repositories, the website and the public
  authorities (RDAP, DNS, crates.io, npm, PyPI, ghcr.io, Discord); inventory/project.mjs
  projects inventory/register.json from that snapshot, ecosystem/register.json and the
  Discord observations; and inventory/catalog.mjs declares it as Foundation.Asset.V1
  records in app/src/Assets.lex.tex.

  @AS-01 @build
  Scenario: The asset register is valid: every asset id is unique, every package, service and document resolves to a repository asset or is an open claim, every domain has an RDAP observation, and every organization the sources name has a stated relation or is an open claim
    Given the catalog in app/src/Assets.lex.tex
    When the Lean kernel checks registerValidHolds in the Assets catalog during prismpm verify
    Then registerValid holds of the release, its assets, observations, relationships, documents and open claims

  @AS-02 @build
  Scenario: The asset catalog declares every asset of inventory/register.json under its id, and the digests of the snapshot, the pinned sources and the standards it was projected from
    Given inventory/register.json projected from the pinned sources and snapshot
    When the catalog is read
    Then every asset is declared under its id in id order, and the snapshot, source and standard digests are declared

  @AS-03 @open
  Scenario: An asset that does not resolve, a service with no repository or no deployment, a host or registration RDAP and DNS cannot vouch for, and a relationship whose relation the source does not state, is carried as an open claim, never dropped or guessed
    Given the assets and refusals in inventory/register.json
    When the catalog is read
    Then every refusal is one OpenClaim on its asset and the release counts them
