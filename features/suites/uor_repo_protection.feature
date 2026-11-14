Feature: uor_repo_protection

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Decide whether a UOR Foundation repository protects its default branch as GOVERNANCE.md 6.2 and 9 require for its tier: pull requests, approving reviews, required status checks and no force push.

  @URP-01 @build
  Scenario: The app never answers conformant when forcepush is allowed
    Given the model in app/src/UorRepoProtection.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @URP-02 @build
  Scenario: The app never answers conformant when tier is t1 and reviews is below 2
    Given the model in app/src/UorRepoProtection.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @URP-03 @build
  Scenario: The app never answers conformant when tier is t2 and checks is optional
    Given the model in app/src/UorRepoProtection.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @URP-04 @build
  Scenario: The app always answers conformant when tier is t4 and forcepush is blocked
    Given the model in app/src/UorRepoProtection.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004
