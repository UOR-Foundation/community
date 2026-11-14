Feature: uor_repo_standards

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Decide whether a UOR Foundation repository carries the identity tags, exactly one tier tag and exactly one status tag STANDARDS.md requires, and versions its releases with Semantic Versioning when it is Tier 1 or 2.

  @URS-01 @build
  Scenario: The app never answers conformant when tiertags equals 0
    Given the model in app/src/UorRepoStandards.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @URS-02 @build
  Scenario: The app never answers conformant when statustags is above 1
    Given the model in app/src/UorRepoStandards.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @URS-03 @build
  Scenario: The app never answers conformant when tier is t1 and versioning is other
    Given the model in app/src/UorRepoStandards.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @URS-04 @build
  Scenario: The app never answers unversioned when tier is t3
    Given the model in app/src/UorRepoStandards.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004
