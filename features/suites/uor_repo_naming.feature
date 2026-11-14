Feature: uor_repo_naming

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Decide whether a UOR Foundation repository follows the STANDARDS.md naming conventions and carries every Domain and Technology topic tag that applies to it, naming a broken convention before a missed preference.

  @URN-01 @build
  Scenario: The app never answers conformant when case is other
    Given the model in app/src/UorRepoNaming.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @URN-02 @build
  Scenario: The app never answers conformant when version is present
    Given the model in app/src/UorRepoNaming.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @URN-03 @build
  Scenario: The app never answers conformant when commits is other
    Given the model in app/src/UorRepoNaming.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @URN-04 @build
  Scenario: The app never answers conformant when domain is incomplete
    Given the model in app/src/UorRepoNaming.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @URN-05 @build
  Scenario: The app never answers conformant when pattern is other
    Given the model in app/src/UorRepoNaming.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005

  @URN-06 @build
  Scenario: The app always answers advisory when case is lowercase and version is absent and branches is conforming and commits is conventional and domain is complete and technology is complete and pattern is other
    Given the model in app/src/UorRepoNaming.lex.tex
    When the Lean kernel checks inv006Holds during prismpm verify
    Then no request meets breaksInv006
