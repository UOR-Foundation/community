# Repository Maintainer

Schema.org Person. Named in https://github.com/UOR-Foundation/.github/blob/92da114114fc9b76cbf2c5168e29d409b62ddde8/governance/GOVERNANCE.md:

> Repository Maintainer: Day-to-day repo health, review, and release

## Metrics models (6)

### Metrics Model: AI Alignment - Community Aligned Training (Feedback)

https://github.com/chaoss/wg-ai-alignment/blob/0d0f78655aab6417293aaefd85e08ecc72ddabfa/metrics/ai-alignment-community-feedback/metric-model-ai-alignment-community-aligned-training-feedback.md

- As a maintainer I want to communicate governance decisions around AI to model builders.
- As a maintainer dealing with AI-generated low-quality PRs, I want to flag the contribution pattern to the provider whose tool produced it, so that I'm not bearing the full cost of triaging output I didn't ask for.
- As a maintainer, I want a documented intake SLA from each major model provider, so that I can decide whether filing feedback is worth my time before I start.

### Metrics Model: Community Governed AI Use in Open Communities

https://github.com/chaoss/wg-ai-alignment/blob/0d0f78655aab6417293aaefd85e08ecc72ddabfa/metrics/ai-alignment-community-governed-use/metric-model-ai-alignment-community-governed-use.md

- As a project leader, I want to measure the existing use of AI in my community so that I can determine future project policy on the use of AI in the project.
- As a team leader, I want to be aware of tools and workflows that people use to participate in my project so that…..
- As a project leader considering a disclosure-and-ban policy, I want to see how similar projects have fared so I can judge the tradeoffs before adopting it.
- As a project leader considering a conditional, human-in-the-loop policy, I want a way to express task-specific rules rather than a blanket yes or no.
- As a project leader who has decided not to restrict AI use, I want to state that clearly so contributors who disagree can choose to fork or leave rather than block others.
- As a project leader considering an outright ban, I want to see how that reasoning was received elsewhere before deciding whether it holds for my project.
- As a project leader who adopted a conditional policy, I want to check whether disclosed AI-assisted contributions meet its requirements, so I can tell whether the policy is working or just written down.
- As a project maintainer, I want to verify or be aware of the ways that my community members and contributors are (or aren't) abiding by the policies the community has consented to, so it can inform my response and maintenance of a healthy community.
- As a maintainer, I want to see an overview of the specific AI tools and models being used in my (or other) communities, so I can compare tool quality and learn about new frontier models as contributors adopt them.
- As a maintainer, I want to distinguish AI-assisted human contribution from autonomous agent activity in my workflows, so I know which policy provisions apply to a given contribution.
- As a maintainer, I want a way to signal that my project has an active human community and pre-LLM history, so a platform's graduated policy places my project correctly rather than flagging it on resource use alone.
- As a maintainer with a zero-tolerance policy, I want guidance on responding warmly to AI-assisted submissions I still plan to reject, so the contributor leaves treated like any other well-meaning first-time submitter, not shamed.

### Community Welcomingness

https://github.com/chaoss/wg-metrics-models/blob/4365fe61cf9654ef7b3911805425f4e485918672/metrics-model-libs/community-welcomingness/definition/community-welcomingness.md

- As a maintainer, I would like to know how many potential new contributors I am losing because my project is not as welcoming as it could be.

### Development Responsiveness

https://github.com/chaoss/wg-metrics-models/blob/4365fe61cf9654ef7b3911805425f4e485918672/metrics-model-libs/development-responsiveness/definition/development-responsiveness.md

- As a community manager/maintainer I want to evaluate how well our project is responding in various capacities (issues, comments etc), and where possible compare to other projects who are similar or direct competitors.

### Funding

https://github.com/chaoss/wg-metrics-models/blob/4365fe61cf9654ef7b3911805425f4e485918672/metrics-model-libs/funding/definition/funding.md

- As a project maintainer, core contributors who are not compensated are less likely to maintain quality contributions.

### Safety

https://github.com/chaoss/wg-metrics-models/blob/4365fe61cf9654ef7b3911805425f4e485918672/metrics-model-libs/safety/definition/safety.md

- As a community manager/maintainer, I want to regularly challenge our project and community around safety and track our progress over time.

## Decisions (8)

### Remediation lifecycle

UML 2.5.1 state machine, https://github.com/UOR-Foundation/community/blob/main/apps/uor-remediation-lifecycle.prompt.json

- Reviews and merges or declines the remediation pull request, and needs a declined remediation to end rather than be reopened.

### Remediation write policy

XACML 3.0 policy, https://github.com/UOR-Foundation/community/blob/main/apps/uor-remediation-write.prompt.json

- Reviews each remediation pull request and needs every change to arrive through review, never as a direct push.

### Required repository files by tier

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-files.prompt.json

- Keeps a repository healthy and needs to know whether it meets its tier and the first gap to close.

### Repository naming and topic coverage

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-naming.prompt.json

- Keeps a repository healthy and needs to know whether it meets its tier and the first gap to close.

### Branch protection by tier

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-protection.prompt.json

- Keeps a repository healthy and needs to know whether it meets its tier and the first gap to close.

### Repository tags and versioning

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-standards.prompt.json

- Keeps a repository healthy and needs to know whether it meets its tier and the first gap to close.

### Repository tier by use case

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-tier.prompt.json

- Records the tier of a repository and needs the proposed tier to follow GOVERNANCE.md 5 and to yield to the tier already recorded.

### TOC project lifecycle

UML 2.5.1 state machine, https://github.com/UOR-Foundation/community/blob/main/apps/uor-toc-lifecycle.prompt.json

- Opens a Sandbox, Incubation or Graduation issue in UOR-Foundation/.github and needs to know which evidence and which vote move the project.

## Open claims (3)

- Metrics Model: AI Alignment - Community Aligned Training (Feedback): model provider building feedback intake: names a role no Foundation stakeholder holds
- Metrics Model: AI Alignment - Community Aligned Training (Feedback): model provider: names a role no Foundation stakeholder holds
- Metrics Model: Community Governed AI Use in Open Communities: model builder: names a role no Foundation stakeholder holds
