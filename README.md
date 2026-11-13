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
| Decision apps | 28 decisions in one application: the TOC lifecycle, the repository files, protection, standards and naming norms, the Code of Conduct ladder, PROV-O contribution attribution, the Discord read policy, CHAOSS observation admission, and one ISO/IEC 15939 indicator per CHAOSS metrics model. A router answers `<app> <fields>` | `apps/*.prompt.json`, `app/src/Uor*.lex.tex`, `app/src/Chaoss*.lex.tex` |
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

## The decision apps

Each decision is one `prism/prompt/1` in `apps/`: a DMN 1.5 decision table, an
XACML 3.0 policy decision or a UML 2.5.1 state machine, every rule citing its
source. `apps/indicators.mjs` writes one indicator prompt per CHAOSS metrics
model from the register, and the Prism-DevRel builder's `build-set` writes
every app into the one `app/`, with a router as the project's application
root, so the template's own gate verifies and publishes all of them
([ADR 0001](docs/decisions/0001-one-app-many-decisions.md)).

```sh
apps/build.sh            # regenerate every app, in the locked SDK
apps/build.sh --check    # fail if a generated file is stale
```

## Where this is going

This is the first part of the full model. The plan, including every facet, the
standards each one implements and how each stakeholder sees the model, is
tracked in the project. The next parts are:

- the ISO/IEC 15939 measurement mapping of every metric and model;
- the GrimoireLab oracle in `standards.lock`.

Built from [UOR-Foundation/template](https://github.com/UOR-Foundation/template);
[AGENTS.md](AGENTS.md) holds rules R1 to R6. Licensed under
[MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).
