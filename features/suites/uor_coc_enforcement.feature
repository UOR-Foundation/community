Feature: uor_coc_enforcement

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Give the enforcement rung of the UOR Foundation Code of Conduct (Contributor Covenant 3.0) a person reaches, from the highest rung on their record, whether Community Moderators found a violation, its severity, and who decided.

  @UCE-01 @build
  Scenario: The app never answers banned when authority is other and record is clear
    Given the model in app/src/UorCocEnforcement.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @UCE-02 @build
  Scenario: The app never answers warned when finding is pending and record is clear
    Given the model in app/src/UorCocEnforcement.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @UCE-03 @build
  Scenario: The app never answers limited when finding is none and record is warned
    Given the model in app/src/UorCocEnforcement.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @UCE-04 @build
  Scenario: The app never answers warned when record is limited
    Given the model in app/src/UorCocEnforcement.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @UCE-05 @build
  Scenario: The app never answers clear when record is suspended
    Given the model in app/src/UorCocEnforcement.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005

  @UCE-06 @build
  Scenario: The app always answers banned when finding is violation and authority is moderators and severity is severe
    Given the model in app/src/UorCocEnforcement.lex.tex
    When the Lean kernel checks inv006Holds during prismpm verify
    Then no request meets breaksInv006

  @UCE-07 @build
  Scenario: The app always answers banned when record is banned
    Given the model in app/src/UorCocEnforcement.lex.tex
    When the Lean kernel checks inv007Holds during prismpm verify
    Then no request meets breaksInv007
