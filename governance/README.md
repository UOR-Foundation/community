# Foundation governance register

`Foundation.Governance.V1` is projected, never hand-written. The sources are the UOR Foundation Bylaws, `governance/GOVERNANCE.md`, `toc/README.md`, `STANDARDS.md`, the Code of Conduct, `SECURITY.md`, `CONTRIBUTING.md` and the CHANGELOG in UOR-Foundation/.github, plus the Board in UOR-Foundation/website `src/about/content.ts`. Each is read from git at the commit `sources.json` pins.

```sh
node governance/project.mjs <checkouts-dir> [--check]   # pinned sources -> register.json (needs git and pdftotext)
node governance/catalog.mjs [--check]                    # register.json -> app/src/Foundation/Governance/V1/Model.lex.tex and app/src/Governance.lex.tex
```

`<checkouts-dir>` holds a clone of each repository, named `dotgithub` and `website`. The register records the pdftotext version that read the Bylaws.

## Standards

| What | Standard |
| --- | --- |
| Foundation, Board, committees (`subOrganizationOf`), posts, roles, holdings, memberships | W3C ORG |
| People | Schema.org `Person` |
| Agents | Schema.org `SoftwareApplication` |
| An agent working for a person | W3C PROV-O `actedOnBehalfOf`, one delegation per agent, person and repository, counted in commits |

An identity is software when GitHub says so (an App login ending in `[bot]`) or when `agents.json` lists it with the vendor page that declares it. Every other identity is a Person. A commit's author is responsible for the commit, and a software co-author acts on that author's behalf.

## What is checked

`registerValidHolds` is proved by `decide` in `prismpm verify` (GV-01, GV-04). It checks that:

- every reference between records resolves;
- every rule that decides something belongs to a body that has a quorum rule;
- every TOC stage decision is a vote of the Technical Oversight Committee;
- each Board position from Bylaws 4.3 is held by exactly one person;
- the Board's size is within Bylaws 4.2;
- only a Person holds a post or a role;
- every delegation runs from a SoftwareApplication to a Person.

Anything a source leaves unfilled becomes an open claim (GV-03), not a guess:

- an established committee whose members no source names, or a committee no source establishes;
- an officer or chair post no source names a holder for;
- a role no source names a holder for;
- a governance link that resolves to nothing;
- an escalation path that points at a document with no section for it;
- an agent commit with no person behind it;
- every Bylaws "Notice:".

## Planted defect

2026-11-13, patched SDK `sha256:3dfa5f72…`. The Cursor agent was edited in `register.json` from `SoftwareApplication` to `Person`, and the catalog was regenerated. `prismpm --project app verify` then failed:

> LLV7002: Tactic `decide` proved that the proposition `Foundation.Governance.V1.Model.registerValid release provisions … = true` is false (PP5001)

After `register.json` was restored, both `--check` runs passed again, and `just vv` passed with attestation `c3dcf3a4…`.
