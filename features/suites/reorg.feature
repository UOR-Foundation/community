Feature: reorg

  The Foundation's first reorganization of its repositories, as a plan: every
  public UOR-Foundation repository read at its default-branch commit by
  reorg/snapshot.mjs, given one disposition (keep, archive, fold or review) by
  the uor-repo-disposition decision app in reorg/project.mjs under the lifecycle
  of toc/README.md and GOVERNANCE.md 11, and declared as Foundation.Reorg.V1
  records in app/src/Reorg.lex.tex. Every act is staged, never executed.

  @RO-01 @build
  Scenario: The reorganization register is valid: every public UOR Foundation repository has exactly one disposition, the one the uor-repo-disposition table gives its evidence; every fold names a kept host other than itself and no chain of folds returns to its start; every disposition cites evidence of its kind; and every staged act is unexecuted, references an existing repository, and waits on a TOC decision whenever its repository is under review
    Given the catalog in app/src/Reorg.lex.tex
    When the Lean kernel checks registerValidHolds in the Reorg catalog during prismpm verify
    Then registerValid holds of the release, its repositories, dependencies, citations, candidates, norm gaps and acts

  @RO-02 @build
  Scenario: The reorganization catalog declares every repository of reorg/register.json with the commit its evidence was read at, the snapshot and repository-set digests, the pinned norms, and the digest of the uor-repo-disposition app with the builder commit that checked it
    Given reorg/register.json projected from the pinned norms, app and snapshot
    When the catalog is read
    Then every repository is declared with its commit, and the snapshot, set, norm, platform and app digests and the builder commit are declared

  @RO-03 @open
  Scenario: A candidate the evidence raises without deciding it, and every norm the reorganization needs that the Foundation's norms do not define, is carried as an open claim, never decided or defaulted
    Given the candidates, norm gaps and acts in reorg/register.json
    When the catalog is read
    Then every repository under review is one Candidate, every norm gap is one NormGap, and no act is executed
