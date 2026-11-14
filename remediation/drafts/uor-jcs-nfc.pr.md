## Description

Brings UOR-Foundation/uor-jcs-nfc up to the repository standards of UOR-Foundation/.github. It carries no tier tag. The uor-repo-tier app proposes Tier 1 (core framework and critical specs) from its use case, spec: description: "Specification, reference implementation, and conformance suite for UOR's RFC 8785 JCS + Unicode NFC JSON digest context". Maintainers who record another tier tag change every requirement below; the change set is re-projected from it.

- Add .github/CODEOWNERS naming @afflom (GOVERNANCE.md 6.1)
- Add the CI workflow .github/workflows/conformance.yml: the conformance run README.md states, under CPython 3.12 (Unicode 15.0.0, SPEC.md 1.3) (GOVERNANCE.md 6.1)

The repository settings in the linked issue (topics, the branch ruleset and any rename) need admin rights, so an Organization Owner applies them outside this pull request.

Closes #{issue}

## Review Checklist

- [x] **Linked Issue** — This PR references an Issue (`Closes #{issue}`)
- [x] **Description** — PR description explains what changed and why
- [x] **Tests** — New/updated tests cover changes; all tests pass
- [ ] **CI Passing** — All automated checks green
- [x] **Documentation** — Public API changes documented; README updated if needed
- [ ] **CHANGELOG** — Entry added for this change (Tier 1–2)
- [x] **Compatibility** — No breaking changes, or `BREAKING CHANGE` documented
- [x] **Security** — No new secrets committed; dependencies audited
- [x] **Proof Verification** — Lean 4 / Coq compiles with zero sorrys (Tier 1 proofs only)
- [x] **Commit History** — Conventional Commits followed; history clean
