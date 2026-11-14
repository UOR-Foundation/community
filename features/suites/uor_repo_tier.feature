Feature: uor_repo_tier

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Decide a UOR Foundation repository's tier from the tier tag it already carries, if any, and otherwise from its use case as GOVERNANCE.md 5 classifies it.

  @URT-01 @build
  Scenario: The app always answers t2 when recorded is t2 and role is framework
    Given the model in app/src/UorRepoTier.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @URT-02 @build
  Scenario: The app never answers t1 when recorded is none and role is experiment
    Given the model in app/src/UorRepoTier.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @URT-03 @build
  Scenario: The app always answers t3 when recorded is none and role is website
    Given the model in app/src/UorRepoTier.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003
