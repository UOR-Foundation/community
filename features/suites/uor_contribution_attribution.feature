Feature: uor_contribution_attribution

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Permit crediting a contribution to a person in the CHAOSS contributor metrics when its PROV-O agent is a resolved person, or a software agent whose prov:actedOnBehalfOf names a resolved person with the delegation recorded in the contribution; deny unattributed software work; not applicable for organizations.

  @UCA-01 @build
  Scenario: The app never answers permit when agent is software and delegation is absent
    Given the model in app/src/UorContributionAttribution.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @UCA-02 @build
  Scenario: The app never answers permit when agent is software and trail is missing
    Given the model in app/src/UorContributionAttribution.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @UCA-03 @build
  Scenario: The app never answers permit when agent is software and principal is organization
    Given the model in app/src/UorContributionAttribution.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @UCA-04 @build
  Scenario: The app never answers permit when identity is unresolved
    Given the model in app/src/UorContributionAttribution.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @UCA-05 @build
  Scenario: The app always answers permit when agent is person and identity is resolved
    Given the model in app/src/UorContributionAttribution.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005
