## Description

Brings UOR-Foundation/lexlean-mcp up to the repository standards of UOR-Foundation/.github. It carries no tier tag. The uor-repo-tier app proposes Tier 2 (implementations and integrations) from its use case, integration: README: "serves LexLean to LLM clients over the Model Context Protocol". Maintainers who record another tier tag change every requirement below; the change set is re-projected from it.

- Add LICENSE naming the LICENSE-APACHE and LICENSE-MIT the repository already carries, so the file GOVERNANCE.md 6.1 names states its license and documents the exception GOVERNANCE.md 13 asks for
- Add .github/CODEOWNERS naming @afflom (GOVERNANCE.md 6.1)

The repository settings in the linked issue (topics, the branch ruleset and any rename) need admin rights, so an Organization Owner applies them outside this pull request.

Closes #{issue}

## Review Checklist

- [x] **Linked Issue** — This PR references an Issue (`Closes #{issue}`)
- [x] **Description** — PR description explains what changed and why
- [ ] **Tests** — New/updated tests cover changes; all tests pass
- [ ] **CI Passing** — All automated checks green
- [x] **Documentation** — Public API changes documented; README updated if needed
- [ ] **CHANGELOG** — Entry added for this change (Tier 1–2)
- [x] **Compatibility** — No breaking changes, or `BREAKING CHANGE` documented
- [x] **Security** — No new secrets committed; dependencies audited
- [x] **Proof Verification** — Lean 4 / Coq compiles with zero sorrys (Tier 1 proofs only)
- [x] **Commit History** — Conventional Commits followed; history clean
