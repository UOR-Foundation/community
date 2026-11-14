# Organization Owner

Schema.org Person. Named in https://github.com/UOR-Foundation/.github/blob/92da114114fc9b76cbf2c5168e29d409b62ddde8/governance/GOVERNANCE.md:

> Organization Owner: Final governance decisions and escalations

## Metrics models (0)

## Decisions (8)

### Discord channel read policy

XACML 3.0 policy, https://github.com/UOR-Foundation/community/blob/main/apps/uor-discord-read.prompt.json

- Installs the bot and labels channels, and needs nothing read that was not labeled public.

### Remediation lifecycle

UML 2.5.1 state machine, https://github.com/UOR-Foundation/community/blob/main/apps/uor-remediation-lifecycle.prompt.json

- Approves each remediation and applies its settings, and needs to see which step every repository is at.

### Remediation write policy

XACML 3.0 policy, https://github.com/UOR-Foundation/community/blob/main/apps/uor-remediation-write.prompt.json

- Approves the remediation and applies the settings only an admin can change, and needs no write to happen without that approval.

### Required repository files by tier

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-files.prompt.json

- Holds final governance authority and needs every repository measured against the same published norms.

### Repository naming and topic coverage

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-naming.prompt.json

- Holds final governance authority and needs every repository measured against the same published norms.

### Branch protection by tier

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-protection.prompt.json

- Holds final governance authority and needs every repository measured against the same published norms.

### Repository tags and versioning

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-standards.prompt.json

- Holds final governance authority and needs every repository measured against the same published norms.

### Repository tier by use case

DMN 1.5 decision table, https://github.com/UOR-Foundation/community/blob/main/apps/uor-repo-tier.prompt.json

- Holds final governance authority and needs every repository classified by the same published rule.

## Open claims (0)

None.
