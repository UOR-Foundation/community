Feature: uor_standard_applicability

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Decide whether one candidate standard binds one part of The UOR Foundation, from what the standard's issuer says it covers, whether it is law in a jurisdiction the Foundation is organized or operates in, whether the Foundation carries on the activity the law is conditioned on, whether the Foundation already adopts it, and which facet owns it.

  @USA-01 @build
  Scenario: The app never answers applicable when owner is security and inscope is yes
    Given the model in app/src/UorStandardApplicability.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @USA-02 @build
  Scenario: The app always answers undecided when owner is standards and scope is unread
    Given the model in app/src/UorStandardApplicability.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @USA-03 @build
  Scenario: The app always answers inapplicable when owner is standards and scope is quoted and inscope is yes and force is law and jurisdiction is foreign
    Given the model in app/src/UorStandardApplicability.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @USA-04 @build
  Scenario: The app never answers inapplicable when owner is standards and scope is quoted and inscope is yes and force is law and jurisdiction is own and activity is undetermined
    Given the model in app/src/UorStandardApplicability.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @USA-05 @build
  Scenario: The app always answers mandatory when owner is standards and scope is quoted and inscope is yes and force is law and jurisdiction is own and activity is present
    Given the model in app/src/UorStandardApplicability.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005
