Feature: supply

  The supply register: every public UOR-Foundation repository, pinned at its
  default-branch head by supply/snapshot.mjs, given a CycloneDX 1.6 SBOM by
  Anchore syft and validated against the CycloneDX schema, its manifests read for
  the dependency edges between Foundation repositories, its own packages looked
  up on crates.io, npm and PyPI, all by supply/project.mjs, and declared as
  Foundation.Supply.V1 records in app/src/Supply.lex.tex.

  @SC-01 @build
  Scenario: The supply register is valid: every dependency edge joins two different repositories of the ecosystem register, every repository has a valid CycloneDX 1.6 SBOM that catalogues a component or an open claim, its component and license counts reconcile with its totals and the release, and every package not published as the Foundation's is named by an open claim
    Given the catalog in app/src/Supply.lex.tex
    When the Lean kernel checks registerValidHolds in the Supply catalog during prismpm verify
    Then registerValid holds of the release, its repositories, counts, packages, edges and open claims

  @SC-02 @build
  Scenario: The supply catalog declares every repository of supply/register.json at its pinned commit with the digest of its committed SBOM, the syft release and binary digests, and the digests of the CycloneDX schema and purl type index it was validated against
    Given supply/register.json projected from the pinned repositories, syft and standards
    When the catalog and supply/sboms are read
    Then every repository is declared at its commit, every committed SBOM has the digest the catalog declares, and the syft and standard digests are declared

  @SC-03 @open
  Scenario: A repository without a valid SBOM or with nothing catalogued in it, a reference the register cannot resolve, and a package declared for publication that its registry does not publish as the Foundation's are carried as open claims, never dropped or defaulted
    Given the repositories, packages and refusals in supply/register.json
    When the catalog is read
    Then every such repository is one RepositoryClaim, every such package is one PackageClaim, and the release counts them
