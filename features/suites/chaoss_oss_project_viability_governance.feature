Feature: chaoss_oss_project_viability_governance

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: The ISO/IEC 15939 indicator of the CHAOSS metrics model OSS Project Viability: Governance: from how many of its 8 metrics have an admitted observation and how many were refused, tell whether its information need is answered, partly answered, unmeasured or an open claim.

  @COPVG-01 @build
  Scenario: The app never answers complete when refused is at least 1
    Given the model in app/src/ChaossOssProjectViabilityGovernance.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @COPVG-02 @build
  Scenario: The app never answers complete when admitted is below 8
    Given the model in app/src/ChaossOssProjectViabilityGovernance.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @COPVG-03 @build
  Scenario: The app always answers complete when refused equals 0 and admitted is at least 8
    Given the model in app/src/ChaossOssProjectViabilityGovernance.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @COPVG-04 @build
  Scenario: The app never answers unmeasured when admitted is at least 1 and refused equals 0
    Given the model in app/src/ChaossOssProjectViabilityGovernance.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004
