# Automated development

The goal: agents never wait on Alex for work Alex alone owns, and nothing
that needs a human moves without one. Every rule below is a rule of one of
two decision apps; this page names them and says where the human gates are.
The prompts are the single source (AGENTS.md R1), and each run re-checks
them before it acts.

| App | Pattern | Prompt | Decides |
| --- | --- | --- | --- |
| uor-merge-admission | OASIS XACML 3.0 policy decision | `merge-admission.prompt.json` | whether the controller approves and merges a pull request |
| uor-stack-step | OMG DMN 1.5 decision table (hit policy FIRST) | `stack-step.prompt.json` | whether a stacked pull request is retargeted, updated or escalated |

`controller.mjs` observes the facts, asks both apps with prism-code's
`respond` (the dispatch the compiled guest is checked against), and does what
they answer. `.github/workflows/automerge.yml` runs it every 30 minutes,
whenever a check suite completes or a review is submitted, and on demand,
always from the default branch's code. Other repositories in `repos.json`
call the same workflow.

## What runs on its own (A)

- **A1, merge.** An owned repository's ready pull request whose check runs
  are all green (the acceptance gate `just vv` and every oracle among them)
  and that reaches nothing in H1 to H3 is approved by the controller and
  merged with a merge commit. The review that GOVERNANCE.md 6.2 requires is
  given by the controller, as an agent acting for the Organization Owner
  (W3C PROV-O `actedOnBehalfOf`). Its review body names the request and the
  rule.
- **A2, stacks.** A pull request merges only into the default branch: one stacked on an open pull request waits. When a base merges, every pull request stacked on it is
  retargeted to that base's own base. A merge commit keeps the old head an
  ancestor, so nothing conflicts. A branch behind a strict ruleset is updated.
- **A3, escalation.** A conflict or a red check opens one `agent-task` issue
  per pull request and reason. The scheduled agent loop (a Claude scheduled
  task, daily) takes each open `agent-task` issue, fixes the head branch and
  pushes. It never skips or weakens a check, and it never touches H1 to H3.
- **A4, telemetry.** Every decision is a CloudEvents 1.0 record (JSON event
  format, type `org.uorfoundation.automation.decision`) in the run's
  `automation-events-*` artifact and job summary. The agent loop reads the
  records to find recurring denials and failing gates, and turns each one
  into the next change to the model.

## Rulesets

`remediation/apply-settings.sh` writes each repository's GOVERNANCE.md 6.2
ruleset. A ruleset requires only checks that normal pull requests are shown to
pass: the jobs that succeeded on each of the five pull requests merged most
recently into the default branch, from unfiltered workflows that exist on that
branch, and that every open ready pull request also reports. A matrix job is
never required, since a planned matrix runs different entries for different
changes. A job that only an unmerged pull request adds, or only a push runs, is
never required, and a repository with no merged pull request requires none. In
a repository listed in `repos.json` no human approval count is set, because the
controller's gate is the requirement there; elsewhere the count is at most one.
Every ruleset lets an Organization Owner bypass it (GitHub `bypass_actors`,
`OrganizationAdmin`, `always`). Where GitHub Actions committed to the default
branch in the last 90 days (a pin bump, a docs sync), the GitHub Actions app
may bypass it too, so that automation is not refused. The dry run prints the exact checks each
ruleset would require. `apply-settings` with `enforcement` set to `disabled`
or `active` switches the existing rulesets off or on and changes nothing else.

## Human gates (H)

- **H1, outside.** Nothing that speaks for Alex outside the organization:
  upstream pull requests or issues (CHAOSS, GrimoireLab and any other org),
  security advisories, and DCO `Signed-off-by` lines. A pull request carrying
  the `speaks-outside` label is always denied. Drafts for outside bodies may
  merge into this repository; sending them is Alex's act.
- **H2, secrets.** A diff that adds, removes or changes a `secrets.`
  reference or the `ORG_ADMIN_TOKEN`, or changes the scripts that apply
  organization settings with it, needs a human's approval of its exact head.
  Creating or changing a secret's value is only ever done by a human.
- **H3, trust root.** `bootstrap.yml` (the template's human-reviewed trust
  root), `automerge.yml`, `automation/**` and `CODEOWNERS` need a human's
  approval. The policy never admits a change to itself.
- **H4, shared repositories.** A repository not in `repos.json` keeps the
  review its own maintainers give. The controller answers not-applicable
  there and changes nothing. This includes the 23 per-repository standards
  pull requests.

A human approves a head in one of two ways: an approving review on that
commit by a human other than the author, or the `human-approved` label added
after the head commit. The controller removes a label that predates the head.
Agents push as Alex's GitHub account, so GitHub cannot tell an agent's label
from Alex's. Agents add `human-approved` only to relay Alex's explicit words
in a project thread, and the pull request comment names that message.
Giving agents their own GitHub identity would close this gap.

## Facts

| Field | Read from |
| --- | --- |
| repository | `repos.json` `owned` |
| reach | the diff's paths against `trustRoot` and `secretsPaths`, its `+`/`-` lines against `secrets.`, and the `speaks-outside` label |
| checks | every check run and commit status on the head, except the controller's own; with no `acceptance / ` run yet, the checks count as running |
| human | the reviews and the `human-approved` label event, compared with the head commit |
| draft | the pull request's draft flag |
| base, mergeable | the base ref against open and merged heads; GitHub's `mergeable_state` |
