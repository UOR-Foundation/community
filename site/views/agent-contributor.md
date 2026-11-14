# Agent contributor

Schema.org SoftwareApplication, PROV-O actedOnBehalfOf Contributor. Named in https://www.w3.org/TR/2013/REC-prov-o-20130430/:

> A software agent is running software.

## Metrics models (0)

## Decisions (4)

### Contribution attribution

XACML 3.0 policy, https://github.com/UOR-Foundation/community/blob/main/apps/uor-contribution-attribution.prompt.json

- A software agent that writes commits and pull requests and needs its work credited to the person it acted for, never counted as a person.

### CHAOSS observation admission

XACML 3.0 policy, https://github.com/UOR-Foundation/community/blob/main/apps/uor-observation-admission.prompt.json

### Remediation lifecycle

UML 2.5.1 state machine, https://github.com/UOR-Foundation/community/blob/main/apps/uor-remediation-lifecycle.prompt.json

- Opens the pull requests and re-observes the repositories, and needs each step to name the act that moves it.

### Remediation write policy

XACML 3.0 policy, https://github.com/UOR-Foundation/community/blob/main/apps/uor-remediation-write.prompt.json

- Opens the remediation pull requests on behalf of the Organization Owner and needs to know exactly which changes it may make and how.

## Open claims (1)

- CHAOSS observation admission: Verifier: names a role no Foundation stakeholder holds
