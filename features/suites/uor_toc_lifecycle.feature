Feature: uor_toc_lifecycle

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Give the next lifecycle stage of a UOR Foundation project from its stage now, the application before the TOC, whether a quorum met, the TOC's recorded vote, whether the stage's evidence is complete and how many days the public comment period ran.

  @UTL-01 @build
  Scenario: The app never answers graduated when quorum is unmet and stage is incubation
    Given the model in app/src/UorTocLifecycle.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @UTL-02 @build
  Scenario: The app never answers graduated when vote is majority and stage is incubation
    Given the model in app/src/UorTocLifecycle.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @UTL-03 @build
  Scenario: The app never answers graduated when comment is below 14 and stage is incubation
    Given the model in app/src/UorTocLifecycle.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @UTL-04 @build
  Scenario: The app never answers incubation when stage is proposed
    Given the model in app/src/UorTocLifecycle.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @UTL-05 @build
  Scenario: The app never answers graduated when stage is sandbox
    Given the model in app/src/UorTocLifecycle.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005

  @UTL-06 @build
  Scenario: The app never answers sandbox when evidence is partial and stage is proposed
    Given the model in app/src/UorTocLifecycle.lex.tex
    When the Lean kernel checks inv006Holds during prismpm verify
    Then no request meets breaksInv006

  @UTL-07 @build
  Scenario: The app always answers graduated when stage is graduated and application is not archival
    Given the model in app/src/UorTocLifecycle.lex.tex
    When the Lean kernel checks inv007Holds during prismpm verify
    Then no request meets breaksInv007

  @UTL-08 @build
  Scenario: The app always answers archived when stage is archived
    Given the model in app/src/UorTocLifecycle.lex.tex
    When the Lean kernel checks inv008Holds during prismpm verify
    Then no request meets breaksInv008
