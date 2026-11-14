Feature: compliance

  The compliance facet: each obligation of app/src/Compliance.lex.tex names
  its evidence, the facet predicates it cites are re-proved there by the Lean
  kernel, and the control set leaves the build as an OSCAL 1.1.0 component
  definition that the oracle standards.lock pins must accept.

  @CP-01 @build
  Scenario: The control set the verified build emits as an OSCAL 1.1.0 component definition is accepted by the locked oscal-1.1.0-structural oracle
    Given the threat model in app/src/Security.lex.tex
    When just app verifies the model and reads the build its attestation names
    Then oscal-validator accepts oscal/component-definition.json of that build
