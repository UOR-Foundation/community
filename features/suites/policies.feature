Feature: policies

  The Foundation's policy drafts: Articles of Amendment that give the
  Articles of Incorporation a purpose clause and state that the Corporation
  has no voting members, and the Conflict of Interest, Whistleblower and
  Document Retention and Destruction Policies, each projected by
  policies/project.mjs from the standard models and authorities pinned in
  policies/snapshot.json, nonprofit/register.json and governance/register.json,
  with the Board resolutions, the filing and the publication that would adopt
  them staged and unexecuted, and declared as Foundation.Policy.V1 records in
  app/src/Policies.lex.tex.

  @PL-01 @build
  Scenario: The policy register is valid: every clause of the four drafts cites an authority, every section of each standard model is projected by exactly one clause with its text carried verbatim except named substitutions, every Form 990 Part VI line 12a, 12b, 12c, 13 and 14 requirement and every Bylaws 10.3 requirement is covered by a clause, every record class keeps the longest period its authorities state, every staged act is unexecuted, and the counts reconcile
    Given the catalog in app/src/Policies.lex.tex
    When the Lean kernel checks registerValidHolds in the Policies catalog during prismpm verify
    Then registerValid holds of the release and every list of the register

  @PL-02 @build
  Scenario: The policy catalog declares every source of policies/register.json with the sha256 digest of the bytes read at its pinned commit or fetch, and every article and section of the IRS Sample Conflict of Interest Policy
    Given policies/register.json projected from the pinned commits and policies/snapshot.json
    When the catalog is read
    Then every source digest of the register, every snapshot fetch digest, and every sample article and section is declared

  @PL-03 @open
  Scenario: Every requirement no clause covers, every post a policy names that no one holds, every record class no pinned authority states a retention period for, and every staged act is carried as an open claim, never dropped or presumed done
    Given the requirements, posts, record classes, staged acts and claims in policies/register.json
    When the catalog is read
    Then each of them that is uncovered, unheld, unstated or unexecuted is one OpenClaim naming it, and the release counts every claim
