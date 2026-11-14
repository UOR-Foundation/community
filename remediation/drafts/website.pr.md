## Description

Brings UOR-Foundation/website up to the repository standards of UOR-Foundation/.github. It carries no tier tag. The uor-repo-tier app proposes Tier 3 (docs, websites and presentation) from its use case, website: the uor.foundation website. Maintainers who record another tier tag change every requirement below; the change set is re-projected from it.

- Add LICENSE with the SPDX MIT text (GOVERNANCE.md 13: MIT is the default), copyright 2025 The UOR Foundation

The repository settings in the linked issue (topics, the branch ruleset and any rename) need admin rights, so an Organization Owner applies them outside this pull request.

Closes #{issue}

## Review Checklist

- [x] **Linked Issue** — This PR references an Issue (`Closes #{issue}`)
- [x] **Description** — PR description explains what changed and why
- [ ] **Tests** — New/updated tests cover changes; all tests pass
- [ ] **CI Passing** — All automated checks green
- [x] **Documentation** — Public API changes documented; README updated if needed
- [x] **CHANGELOG** — Entry added for this change (Tier 1–2)
- [x] **Compatibility** — No breaking changes, or `BREAKING CHANGE` documented
- [x] **Security** — No new secrets committed; dependencies audited
- [x] **Proof Verification** — Lean 4 / Coq compiles with zero sorrys (Tier 1 proofs only)
- [x] **Commit History** — Conventional Commits followed; history clean
