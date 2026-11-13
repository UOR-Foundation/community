Feature: ecosystem

  The ecosystem register: every public UOR-Foundation repository, snapshotted by
  ecosystem/snapshot.mjs, classified by the tag vocabulary of STANDARDS.md and the
  stages of toc/README.md, asked the repo-standards decision app for its outcome by
  ecosystem/project.mjs, and declared as Foundation.Ecosystem.V1 records in
  app/src/Ecosystem.lex.tex.

  @EC-01 @build
  Scenario: The ecosystem register is valid: every public UOR Foundation repository is numbered and counted against the snapshot, its tier and status are recorded exactly when it carries one tag of that kind, and every repository the repo-standards app does not find conformant is named by an open claim
    Given the catalog in app/src/Ecosystem.lex.tex
    When the Lean kernel checks ecosystemValidHolds during prismpm verify
    Then registerValid holds of the snapshot, its repositories and its open claims

  @EC-02 @build
  Scenario: The ecosystem catalog declares every repository of ecosystem/register.json, the snapshot digest, and the digests of the pinned norms and decision app it was projected from
    Given ecosystem/register.json projected from the pinned sources and snapshot
    When the catalog is read
    Then every repository is declared, and the snapshot, norm and app digests are declared

  @EC-03 @open
  Scenario: A repository that fails a STANDARDS.md norm the repo-standards app decides, or that the app cannot decide without a tier, is carried as an open claim, never dropped or defaulted
    Given the repositories and refusals in ecosystem/register.json
    When the catalog is read
    Then every repository the app does not find conformant is one OpenClaim and the snapshot counts it
