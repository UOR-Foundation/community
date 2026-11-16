Feature: bestpractices

  The Best Practices register: every criterion of the OpenSSF Best Practices badge, passing,
  silver and gold, read by bestpractices/criteria.py from criteria/criteria.yml and
  config/locales/en.yml of coreinfrastructure/best-practices-badge at the pinned commit, against
  every public UOR-Foundation repository of ecosystem/snapshot.json at the commit
  licensing/snapshot.json pins. bestpractices/snapshot.mjs reads what the badge application's own
  detectives read, bestpractices/project.mjs applies those detectives and Chief's merge, citing
  each by file and line, and the outcomes are declared as Foundation.BestPractices.V1 records in
  app/src/BestPractices.lex.tex.

  @BP-01 @build
  Scenario: The Best Practices register is valid: every criterion of the pinned OpenSSF Best Practices badge criteria, passing, silver and gold, has exactly one outcome for every public Foundation repository, an outcome is open exactly when its criterion is MUST and it is Unmet or unknown, N/A is recorded only where the criterion allows it, an unknown outcome carries no detective, and the counts reconcile with the release
    Given the catalog in app/src/BestPractices.lex.tex
    When the Lean kernel checks registerValidHolds in the BestPractices catalog during prismpm verify
    Then registerValid holds of the release, its criteria, repositories, outcomes, badge queries and refusals

  @BP-02 @build
  Scenario: The Best Practices catalog declares the badge project commit and the digests of its criteria and locale files, the digests of the criteria reading and the snapshot, the security register commit, the commit of every repository, and the badge detective file and line of every outcome that is not unknown
    Given bestpractices/register.json projected from bestpractices/criteria.json, bestpractices/snapshot.json and the pinned badge checkout
    When the catalog is read
    Then the badge commit, the source digests, every repository commit and every detective citation are declared

  @BP-03 @open
  Scenario: A MUST criterion a repository does not meet, or whose outcome only a person or the badge application can give, is carried as an open outcome, and a fact the detectives would read but the snapshot cannot attest at the pinned commit is carried as a typed refusal, never restated as Met
    Given the outcomes and refusals in bestpractices/register.json
    When the catalog is read
    Then every MUST outcome that is Unmet or unknown is open, and every refusal is one OpenRefusal record of its kind
