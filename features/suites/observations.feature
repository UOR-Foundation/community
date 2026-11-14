Feature: observations

  The Foundation's CHAOSS observations: GrimoireLab 1.23.0's Perceval, SortingHat
  and grimoire-elk run unmodified by observations/collect.py over the public
  repositories ecosystem/register.json names, pinned by commit in
  observations/sources.json and frozen in observations/corpus; projected by
  observations/project.mjs through the uor-observation-admission and
  uor-contribution-attribution apps and the oracle's computations in
  chaoss/oracle-methods.json; and declared as Foundation.Observation.V1 records in
  app/src/Observations.lex.tex.

  @OB-01 @build
  Scenario: The observation register is valid: every observation's admission is what the uor-observation-admission app's first-applicable rules decide on its recorded fields, and every metric value refers to a permitted observation of its own metric, so every value is a function of admitted observations
    Given the catalog in app/src/Observations.lex.tex
    When the Lean kernel checks registerValidHolds in the Observations catalog during prismpm verify
    Then registerValid holds of every observation's admission and every value's observation

  @OB-02 @build
  Scenario: The observation corpus is frozen and replayable: every subject is pinned by the commits of its refs, every corpus file is pinned by the sha256 of its bytes, an independent run from the same pins reproduces each file, and the register and its catalog declare the corpus digest
    Given observations/sources.json, observations/corpus.json and observations/replay.json
    When the register and the catalog are read
    Then every corpus file is replayed to its digest and the corpus digest is declared

  @OB-03 @build
  Scenario: Every contribution is credited through the uor-contribution-attribution app as W3C PROV-O: a person is credited for their own work, a software agent's work is credited to a person only through a Co-authored-by delegation naming exactly one person, and no name or email enters the corpus
    Given the corpus and governance/agents.json
    When observations/project.mjs credits each contribution
    Then each outcome is the app's decision and the corpus holds only SortingHat identity uuids

  @OB-04 @open
  Scenario: A released CHAOSS metric the oracle binds no computation to, and a computation whose index, field, query, aggregation or script this corpus and projector cannot evaluate exactly as the oracle defines it, is carried as an open claim, never approximated
    Given the bindings in chaoss/oracle-methods.json
    When observations/project.mjs evaluates them
    Then every metric is bound or one open claim, and every refused binding is one open claim

  @OB-05 @open
  Scenario: GitHub issues and pull requests, and the Foundation's Discord, enter the corpus only from responses the observations workflow recorded and replayed offline; a Discord channel is read only where the uor-discord-read app permits it, and the record keeps no message text and no member's name
    Given the observations workflow and the corpus manifest
    When a GitHub or Discord source is in the corpus
    Then it names the recorded responses it was replayed from by digest
    And every Discord channel it read is one the uor-discord-read app permits, recorded without message text or names
