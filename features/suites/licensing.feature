Feature: licensing

  The licensing register: every public UOR-Foundation repository of ecosystem/snapshot.json,
  pinned at its default-branch commit by licensing/snapshot.mjs, observed with the FSFE REUSE
  tool and the SPDX License List matching guidelines by licensing/scan.mjs, checked against the
  Foundation's license policy by licensing/project.mjs, and declared as Foundation.Licensing.V1
  records in app/src/Licensing.lex.tex.

  @LC-01 @build
  Scenario: The licensing register is valid: every declared license identifier is a License record taken from the pinned SPDX License List, a repository is REUSE compliant exactly when every count the REUSE tool holds against compliance is zero and every file carries copyright and licensing information, every non-compliant repository is named by an open claim, and the counts reconcile with the release
    Given the catalog in app/src/Licensing.lex.tex
    When the Lean kernel checks registerValidHolds in the Licensing catalog during prismpm verify
    Then registerValid holds of the release, its licenses, rules, repositories, declarations, declared identifiers and open claims

  @LC-02 @build
  Scenario: The licensing catalog declares the REUSE tool version and wheel digest, the SPDX License List version and digests, the digests of the scan, snapshot and policy sources, and the commit of every repository it observed
    Given licensing/register.json projected from licensing/scan.json and the pinned sources
    When the catalog is read
    Then the tool, list, input and source digests and every repository commit are declared

  @LC-03 @open
  Scenario: A repository the REUSE tool does not find compliant, a declaration the Foundation's license policy or website does not allow, a missing or unidentified LICENSE text, and an identifier off the SPDX License List are carried as open claims citing both sources, never dropped or guessed
    Given the repositories, declarations and refusals in licensing/register.json
    When the catalog is read
    Then every non-compliant repository and every non-conforming declaration is named by one OpenClaim of its kind
