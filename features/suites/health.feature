Feature: health

  Community health: each CHAOSS metrics model's ISO/IEC 15939 indicator, a
  DMN 1.5 decision table in apps/chaoss-*.prompt.json, evaluated by
  health/project.mjs for every subject and period of observations/register.json
  on the observations uor-observation-admission admitted, and declared by
  health/catalog.mjs as Foundation.Health.V1 records in app/src/Health.lex.tex.

  @HL-01 @build
  Scenario: Every health assessment's answer is its metrics model's indicator answer: the compiled judge of that model's decision app, applied to the assessment's admitted and refused counts
    Given the assessments in app/src/Health.lex.tex
    When the Lean kernel checks registerValidHolds in the Health catalog during prismpm verify
    Then every assessment's outcome is the answer of its indicator app's judge on its counts

  @HL-02 @build
  Scenario: Every health assessment's counts are exactly what its evidence rows admit and refuse, plus the members the CHAOSS register carries as open claims; each row is a distinct observable base measure of the indicator, and a row with a computed value has a permitted observation
    Given the assessments and evidence rows in app/src/Health.lex.tex
    When the Lean kernel checks registerValidHolds in the Health catalog during prismpm verify
    Then tallied holds of every assessment and the run of evidence rows that names it

  @HL-03 @build
  Scenario: The health register is the projection of the CHAOSS, ecosystem and observation registers and the indicator prompts, evaluated as DMN 1.5 first-hit decision tables that answer every example their prompts state, and the Health catalog is its catalog; a register or catalog that differs fails the gate
    Given health/register.json and its inputs
    When health/project.mjs --check and health/catalog.mjs --check run
    Then both pass
    And an assessment whose outcome was edited by hand is refused

  @HL-04 @build
  Scenario: Every stakeholder view shows the current health of each metrics model it holds, and the health page, its Markdown twin and the Discord digest carry every indicator's answers, all generated from the health register
    Given health/register.json and the stakeholder views
    When views/catalog.mjs --check runs
    Then every view's metrics model shows its health, and the health page and the Discord digest name every indicator

  @HL-05 @open
  Scenario: A registered repository the observation corpus never reached, a metrics model with no indicator app, and an observation of a subject outside the ecosystem register are carried as open claims, never assessed by default
    Given the refusals in health/register.json
    When the Health catalog is read
    Then each refusal is an OpenClaim of the Health register
