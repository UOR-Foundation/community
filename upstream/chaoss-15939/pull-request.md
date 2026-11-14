<!-- Draft for chaoss/community. Not submitted: it opens only after Alex approves. Every commit carries Signed-off-by (DCO), as CONTRIBUTING.md requires. -->
# Add ISO/IEC 15939 measurement elements to the metric and metrics model templates

## What this changes

* `community-templates/metric-template.md`: a **Measurement Specification** subsection under *Want to Know More?*, beside Data Collection Strategies, Filters and Visualizations, with five one-line fields: Entity, Attribute, Measurement Method, Scale and Unit.
* `community-templates/metrics-model-template.md`: **What We Want to Measure** before the metrics list, and **Measurement Function** and **Decision Criteria** after it.

Like the template's other *encouraged* parts, the new fields are optional, and ‘Not specified’ is a valid answer, so no released metric becomes non-conforming.

## Why

CHAOSS metrics answer a question, and ISO/IEC 15939 is the standard that says what else a measure has to state for two tools to compute it the same way. Mapped onto the 15939 information model, the 98 released metrics and 19 metrics models state 329 of their 800 elements. 428 of the 471 open elements have no template section to go in: Entity (88), Attribute (88), Scale (88), Unit (88), Measurement Function (19), Decision Criteria (19), plus 38 that GrimoireLab panels cite without singling one computation out.

We checked what GrimoireLab 1.23.0 computes for the metrics whose definitions cite a GrimoireLab panel. It settles 3 elements; for the rest, a dashboard computes several things and nothing names which one is the metric. These fields let a working group say so once, in the definition.

## How it was produced

The mapping and this draft are generated, not hand-written: [UOR-Foundation/community](https://github.com/UOR-Foundation/community), `chaoss/measurement.mjs`, `chaoss/oracle.mjs` and `chaoss/upstream.mjs`, over the working-group repositories pinned to commits in `chaoss/sources.json` and GrimoireLab pinned in `chaoss/oracle-sources.json`. Each element cites the file and the sha256 of the text it was read from.

## Checklist

- [ ] Commits signed off (DCO)
- [ ] No HTML added beyond what the template already uses
- [ ] Working groups notified through their revising-metric issues (drafts in `upstream/chaoss-15939/issues/`)
