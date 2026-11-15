Feature: conventions

  The release and change conventions register: every public UOR-Foundation repository of
  ecosystem/snapshot.json, at the default-branch commit licensing/snapshot.json pins, observed by
  conventions/scan.mjs (the last 200 commits, every tag, every manifest version and CHANGELOG.md, each
  run through the pinned oracles), held to Semantic Versioning 2.0.0, Conventional Commits 1.0.0,
  Keep a Changelog 1.1.0 and the Foundation's own norms by conventions/project.mjs, and declared as
  Foundation.Conventions.V1 records in app/src/Conventions.lex.tex.

  @CV-01 @build
  Scenario: The conventions register is valid: every repository has exactly one outcome for each of Semantic Versioning 2.0.0, Conventional Commits 1.0.0, Keep a Changelog 1.1.0, the CHANGELOG.md norm and the release-notes norm, each outcome's status is the one its measured and failing counts decide, its requirement is the strongest the Foundation's norms set for that repository, every mandatory or conditional outcome that is unmet or unobserved is named by an open claim, and the counts reconcile with the records and the release
    Given the catalog in app/src/Conventions.lex.tex
    When the Lean kernel checks registerValidHolds in the Conventions catalog during prismpm verify
    Then registerValid holds of the release, its conventions, norms, clauses, repositories, outcomes, tags, manifests, violations, changelog checks and claims

  @CV-02 @build
  Scenario: The conventions catalog declares the pinned specification and policy sources with their digests, the digest of the SemVer expression, every oracle by version and integrity, the oracle lock, the input digests and the commit of every repository it observed
    Given conventions/register.json projected from conventions/scan.json and the pinned sources
    When the catalog is read
    Then every source and input digest, every oracle version and integrity and every repository commit are declared

  @CV-03 @open
  Scenario: A mandatory or conditional convention a repository does not meet or that this register cannot observe, an oracle disagreement, and every clause or norm the sources cannot settle are carried as open claims citing their sources, never dropped or guessed
    Given the outcomes, refusals and policy claims in conventions/register.json
    When the catalog is read
    Then every mandatory or conditional outcome that is unmet or unobserved is named by one OpenClaim, and every undecidable clause by one PolicyClaim
