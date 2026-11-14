Feature: interventions

  Community interventions: each CHAOSS value series of observations/evaluate.mjs
  at the ISO 8601 week grain drawn as an ISO 7870-2:2023 individuals control
  chart by interventions/project.mjs, its signal decided by
  uor-intervention-signal, each intervention automation/interventions.json
  proposes for a signal admitted by uor-intervention-admission, and each
  effect decided by uor-intervention-effect. automation/interventions.mjs
  carries out only what the admission app permits, and never speaks to people.

  @IV-01 @build
  Scenario: The interventions register is the projection of the observation corpus evaluated at the ISO 8601 week grain, the intervention catalog, the approvals and the three intervention prompts, each prompt answering every example it states and holding every property over its whole request space; a register that differs fails the gate
    Given interventions/register.json and its inputs
    When interventions/project.mjs --check runs
    Then it passes
    And a register whose proposal admission was edited by hand is refused

  @IV-02 @build
  Scenario: Every chart's signal is the uor-intervention-signal answer on its ISO 7870-2:2023 individuals chart: limits are the mean of the weeks before the nine-week window plus or minus 2.66 times their mean moving range, test 1 is on the latest complete week, test 2 is over the window, and fewer than 20 baseline weeks is insufficient
    Given the charts in interventions/register.json
    When each chart's limits and tests are recomputed from its weekly values
    Then they equal the chart's limits and request, and its signal is the app's answer

  @IV-03 @build
  Scenario: No intervention reaches a contributor, participant or partner without a human: every proposal that reaches people is denied and only drafted, an agent task opens only in UOR-Foundation/community for a proposal the trust-root approvals file approves by id, and the runner refuses a run whose register or decisions it cannot re-derive
    Given the proposals in interventions/register.json and automation/interventions.mjs
    When the admission of every proposal and the acts of the runner are read
    Then no proposal that reaches people is permitted, and the runner opens issues only in its own repository
    And the approvals file is in the trust root

  @IV-04 @build
  Scenario: Every enacted intervention's effect, and every untreated signal onset in each chart's history, is the uor-intervention-effect answer over the first nine complete weeks after it against the limits frozen at its signal, so an intervention's effect is read against what untreated signals did
    Given the effects and untreated onsets in interventions/register.json
    When each is recomputed from its chart
    Then its request and effect are the app's

  @IV-05 @open
  Scenario: The three intervention apps are re-checked by the pinned builder on every run but are not yet in apps/set.json, so no Lean proof covers them; a chart of an average or a ratio with a week of no value, and the Discord guild until a chat computation is bound, are carried as refusals, never charted
    Given apps/set.json and the refusals in interventions/register.json
    When the intervention apps and the charts are read
    Then no intervention app is in the set, and every gapped chart is a refusal
