Feature: uor_remediation_lifecycle

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Give the next step of a repository's remediation from its step now, the Organization Owner's approval, its pull request, the settings only the owner applies, and what the decision apps find on a fresh observation.

  @URL-01 @build
  Scenario: The app never answers opened when step is observed and approval is none
    Given the model in app/src/UorRemediationLifecycle.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @URL-02 @build
  Scenario: The app never answers conformant when step is merged and outcome is conformant
    Given the model in app/src/UorRemediationLifecycle.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @URL-03 @build
  Scenario: The app always answers declined when step is declined
    Given the model in app/src/UorRemediationLifecycle.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @URL-04 @build
  Scenario: The app never answers conformant when step is applied and outcome is unobserved
    Given the model in app/src/UorRemediationLifecycle.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @URL-05 @build
  Scenario: The app always answers conformant when step is conformant
    Given the model in app/src/UorRemediationLifecycle.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005

  @URL-06 @build
  Scenario: The app always answers declined when step is declined
    Given the model in app/src/UorRemediationLifecycle.lex.tex
    When the Lean kernel checks inv006Holds during prismpm verify
    Then no request meets breaksInv006
