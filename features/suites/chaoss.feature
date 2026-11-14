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

  @CC-04 @build
  Scenario: Every CHAOSS metric and metrics model has a complete ISO/IEC 15939 mapping: each element of its measurement information model is either stated from a CHAOSS template section cited by digest or carried as a typed open claim
    Given chaoss/measurement.json projected by chaoss/measurement.mjs from the pinned sources
    When the Lean kernel checks measuresValidHolds during prismpm verify
    Then every item maps every element of its plan once, in order, and the stated and open counts add up

  @CC-05 @open
  Scenario: An ISO/IEC 15939 element the CHAOSS templates do not carry, or a definition omits, is an open claim with its reason, never inferred from prose
    Given the open entries in chaoss/measurement.json
    When the measures are read
    Then each open entry is a Mapping that is not stated and names its reason

  @CC-06 @build
  Scenario: An ISO/IEC 15939 element the CHAOSS templates leave open is stated only from what the CHAOSS oracle computes: a GrimoireLab panel the definition cites, a computation the implementation names, and the alias, enricher and backend lines it reads, each pinned to the GrimoireLab 1.23.0 release and cited by sha256
    Given chaoss/oracle-methods.json projected by chaoss/oracle.mjs from GrimoireLab pinned at its 1.23.0 release
    When the Lean kernel checks registerValidHolds of the measurement mapping during prismpm verify
    Then every mapping stated by the oracle is a stated metric element, and the release counts them

  @CC-07 @build
  Scenario: Every 15939 element neither CHAOSS nor its oracle states has one drafted upstream contribution, decided by a DMN decision table and marked as not submitted
    Given upstream/chaoss-15939 written by chaoss/upstream.mjs
    When the drafts are read
    Then each open element has one contribution the decision table answers, and none is submitted

  @CC-08 @build
  Scenario: A binding proposed to a CHAOSS working group pairs a quantity the definition names with the computation GrimoireLab's panels label by the same word; it is evaluable but states no ISO/IEC 15939 element until the working group adopts it
    Given chaoss/proposals.json checked by chaoss/oracle.mjs against the pinned GrimoireLab panels
    When the oracle methods are read
    Then each proposed metric carries evaluable bindings, no resolved element, and a drafted revision for its working group
