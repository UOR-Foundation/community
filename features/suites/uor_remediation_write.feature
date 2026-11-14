Feature: uor_remediation_write

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Decide, as an XACML 3.0 policy decision point, whether a remediation change may be written to a UOR Foundation repository, from who acts, what kind of change it is, the repository's state, whether an Organization Owner approved it, and the route it takes.

  @URW-01 @build
  Scenario: The app never answers permit when approval is none and actor is agent
    Given the model in app/src/UorRemediationWrite.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @URW-02 @build
  Scenario: The app never answers permit when change is file and route is direct
    Given the model in app/src/UorRemediationWrite.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @URW-03 @build
  Scenario: The app never answers permit when change is ruleset and actor is agent
    Given the model in app/src/UorRemediationWrite.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @URW-04 @build
  Scenario: The app always answers permit when actor is agent and change is file and repository is live and approval is given and route is pull-request
    Given the model in app/src/UorRemediationWrite.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004
