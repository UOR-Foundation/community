Feature: security

  The UOR Foundation's security and privacy risk assessment: the threat
  sources, data-flow elements, threat events and controls authored in
  security/model.json, projected by security/project.mjs against NIST CSF 2.0,
  NIST SP 800-30 Rev. 1, MITRE ATT&CK 20.1 and ATLAS 2026.10, STRIDE per
  element, LINDDUN and OpenSSF Scorecard v5.6.0 at the digests
  security/sources.json pins, and declared as Foundation.Security.V1 records in
  app/src/SecurityRegister.lex.tex.

  @SE-01 @build
  Scenario: The Foundation security register is valid: every threat's overall likelihood and risk are NIST SP 800-30 Tables G-5 and I-2 of its levels; every mitigated threat has a control and every accepted one none; no technique is revoked or deprecated; every implemented or partial control has evidence; every NIST CSF 2.0 subcategory is achieved by a control or is a gap, never both; and every element is open to exactly its STRIDE-per-element categories and, when it carries personal data, every LINDDUN category, each answered by a threat or stated open
    Given the catalog in app/src/SecurityRegister.lex.tex
    When the Lean kernel checks registerValidHolds during prismpm verify
    Then registerValid holds of the release and every list of the register

  @SE-02 @build
  Scenario: The security catalog is the projection of security/model.json against the standards security/sources.json pins: CSF 2.0's 6 functions, 22 categories and 106 subcategories, SP 800-30's Table G-5 and I-2 cells, and every named ATT&CK 20.1 or ATLAS technique and Scorecard check, each declared with the digest of its pinned source
    Given security/register.json projected from the pinned sources
    When the catalog is read
    Then every subcategory, table cell, technique and check is declared, and the release names every pinned source by its digest

  @SE-03 @open
  Scenario: What the assessment could not settle (an organization setting, a provider's live configuration, who makes a clone) is an open claim, and every telemetry indicator is carried with the threat it is consistent with, never as an attribution
    Given the open claims and indicators in security/register.json
    When the catalog is read
    Then each is declared once and the release counts it
