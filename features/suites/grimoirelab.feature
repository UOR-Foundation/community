Feature: grimoirelab

  GrimoireLab, the CHAOSS oracle: Perceval and SortingHat at the GrimoireLab
  1.23.0 component set, recorded in oracles/grimoirelab/oracle.lock.json beside
  the SDK's standards.lock, and the Perceval Discord backend under upstream
  contribution.

  @GL-01 @build
  Scenario: The GrimoireLab oracle record pins Perceval, SortingHat and the GrimoireLab release by commit and PyPI digest, binds its wrapper and corpus by digest, and declares what each oracle covers and does not cover
    Given oracles/grimoirelab/oracle.lock.json
    When its authorities, oracles and digests are read
    Then every authority names a full commit and a source digest, every oracle names its authorities, covers and does_not_cover, and the wrapper and corpus digests match their bytes

  @GL-02 @build
  Scenario: The Perceval Discord backend is added to the pinned Perceval as new files only, with unit tests and offline archive replay run by upstream's own test runner
    Given oracles/grimoirelab/perceval-discord and oracles/grimoirelab/verify.sh
    When verify.sh overlays the backend on the pinned Perceval and runs tests/run_tests.py
    Then it refuses to replace an upstream file, and the backend's tests include archive replay

  @GL-03 @open
  Scenario: Live retrieval of the Foundation's Discord waits on a read-only bot in the guild, and its token stays out of the repository
    Given the Perceval oracle's does_not_cover
    When the repository is searched for a Discord token
    Then live retrieval is declared not covered and no token is committed
