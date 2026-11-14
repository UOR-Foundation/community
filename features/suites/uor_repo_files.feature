Feature: uor_repo_files

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Decide whether a UOR Foundation repository has the files GOVERNANCE.md 6.1 requires and recommends for its tier, naming a missing required file before a missing recommended one.

  @URF-01 @build
  Scenario: The app never answers conformant when readme is missing
    Given the model in app/src/UorRepoFiles.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @URF-02 @build
  Scenario: The app always answers missing-file when readme is present and license is missing
    Given the model in app/src/UorRepoFiles.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @URF-03 @build
  Scenario: The app never answers conformant when tier is t1 and security is missing
    Given the model in app/src/UorRepoFiles.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @URF-04 @build
  Scenario: The app never answers advisory when tier is t4
    Given the model in app/src/UorRepoFiles.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004
