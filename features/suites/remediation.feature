Feature: remediation

  The ecosystem remediation: for every repository of ecosystem/register.json, the
  change set the repo-files, repo-protection, repo-standards and repo-naming
  decision apps require, found by remediation/project.mjs as the nearest request
  each app decides conformant, written as data in remediation/register.json, as
  one issue draft per repository in remediation/drafts/, and as
  Foundation.Remediation.V1 records in app/src/Remediation.lex.tex.

  @RM-01 @build
  Scenario: The remediation register is valid: every repository is projected at one tier exactly when its tier is recorded and at every tier otherwise, a repository without a recorded tier names its tier as an open decision, and each repository's counts of changes, decisions and findings are the records that name it
    Given the catalog in app/src/Remediation.lex.tex
    When the Lean kernel checks registerValidHolds in the Remediation catalog during prismpm verify
    Then registerValid holds of the release, its repositories, its changes and its open claims

  @RM-02 @build
  Scenario: The remediation catalog declares every repository of remediation/register.json at the commit it was observed at, every change that applies at every tier, one issue draft per repository, and the digests of the ecosystem register, the observations and every pinned source and decision app
    Given remediation/register.json projected from the ecosystem register, the observations and the pinned sources
    When the catalog and the drafts are read
    Then every repository, commit and change is declared, every repository has a draft, and every digest is declared

  @RM-03 @open
  Scenario: A change only a maintainer or owner can decide, and a norm no change can reach, is carried as an open claim with its evidence, never defaulted; no change is applied to another repository until the Foundation's owners approve it
    Given the repositories and refusals in remediation/register.json
    When the catalog is read
    Then every decision and finding of every repository is one OpenClaim and the release counts it
