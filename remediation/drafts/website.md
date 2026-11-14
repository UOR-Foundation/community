---
name: Feature Request
about: Propose a new feature or enhancement
labels: enhancement
---

## Problem

UOR-Foundation/website does not yet meet the repository standards of UOR-Foundation/.github (STANDARDS.md, GOVERNANCE.md 6.1, 6.2, 8 and 11) at commit `1008c3b09892` of `main`.

Its outcome from each decision app, at every tier, because it carries no tier tag (unobserved: the outcome depends on state that could not be read):

| Tier | uor-repo-files | uor-repo-protection | uor-repo-standards | uor-repo-naming |
|---|---|---|---|---|
| t1 | missing-file | unobserved | untagged | nonconforming |
| t2 | missing-file | unobserved | untagged | nonconforming |
| t3 | missing-file | unobserved | untagged | nonconforming |
| t4 | missing-file | unobserved | untagged | nonconforming |

## Proposed Solution

### Every tier

- Add LICENSE with the SPDX MIT text (GOVERNANCE.md 13), copyright year 2025 (needs: copyright-holder)
- Block force pushes to the default branch
- Add topic uor
- Add topic uor-foundation
- Add topic typescript: GitHub's primary language is TypeScript, which Linguist names typescript

### Decisions

- **branches**: Which of its non-conforming branches are renamed and which deleted?
- **check-contexts**: Which status checks must pass? The draft ruleset lists the jobs its pull-request workflows run.
- **codeowners**: Who are its maintainers, for .github/CODEOWNERS?
- **copyright-holder**: Who holds the copyright the LICENSE names?
- **domain**: Which Domain topics apply? (math, cryptography, computation, visualisation, documentation, governance, protocol; all that apply)
- **status**: Which status is it: active, maintenance or deprecated? (GOVERNANCE.md 11, STANDARDS.md Status)
- **tier**: Which tier is it? GOVERNANCE.md 5: Tier 1 core framework and critical specs; Tier 2 implementations and integrations; Tier 3 docs, websites and presentation; Tier 4 early experiments.

### By tier

<details><summary>t1 (tier-1-core)</summary>

- Add .github/CODEOWNERS naming the repository's maintainers (GOVERNANCE.md 6.1)
- Require a pull request before merging to the default branch
- Require at least 2 approving reviews
- Require status checks to pass before merging (needs: check-contexts)
- Add topic tier-1-core
- Carry exactly one status tag (now 0)
- Rename or delete the branches not named {type}/{issue#}-{short-description}: 3 of 3
- Add every Domain topic that applies, from: math, cryptography, computation, visualisation, documentation, governance, protocol

Topics (`PUT /repos/UOR-Foundation/website/topics`):

```json
{"names":["tier-1-core","typescript","uor","uor-foundation"]}
```

Ruleset (`POST /repos/UOR-Foundation/website/rulesets`):

```json
{
  "name": "governance-6.2-t1",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": [
        "~DEFAULT_BRANCH"
      ],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 2,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": []
      }
    },
    {
      "type": "non_fast_forward"
    }
  ]
}
```

</details>

<details><summary>t2 (tier-2-impl)</summary>

- Add .github/CODEOWNERS naming the repository's maintainers (GOVERNANCE.md 6.1)
- Require a pull request before merging to the default branch
- Require at least 1 approving review
- Require status checks to pass before merging (needs: check-contexts)
- Add topic tier-2-impl
- Carry exactly one status tag (now 0)
- Rename or delete the branches not named {type}/{issue#}-{short-description}: 3 of 3
- Add every Domain topic that applies, from: math, cryptography, computation, visualisation, documentation, governance, protocol

Topics (`PUT /repos/UOR-Foundation/website/topics`):

```json
{"names":["tier-2-impl","typescript","uor","uor-foundation"]}
```

Ruleset (`POST /repos/UOR-Foundation/website/rulesets`):

```json
{
  "name": "governance-6.2-t2",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": [
        "~DEFAULT_BRANCH"
      ],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": []
      }
    },
    {
      "type": "non_fast_forward"
    }
  ]
}
```

</details>

<details><summary>t3 (tier-3-presentation)</summary>

- Require a pull request before merging to the default branch
- Require at least 1 approving review
- Require status checks to pass before merging (needs: check-contexts)
- Add topic tier-3-presentation
- Carry exactly one status tag (now 0)
- Rename or delete the branches not named {type}/{issue#}-{short-description}: 3 of 3
- Add every Domain topic that applies, from: math, cryptography, computation, visualisation, documentation, governance, protocol

Topics (`PUT /repos/UOR-Foundation/website/topics`):

```json
{"names":["tier-3-presentation","typescript","uor","uor-foundation"]}
```

Ruleset (`POST /repos/UOR-Foundation/website/rulesets`):

```json
{
  "name": "governance-6.2-t3",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": [
        "~DEFAULT_BRANCH"
      ],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": []
      }
    },
    {
      "type": "non_fast_forward"
    }
  ]
}
```

</details>

<details><summary>t4 (tier-4-experimental)</summary>

- Add topic tier-4-experimental
- Carry exactly one status tag (now 0)
- Rename or delete the branches not named {type}/{issue#}-{short-description}: 3 of 3
- Add every Domain topic that applies, from: math, cryptography, computation, visualisation, documentation, governance, protocol

Topics (`PUT /repos/UOR-Foundation/website/topics`):

```json
{"names":["tier-4-experimental","typescript","uor","uor-foundation"]}
```

Ruleset (`POST /repos/UOR-Foundation/website/rulesets`):

```json
{
  "name": "governance-6.2-t4",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": [
        "~DEFAULT_BRANCH"
      ],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "non_fast_forward"
    }
  ]
}
```

</details>

## Alternatives Considered

- website is not in the preferred uor-{domain}-{function} form; a new name is a maintainer decision
- 9510 of 9525 default-branch commits are not Conventional Commits; history is not rewritten, so the naming app cannot find the repository conformant

## Additional Context

Generated by UOR-Foundation/community `remediation/project.mjs` from `remediation/register.json`. Each change is the nearest request the decision app finds conformant, and is decided again by the app before it is written. Branch protection was not readable without admin rights, so the ruleset is the state the tier requires, not a difference from the current one.
