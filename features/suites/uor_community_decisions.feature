Feature: uor_community_decisions

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Answer each decision the UOR Foundation's governance documents and the CHAOSS metrics models ask of its community, by the app that models it, with every stated property proved in Lean.

  @UCD-01 @build
  Scenario: The architecture description declares every stakeholder, concern, component, edge, viewpoint and view it references
    Given the model in app/src/Architecture.lex.tex
    When the Lean kernel checks architectureDescriptionHolds during prismpm verify
    Then the architecture description declares every stakeholder, concern, component, edge, viewpoint and view it references

  @UCD-02 @build
  Scenario: The ISO/IEC 25010:2023 quality model declares all 9 characteristics and 40 subcharacteristics, states each subcharacteristic by a requirement or lists it open, and every parent it names is declared
    Given the model in app/src/Quality.lex.tex
    When the Lean kernel checks qualityModelHolds during prismpm verify
    Then the ISO/IEC 25010:2023 quality model declares all 9 characteristics and 40 subcharacteristics, states each subcharacteristic by a requirement or lists it open, and every parent it names is declared

  @UCD-03 @build
  Scenario: Every STRIDE category each component and data flow is open to is answered by a threat or stated open, and no other pair is stated open
    Given the model in app/src/Security.lex.tex
    When the Lean kernel checks strideEnumerated during prismpm verify
    Then every STRIDE category each component and data flow is open to is answered by a threat or stated open, and no other pair is stated open

  @UCD-04 @build
  Scenario: Every compliance obligation is numbered in order and names its evidence
    Given the model in app/src/Compliance.lex.tex
    When the Lean kernel checks everyObligationEvidenced during prismpm verify
    Then every compliance obligation is numbered in order and names its evidence
