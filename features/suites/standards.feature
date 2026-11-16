Feature: standards

  The standards applicability register: every part of The UOR Foundation (its domains in
  standards/parts.json and every package and service of inventory/register.json), every
  candidate standard of standards/candidates.json with the scope its issuer states
  (standards/snapshot.json, read by standards/snapshot.mjs), each pair decided by the
  uor-standard-applicability decision app and given its status from the facets by
  standards/project.mjs, and declared as Foundation.Standards.V1 records in
  app/src/Standards.lex.tex.

  @ST-01 @build
  Scenario: The standards register is valid: every part of The UOR Foundation has at least one applicable standard, every candidate pair is decided once by the uor-standard-applicability table, every applicable pair has exactly one status, every implemented pair names an existing facet and a check of it, every pair that is not implemented is an open claim, and every pair the security facet owns carries owner security
    Given the catalog in app/src/Standards.lex.tex
    When the Lean kernel checks registerValidHolds in the Standards catalog during prismpm verify
    Then registerValid holds of the release, its facets, checks, parts, standards, decisions, open claims and scope claims

  @ST-02 @build
  Scenario: The standards catalog declares every part, candidate standard, decided pair and open claim of standards/register.json, each standard's issuer page with its sha256 and fetch time, and the digests of the inputs and the security facet table it was projected from
    Given standards/register.json projected from its inputs
    When the catalog is read
    Then every part, standard, decision and open claim is declared, and every issuer page, input and the security table are addressed by sha256

  @ST-03 @open
  Scenario: A standard that applies to a part of The UOR Foundation but is not implemented there in full, and a candidate whose scope its issuer's page did not yield, are carried as open claims and grouped into workstreams, never dropped or guessed
    Given the decisions, open claims and workstreams in standards/register.json
    When the catalog and standards/workstreams.md are read
    Then every undecided pair and every applicable pair that is not implemented is one OpenClaim, and every one of them belongs to a workstream
