Feature: uor_observation_admission

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Admit an observation of a CHAOSS metric into the UOR Foundation community model only when the metric is released, an oracle in standards.lock covers its data source, the data is pinned, the oracle's offline replay reproduces it, and the source's collection policy and the contribution attribution policy permit it.

  @UOA-01 @build
  Scenario: The app never answers permit when metric is unreleased
    Given the model in app/src/UorObservationAdmission.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @UOA-02 @build
  Scenario: The app never answers permit when oracle is not covers
    Given the model in app/src/UorObservationAdmission.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @UOA-03 @build
  Scenario: The app never answers permit when source is unpinned
    Given the model in app/src/UorObservationAdmission.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @UOA-04 @build
  Scenario: The app never answers permit when replay is not reproduced
    Given the model in app/src/UorObservationAdmission.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @UOA-05 @build
  Scenario: The app never answers permit when collection is deny
    Given the model in app/src/UorObservationAdmission.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005

  @UOA-06 @build
  Scenario: The app never answers permit when collection is outside
    Given the model in app/src/UorObservationAdmission.lex.tex
    When the Lean kernel checks inv006Holds during prismpm verify
    Then no request meets breaksInv006

  @UOA-07 @build
  Scenario: The app never answers permit when attribution is deny
    Given the model in app/src/UorObservationAdmission.lex.tex
    When the Lean kernel checks inv007Holds during prismpm verify
    Then no request meets breaksInv007

  @UOA-08 @build
  Scenario: The app always answers deny when metric is released and collection is deny
    Given the model in app/src/UorObservationAdmission.lex.tex
    When the Lean kernel checks inv008Holds during prismpm verify
    Then no request meets breaksInv008
