Feature: views

  The stakeholder views: one ISO/IEC/IEEE 42010 viewpoint and view per
  stakeholder the Foundation's governance names, projected by views/project.mjs
  from pinned sources and written by views/catalog.mjs into
  app/src/Viewpoints.lex.tex, the Pages site under site/views/ and the Discord
  digest views/discord.json.

  @SV-01 @build
  Scenario: The stakeholder views are a valid ISO/IEC/IEEE 42010 architecture description: each stakeholder has one viewpoint governing one view, every concern is held by a declared stakeholder, framed by its viewpoint and addressed in its view, and every metrics model, decision and stakeholder is addressed or carried as an open claim
    Given the views in app/src/Viewpoints.lex.tex
    When the Lean kernel checks viewsValidHolds during prismpm verify
    Then viewsValid holds of the stakeholders, concerns, viewpoints, views and open claims

  @SV-02 @build
  Scenario: Every stakeholder is a role its pinned source names, declared with the quote, the source commit and its digest, and an agent acts on behalf of a declared stakeholder (PROV-O actedOnBehalfOf)
    Given views/register.json projected from the pinned sources
    When the views module is read
    Then every stakeholder is declared with its quote and its source's commit and digest
    And the agent contributor's principal is the contributor

  @SV-03 @build
  Scenario: The Pages views, their Markdown twins, llms.txt and the Discord digest are generated from the stakeholder register, and a surface that differs from the register's catalog fails the gate
    Given views/register.json and chaoss/register.json
    When views/catalog.mjs --check runs
    Then every generated surface matches the catalog
    And a page edited by hand is refused and named

  @SV-04 @open
  Scenario: A user-story role no Foundation stakeholder holds, a metrics model that states no user story, and a stakeholder no model or decision addresses are carried as open claims, never guessed
    Given the refusals in views/register.json
    When the views module is read
    Then each refusal is an OpenClaim of the views
