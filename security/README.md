# Foundation security register

`Foundation.Security.V1` is the UOR Foundation's security and privacy risk
assessment as a Prism model. The analysis is authored once, in
`model.json`: the threat sources, the data-flow elements of the Foundation's
systems, the threat events and the controls. Everything else is projected
from it against the standards `sources.json` pins, and nothing states a
risk level by hand.

```sh
node security/observe.mjs [owner/name ...]            # GitHub traffic, own CI clones and forks -> telemetry.json
node security/project.mjs <sources-dir> [--check]     # model + telemetry + corpus + pinned standards -> register.json (needs pdftotext)
node security/catalog.mjs [--check]                   # register.json -> app/src/Foundation/Security/V1/Model.lex.tex and app/src/SecurityRegister.lex.tex
node oracles/reproject.mjs security <sources-dir>     # fetch every pinned source, check its digest, and run both --check steps
```

`oracles.yml` re-projects the register whenever its inputs change.
`security.yml` runs OpenSSF Scorecard every Monday on every repository of the
ecosystem register and keeps the scores as the run's artifact.

## Standards

| What | Standard | How it is read |
| --- | --- | --- |
| Outcomes the Foundation must achieve | NIST CSF 2.0 | NIST's CPRT export: 6 functions, 22 categories, 106 subcategories (withdrawn ones dropped) |
| Threat sources, likelihood, impact, risk | NIST SP 800-30 Rev. 1 | Tables D-2, G-5 and I-2 read from the publication with pdftotext |
| Risk response | NIST SP 800-39 | mitigate, accept, avoid, share, transfer |
| Adversary techniques | MITRE ATT&CK Enterprise 20.1, MITRE ATLAS 2026.10 | every technique named must exist and be neither revoked nor deprecated |
| Security threats per element | STRIDE per element (Microsoft SDL) | external entity S R, process S T R I D E, data store T R I D, data flow T I D |
| Privacy threats | LINDDUN | all seven categories for every element that carries personal data |
| Control status | OSCAL 1.1 implementation-status | implemented, partial, planned, alternative, not-applicable |
| Measured controls | OpenSSF Scorecard v5.6.0 | the 20 checks; `security.yml` runs the unmodified release |
| Weekly join chart | ISO 7870-2 c chart | c-bar plus three times its square root |

## What is checked

`registerValidHolds` is proved by `decide` in `prismpm verify` (SE-01). It
checks that every threat's overall likelihood is Table G-5 of its initiation
and adverse-impact likelihoods and its risk is Table I-2 of that and its
impact; that a mitigated threat has a control and an accepted one has none;
that no technique is revoked or deprecated; that every implemented or partial
control has evidence; that each of the 106 CSF 2.0 subcategories is achieved
by a control or is a gap, never both; and that every element is open to
exactly its STRIDE-per-element categories, and to every LINDDUN category when
it carries personal data, each answered by a threat or stated open. Every
walk is linear in the register's size.

The projector also refuses: a threat-source type Table D-2 does not have, a
technique ATT&CK or ATLAS does not have, a Scorecard check that does not
exist, evidence that does not resolve at its pinned commit, a pinned source
whose bytes have changed, and a threat that answers no element.

What the assessment cannot settle is an open claim (SE-03), never a guess:
organization settings agent sessions cannot read (two-factor requirement,
audit log, secret scanning, fork approval), the Supabase project's live
policies and Auth settings, the Discord guild's moderation configuration, the
domain's protection, who makes the clones the Foundation's CI does not
explain, and disinformation, which ATT&CK does not cover.

## Telemetry

Indicators are measurements read against the threat they are consistent
with, never attributions:

- unique cloners per day beyond the Foundation's own checkout jobs, per
  repository whose traffic the collecting token can read;
- the weekly member-join c chart from the Discord corpus;
- members who joined and never posted;
- AutoMod action messages in the corpus;
- identities with a single issue or pull request.

## Planted defects

2026-11-15, patched SDK `sha256:3dfa5f72…`, `lexlean verify src/SecurityRegister.lex.tex`:

1. T01's risk was edited in `register.json` from High (Table I-2 of Moderate
   likelihood and Very High impact) to Moderate and the catalog regenerated.
   Lean refused it: `LLV7002 … Tactic decide proved that the proposition … is false`.
2. A Spoofing answer was given to data flow F1, which STRIDE per element does
   not open a data flow to. Lean refused it with the same diagnostic.

With `register.json` restored, both `--check` runs passed and
`lexlean verify` passed again; with the telemetry collected the same day it passes with attestation `38598fb2…`.
