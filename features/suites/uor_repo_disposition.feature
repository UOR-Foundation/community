Feature: uor_repo_disposition

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Decide whether a UOR Foundation repository is kept, archived, folded into the repository that supersedes it, or put to the TOC for review, from the evidence read from the repositories at a pinned commit and the lifecycle of toc/README.md and GOVERNANCE.md 11.

  @URD-01 @build
  Scenario: The app always answers archive when archived is yes
    Given the model in app/src/UorRepoDisposition.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @URD-02 @build
  Scenario: The app never answers fold when statement is none
    Given the model in app/src/UorRepoDisposition.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @URD-03 @build
  Scenario: The app never answers fold when statement is relocated
    Given the model in app/src/UorRepoDisposition.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @URD-04 @build
  Scenario: The app always answers review when archived is no and reserved is no and statement is none and family is member
    Given the model in app/src/UorRepoDisposition.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @URD-05 @build
  Scenario: The app never answers archive when archived is no and statement is none
    Given the model in app/src/UorRepoDisposition.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005

  @URD-06 @build
  Scenario: The app always answers keep when archived is no and reserved is yes
    Given the model in app/src/UorRepoDisposition.lex.tex
    When the Lean kernel checks inv006Holds during prismpm verify
    Then no request meets breaksInv006
