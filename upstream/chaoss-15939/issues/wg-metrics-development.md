<!-- Draft for chaoss/wg-metrics-development, in its "Revising a Metric" issue template. Not submitted: it opens only after Alex approves, and after the template pull request in chaoss/community. One issue covers the working group's items; it can be split per metric if the WG prefers. -->

### Name of the Metric Being Revised

* Bot Activity (`focus-areas/people/bot-activity.md`)
* Change Request Closure Ratio (`focus-areas/time/change-request-closure-ratio.md`)
* Clones (`focus-areas/contributions/clones.md`)
* Collaboration Platform Activity (`focus-areas/place/collaboration-platform-activity.md`)
* Occasional Contributors (`focus-areas/people/occasional-contributors.md`)
* Technical Fork (`focus-areas/contributions/technical-fork.md`)
* Time to Close (`focus-areas/time/time-to-close.md`)

### Link to Original Metric Release Issue

Not specified in the definitions; the working group can add them.

### Specific Metric Details that Require Attention

#### Bot Activity

- **Measurement Method:** the template has this section and the definition lacks it.

#### Change Request Closure Ratio

- **Entity:** the definition cites `panels/json/github_pull_requests_efficiency.json` (8 computations), and nothing names which computation is this metric (entity-unstated-by-oracle). Naming it settles the element.
- **Attribute:** the definition cites `panels/json/github_pull_requests_efficiency.json` (8 computations), and nothing names which computation is this metric (attribute-unstated-by-oracle). Naming it settles the element.
- **Measurement Method:** GrimoireLab 1.23.0 computes this element; proposed value `REI`. Sources: `grimoirelab-sigils@71a26ac67d2d694382b48d6f2f4d953412dd33f1:panels/json/github_pull_requests_efficiency.json#f3ef79f0-e1b8-11e8-8aac-ef7fd4d8cbad`.
- **Scale:** GrimoireLab 1.23.0 computes this element; proposed value `ratio`. Sources: `grimoirelab-sigils@71a26ac67d2d694382b48d6f2f4d953412dd33f1:panels/json/github_pull_requests_efficiency.json#f3ef79f0-e1b8-11e8-8aac-ef7fd4d8cbad`.
- **Unit:** GrimoireLab 1.23.0 computes this element; proposed value `1`. Sources: `grimoirelab-elk@4297cf9d312aeea6adab70dbeb53c19bda923c5f:grimoire_elk/enriched/github.py#L514`, `grimoirelab-elk@4297cf9d312aeea6adab70dbeb53c19bda923c5f:grimoire_elk/enriched/github.py#L613`, `grimoirelab-sigils@71a26ac67d2d694382b48d6f2f4d953412dd33f1:panels/json/github_pull_requests_efficiency.json#f3ef79f0-e1b8-11e8-8aac-ef7fd4d8cbad`.

#### Clones

- **Measurement Method:** the template has this section and the definition lacks it.

#### Collaboration Platform Activity

- **Entity:** the definition cites `panels/json/organizational_diversity.json` (6 computations), and nothing names which computation is this metric (oracle-index-unresolved:alias-spans-data-sources). Naming it settles the element.
- **Attribute:** the definition cites `panels/json/organizational_diversity.json` (6 computations), and nothing names which computation is this metric (oracle-index-unresolved:alias-spans-data-sources). Naming it settles the element.
- **Scale:** the definition cites `panels/json/organizational_diversity.json` (6 computations), and nothing names which computation is this metric (oracle-index-unresolved:alias-spans-data-sources). Naming it settles the element.
- **Unit:** the definition cites `panels/json/organizational_diversity.json` (6 computations), and nothing names which computation is this metric (oracle-index-unresolved:alias-spans-data-sources). Naming it settles the element.

#### Occasional Contributors

- **Measurement Method:** the template has this section and the definition lacks it.

#### Technical Fork

- **Measurement Method:** the template has this section and the definition lacks it.

#### Time to Close

- **Entity:** the definition cites `panels/json/github_pull_requests_efficiency.json` (8 computations) and `panels/json/github_issues_efficiency.json` (8 computations) and `panels/json/timing_overview_tickets.json` (10 computations), and nothing names which computation is this metric (oracle-index-unresolved:alias-spans-data-sources). Naming it settles the element.
- **Attribute:** the definition cites `panels/json/github_pull_requests_efficiency.json` (8 computations) and `panels/json/github_issues_efficiency.json` (8 computations) and `panels/json/timing_overview_tickets.json` (10 computations), and nothing names which computation is this metric (oracle-index-unresolved:alias-spans-data-sources). Naming it settles the element.
- **Scale:** the definition cites `panels/json/github_pull_requests_efficiency.json` (8 computations) and `panels/json/github_issues_efficiency.json` (8 computations) and `panels/json/timing_overview_tickets.json` (10 computations), and nothing names which computation is this metric (oracle-index-unresolved:alias-spans-data-sources). Naming it settles the element.
- **Unit:** the definition cites `panels/json/github_pull_requests_efficiency.json` (8 computations) and `panels/json/github_issues_efficiency.json` (8 computations) and `panels/json/timing_overview_tickets.json` (10 computations), and nothing names which computation is this metric (oracle-index-unresolved:alias-spans-data-sources). Naming it settles the element.

### Checklist

- [ ] Create the “revising metric” labeled issue in the authoring WG’s repo for comments during review period
- [ ] Create pull request of revised metric to WG’s repo
- [ ] Metric adheres to the current metrics template
