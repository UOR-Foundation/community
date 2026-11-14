Feature: chaoss_collaboration_development_index

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: The ISO/IEC 15939 indicator of the CHAOSS metrics model Collaboration Development Index: from how many of its 5 metrics have an admitted observation and how many were refused, tell whether its information need is answered, partly answered, unmeasured or an open claim.

  @CCDI-01 @build
  Scenario: The app never answers complete when refused is at least 1
    Given the model in app/src/ChaossCollaborationDevelopmentIndex.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @CCDI-02 @build
  Scenario: The app never answers complete when admitted is below 5
    Given the model in app/src/ChaossCollaborationDevelopmentIndex.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @CCDI-03 @build
  Scenario: The app always answers complete when refused equals 0 and admitted is at least 5
    Given the model in app/src/ChaossCollaborationDevelopmentIndex.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @CCDI-04 @build
  Scenario: The app never answers unmeasured when admitted is at least 1 and refused equals 0
    Given the model in app/src/ChaossCollaborationDevelopmentIndex.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004
