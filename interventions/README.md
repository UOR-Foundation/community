# Community interventions

Whether CHAOSS measurement can drive the community, and what it did when it
did. Every weekly CHAOSS value series of the Foundation is drawn as an ISO
7870-2:2023 individuals control chart; a special cause the chart signals
proposes interventions; and an enacted intervention's effect is decided by the
same chart over the weeks after it, against what untreated signals did.

```
node interventions/project.mjs [--check]                 # interventions/register.json
node automation/interventions.mjs [--dry-run] [--events <file.jsonl>]
```

The policy (`automation/interventions.json`, the three prompts and the
approvals) is in the trust root; see automation/AUTOMATION.md, I1 to I4. The
runner never speaks to people: what would reach a contributor, participant or
partner is only ever a draft for Alex.

## Inputs

| Input | What it gives |
| --- | --- |
| `observations/evaluate.mjs` at the week grain | every oracle computation's value per subject and ISO 8601 week, from admitted observations of the pinned corpus |
| `automation/intervention-signal.prompt.json` | the signal of a chart: ISO 7870-2:2023 tests 1 and 2, or insufficient below 20 baseline weeks |
| `automation/intervention-admission.prompt.json` | whether the runner may carry out a proposal |
| `automation/intervention-effect.prompt.json` | what an intervention, or an untreated signal, did over the next nine weeks |
| `automation/interventions.json` | the chart parameters and the actions a signal proposes |
| `automation/intervention-approvals.json` | Alex's approvals of exact proposals, and when a people proposal was sent |

## The chart

A series is one oracle computation of one subject over its complete weeks,
from its first item to the week before the cut. A week with no item is 0 for
a count, a cardinality or a sum, as an Elasticsearch date_histogram with
min_doc_count 0 draws it; an average or a ratio with such a week is refused,
never filled. The window is the last nine complete weeks, the baseline every
week before it. Limits are the baseline mean plus or minus 2.66 times its mean
moving range. Test 1 is the latest week beyond a limit, test 2 the nine
window weeks all on one side of the centre line.

## Planted defects

| Planted defect | Gate | Diagnostic | Restored |
| --- | --- | --- | --- |
| One proposal's `"admission": "deny"` in a copy of `interventions/register.json` edited to `permit` | `cargo test --test interventions interventions_iv_01` | `interventions/register.json is not the projection of the observations and the intervention policy` | passes |
| One chart's `"signal": "fall"` in `interventions/register.json` edited to `steady` | `cargo test --test interventions interventions_iv_02` | `UOR-Foundation/.github\|[null,[["git","cardinality","hash",""]]]: signal` | passes |
