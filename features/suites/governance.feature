Feature: governance

  The UOR Foundation's governance: the Bylaws, the GitHub governance framework,
  the TOC process, the repository standards, the Code of Conduct and the Security
  policy in UOR-Foundation/.github, and the Board on the website, each read from
  git at a pinned commit by governance/project.mjs and declared as
  Foundation.Governance.V1 records (W3C ORG, Schema.org, W3C PROV-O) in
  app/src/Governance.lex.tex.

  @GV-01 @build
  Scenario: The Foundation governance register is valid: every unit, post, role, vote rule, stage, holding, membership, delegation and reference resolves; every rule that decides something belongs to a body with a quorum rule; every TOC lifecycle decision is a Technical Oversight Committee vote; every Board position the Bylaws create is held by exactly one person; and the Board's size is within the Bylaws' bounds
    Given the catalog in app/src/Governance.lex.tex
    When the Lean kernel checks registerValidHolds during prismpm verify
    Then registerValid holds of the release and every list of the register

  @GV-02 @build
  Scenario: The governance catalog declares every provision of governance/register.json with the content digest of its text at the pinned source commit
    Given governance/register.json projected from the pinned sources
    When the catalog is read
    Then every provision is declared with its digest, and the release names every pinned source

  @GV-03 @open
  Scenario: A post, role or committee no pinned source fills, a reference that resolves to nothing, an agent with no person behind it, and every Bylaws notice is carried as an open claim, never dropped or guessed
    Given the refusals in governance/register.json
    When the catalog is read
    Then each refusal is an OpenClaim and the release counts it

  @GV-04 @build
  Scenario: Agents are Schema.org SoftwareApplication, never Person: every PROV-O actedOnBehalfOf delegation runs from a SoftwareApplication to a Person, and only a Person holds a post or a role
    Given the actors and delegations in app/src/Governance.lex.tex
    When the Lean kernel checks registerValidHolds
    Then delegationsTyped, holdingsTyped and membershipsTyped hold
