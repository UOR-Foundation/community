# UOR Foundation Community

The community model of the UOR Foundation, as a Prism application. It brings
the Foundation's own norms (the Bylaws, the governance framework, the TOC
lifecycle, the repository standards and the Code of Conduct) together with
[CHAOSS](https://chaoss.community), the Linux Foundation's community health
standard, implemented in full. Each claim in it is checked by the Lean kernel
in the SDK that `prismpm.lock` pins.

**Live:** https://uor-foundation.github.io/community/

## What is in it

| Part | What it is | Where |
| --- | --- | --- |
| Application | The TOC project lifecycle: Sandbox, Incubation, Graduated and Archived, moved only by a quorate committee act on complete evidence (OMG UML 2.5.1 state machine) | `app/src/UorTocLifecycle.lex.tex`, `app/prompt.json` |
| Community facet | `Foundation.Community.V1`: CHAOSS metrics, metrics models, working groups, the release they come from and open claims, with the validity check of the register | `app/src/Foundation/Community/V1/Model.lex.tex` |
| CHAOSS register | Every released CHAOSS metric (98) and metrics model (19), each read from its working group's repository at a pinned commit and addressed by its sha256 | `chaoss/register.json`, `app/src/Chaoss.lex.tex` |
| Facets | Architecture (ISO/IEC/IEEE 42010), design (OPM, UML), features and journeys, security (STRIDE), quality (ISO/IEC 25010) and compliance | `app/src/*.lex.tex` |
| Claims | Every claim registered with its honesty level, scenario and test | `model/`, `features/`, `CONFORMANCE.md` |

## The CHAOSS register

The released set is the CHAOSS knowledge-base sitemap (`chaoss/sitemap.json`).
`chaoss/project.mjs` matches each released metric and metrics model to its
definition in the `chaoss/wg-*` repository that `chaoss/sources.json` pins.
It matches by slug, then by title, then by `chaoss/aliases.json`. Each alias
there cites where CHAOSS records the correspondence, such as "This metric was
previously called Bus Factor". An item it cannot match becomes an open claim
(`CC-03`) and is never dropped or guessed. `chaoss/catalog.mjs` writes
`app/src/Chaoss.lex.tex` from the register, and Lean proves the register valid
(`CC-01`).

```sh
# check out every pinned working group under target/chaoss, then
node chaoss/project.mjs target/chaoss          # rewrite chaoss/register.json
node chaoss/catalog.mjs                        # rewrite app/src/Chaoss.lex.tex
just vv                                        # the whole gate, in the locked SDK
```

## Where this is going

This is the first part of the full model. The plan, including every facet, the
standards each one implements and how each stakeholder sees the model, is
tracked in the project. The next parts are:

- the ISO/IEC 15939 measurement mapping of every metric and model;
- the remaining decision apps (repository norms, Code of Conduct ladder, PROV-O
  attribution, Discord read policy and observation admission), which are
  already verified as examples in
  [Prism-DevRel](https://github.com/afflom/prism-devrel);
- the GrimoireLab oracle in `standards.lock`.

Built from [UOR-Foundation/template](https://github.com/UOR-Foundation/template);
[AGENTS.md](AGENTS.md) holds rules R1 to R6. Licensed under
[MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).

## Product facets

The facet modules (`app/src/Quality.lex.tex`, `Security.lex.tex`, `Compliance.lex.tex`) are written by the prism-devrel builder from `app/prompt.json`. Quality declares the whole ISO/IEC 25010:2023 model (9 characteristics, 40 subcharacteristics) and proves each subcharacteristic is stated by a requirement or listed open. Security enumerates STRIDE per element over every component and data flow and proves each pair is answered by a threat or stated open; the open count is pinned by `strideOpenCount`. Compliance re-proves every facet predicate it cites. `just app` then runs the locked `oscal-1.1.0-structural` oracle on the OSCAL 1.1.0 component definition the verified build emits (`CP-01`).

Planted defect for `CP-01`: the emitted `oscal/component-definition.json` with `"oscal-version":"1.1.0"` changed to `1`. `oscal-validator` printed "OSCAL 1.1.0 JSON structural validation rejected the subject" and exited 4, which fails `just app`. With the file restored, it reports `"valid":true` and `just vv` passes.
