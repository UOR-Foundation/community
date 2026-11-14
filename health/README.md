# Community health

Each CHAOSS metrics model's ISO/IEC 15939 indicator, assessed for every UOR
Foundation subject (each public repository of `ecosystem/register.json`, and
the Discord guild) in every month the observation corpus spans for it.

```
node health/project.mjs     # health/register.json, from the four inputs below
node health/catalog.mjs     # app/src/Foundation/Health/V1/Model.lex.tex, app/src/Health.lex.tex
node views/catalog.mjs      # every stakeholder view, site/views/health.*, views/discord.json
```

All three take `--check`, which the `health` and `views` suites run.

## Inputs

| Input | What it gives |
| --- | --- |
| `chaoss/register.json` | each metrics model's base measures, and the members it carries as open claims (CC-03) |
| `apps/chaoss-*.prompt.json` | each model's indicator: a DMN 1.5 decision table over `admitted` and `refused` |
| `observations/register.json` | every observation with its uor-observation-admission decision, the values computed from them, and every subject-period the corpus spans |
| `ecosystem/register.json` | the registered repositories |

The CHAOSS models publish no thresholds over metric values, so an indicator
decides only whether the model's information need is answered: `complete`,
`partial`, `unmeasured`, or `open` when a base measure was refused. `admitted`
counts base measures with a permitted observation; `refused` counts those
with a refused one, plus the CC-03 open members. An indeterminate observation
counts toward neither.

## What Lean checks

`registerValidHolds` in `app/src/Health.lex.tex`, by `decide`:

- HL-01: every assessment's answer equals its indicator app's compiled
  `<app>Judge` on its two counts (the model imports every indicator module);
- HL-02: one pass over assessments and evidence rows shows each assessment's
  counts are exactly what its rows admit and refuse plus the open members,
  that its rows name distinct observable measures in order, and that a row
  with a computed value has a permitted observation.

`health/project.mjs` also answers every example each indicator prompt states,
so its first-hit evaluation and the compiled judge must agree.

## Planted defects

| Planted defect | Gate | Diagnostic | Restored |
| --- | --- | --- | --- |
| One assessment's outcome in `app/src/Health.lex.tex` changed from `answerUnmeasured` to `answerComplete` | `lexlean verify src/Health.lex.tex` in the pinned SDK | `LLV7002`: `decide` proved `registerValid … = true` is false | verifies, 23 modules |
| One `"outcome": "unmeasured"` in a copy of `health/register.json` edited to `complete` | `cargo test --test health health_hl_03` | `health/register.json is not the projection of its inputs` | passes |
