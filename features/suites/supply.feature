Feature: supply

  The supply register: every public UOR-Foundation repository, pinned at its
  default-branch head by supply/snapshot.mjs, given CycloneDX 1.7, SPDX 2.3 and
  SPDX 3.0.1 SBOMs by Anchore syft, each validated against its official schema, its manifests read for
  the dependency edges between Foundation repositories, its own packages looked
  up on crates.io, npm and PyPI, all by supply/project.mjs, and declared as
  Foundation.Supply.V1 records in app/src/Supply.lex.tex.

  @SC-01 @build
  Scenario: The supply register is valid: every dependency edge joins two different repositories of the ecosystem register, every repository has a valid CycloneDX 1.7 SBOM that catalogues a component or an open claim, its component and license counts reconcile with its totals and the release, every package not published as the Foundation's is named by an open claim, and every repository is serialized once in each SBOM format with every invalid serialization and every valid one left uncommitted named by an open claim
    Given the catalog in app/src/Supply.lex.tex
    When the Lean kernel checks registerValidHolds in the Supply catalog during prismpm verify
    Then registerValid holds of the release, its repositories, counts, packages, edges and open claims

  @SC-02 @build
  Scenario: The supply catalog declares every repository of supply/register.json at its pinned commit with the digest of its committed SBOM, the syft release and binary digests, and the digests of the CycloneDX, SPDX 2.3 and SPDX 3.0.1 schemas and purl type index it was validated against
    Given supply/register.json projected from the pinned repositories, syft and standards
    When the catalog and supply/sboms are read
    Then every repository is declared at its commit, every committed SBOM has the digest the catalog declares, and the syft and standard digests are declared

  @SC-03 @open
  Scenario: A repository without a valid SBOM or with nothing catalogued in it, a reference the register cannot resolve, and a package declared for publication that its registry does not publish as the Foundation's are carried as open claims, never dropped or defaulted
    Given the repositories, packages and refusals in supply/register.json
    When the catalog is read
    Then every such repository is one RepositoryClaim, every such package is one PackageClaim, and the release counts them

  @SC-04 @build
  Scenario: Every repository is serialized by the pinned syft as CycloneDX 1.7, SPDX 2.3 and SPDX 3.0.1, each validated against its official schema and SPDX 2.3 also by the pinned spdx/tools-python, every committed CycloneDX 1.7 file has the digest and size the catalog declares, and every reproducible serialization is addressed by its digest
    Given supply/register.json projected from the pinned repositories, syft, schemas and spdx-tools
    When the serializations of the catalog and supply/sboms are read
    Then every repository has one serialization per format, each valid or claimed, every committed CycloneDX 1.7 file is that edition with the digest and size the catalog declares, and every reproducible serialization has a digest

  @SC-05 @open
  Scenario: An SBOM format whose valid serializations are not committed, SPDX 3.0.1 because syft 1.55.0 does not reproduce its bytes and SPDX 2.3 because the committed SBOMs are held under 40 MB, is validated and counted on every run and carried as an open format claim, never dropped
    Given the serializations and format claims in supply/register.json
    When the catalog is read
    Then every valid serialization that is not committed belongs to a format with a FormatClaim, and the release counts the format claims
