Feature: nonprofit

  The nonprofit compliance register: The UOR Foundation as the Colorado
  Secretary of State records it, the obligations of a Colorado nonprofit
  corporation organized under section 501(c)(3) with the statute, regulation,
  IRS instruction or Bylaws provision behind each and the governance post
  responsible for it, the IRS Form 990 Part VI line items, and what IRS public
  data shows, projected by nonprofit/project.mjs from nonprofit/snapshot.json
  and the pinned commits, and declared as Foundation.Nonprofit.V1 records in
  app/src/Nonprofit.lex.tex.

  @NP-01 @build
  Scenario: The nonprofit register is valid: every obligation cites the authority it names and is assigned to a governance post by a Bylaws provision, every authority is the law of the entity's jurisdiction or of the nation containing it, every open claim names a subject that exists, and the entity is recorded as IRS-recognized exactly when IRS recognition data matched it
    Given the catalog in app/src/Nonprofit.lex.tex
    When the Lean kernel checks registerValidHolds in the Nonprofit catalog during prismpm verify
    Then registerValid holds of the release and every list of the register

  @NP-02 @build
  Scenario: The nonprofit catalog declares every source of nonprofit/register.json with the sha256 digest of the bytes read at its pinned commit or fetch
    Given nonprofit/register.json projected from the pinned commits and nonprofit/snapshot.json
    When the catalog is read
    Then every source digest of the register, and every snapshot fetch digest, is declared

  @NP-03 @open
  Scenario: Every obligation not observed discharged, every Form 990 Part VI line no public source answers, every financial figure the returns need, and every status statement no authority bears out is carried as an open claim, never dropped or presumed
    Given the obligations, Part VI lines, needs, statements and claims in nonprofit/register.json
    When the catalog is read
    Then each of them that is not discharged or evidenced is one OpenClaim naming it, and the release counts every claim
