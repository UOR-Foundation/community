Feature: uor_deidentification

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Publish a collected field only as GDPR Article 4(5) pseudonymised data: suppress content, replace every identifier a platform shows only to its members with a keyed cryptographic hash (the ISO/IEC 20889 pseudonymization technique with a keyed hash, HMAC per FIPS 198-1) whose key is held apart from the corpus, and refuse to publish such an identifier when the key is missing.

  @UD-01 @build
  Scenario: The app never answers retain when role is content
    Given the model in app/src/UorDeidentification.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @UD-02 @build
  Scenario: The app never answers retain when role is direct and origin is restricted
    Given the model in app/src/UorDeidentification.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @UD-03 @build
  Scenario: The app never answers pseudonymize when key is missing and role is direct and origin is restricted
    Given the model in app/src/UorDeidentification.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003
