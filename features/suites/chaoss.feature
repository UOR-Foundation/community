Feature: chaoss

  The CHAOSS register: every metric and metrics model CHAOSS has released, read
  from its working group's repository at a pinned commit by chaoss/project.mjs,
  and declared as Foundation.Community.V1 records in app/src/Chaoss.lex.tex.

  @CC-01 @build
  Scenario: The CHAOSS register is valid: every released metric and metrics model is numbered and counted against the release, every model names only declared metrics or its own measures, and every open claim names a declared model
    Given the catalog in app/src/Chaoss.lex.tex
    When the Lean kernel checks registerValidHolds during prismpm verify
    Then registerValid holds of the release, its metrics, its models and its open claims

  @CC-02 @build
  Scenario: The CHAOSS catalog declares every metric and metrics model of chaoss/register.json with the content digest of its pinned working-group source
    Given chaoss/register.json projected from the pinned sources
    When the catalog is read
    Then every metric and metrics model slug is declared with its source digest

  @CC-03 @open
  Scenario: A released CHAOSS item the projector cannot match to a definition is carried as an open claim, never dropped or guessed
    Given the refusals in chaoss/register.json
    When the catalog is read
    Then each refusal is an OpenClaim and the release counts it
