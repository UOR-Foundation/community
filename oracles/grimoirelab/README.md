# GrimoireLab, the CHAOSS oracle

GrimoireLab is the tool CHAOSS names for its metrics. It is the oracle here
because it carries the strongest validation evidence: each component ships an
upstream test suite with offline replay. This directory runs those suites,
unmodified, at the component set GrimoireLab 1.23.0 fixes:

| Component | Commit | Upstream suite |
| --- | --- | --- |
| Perceval 1.6.2 | `d60867ab` | `tests/run_tests.py`, 1048 tests including the Discord backend's 28, plus flake8, with `upstream.patch` (README and help text) applied |
| SortingHat 1.16.0 | `538e5369` | flake8, then `manage.py test` under `config_testing` (1079 tests) and `config_testing_tenant` (13 tests), on MariaDB 11.4 |

- `oracle.lock.json` is the record. Its fields follow `prismpm/standards-lock/1`,
  so an entry can move into an SDK lock unchanged. It sits beside
  `standards.lock` because the template binds that file byte for byte to the
  pinned SDK. `node oracles/grimoirelab/lock.mjs` rebinds the wrapper and
  corpus digests, and `--check` verifies them (claim GL-01).
- `verify.sh perceval|sortinghat` fetches the pinned commit and refuses any
  other commit. It installs upstream's `poetry.lock` with hashes required and
  runs upstream's own commands with no proxy.
- `perceval-discord/` is the Discord backend for upstream contribution
  (GL-02). Its files are added to Perceval's tree, and `verify.sh` refuses any
  file that would replace an upstream one. It reads the Discord API v10 with a
  bot token, pages by the `after` snowflake, resumes from a date, and replays
  from an archive with the token removed.

## Discord

Live retrieval stays an open claim (GL-03) until a Discord admin adds a
read-only bot to the guild. The bot needs View Channel, Read Message History
and the Message Content intent. Its token goes in a repository secret and is
never committed; GL-03's test fails on anything shaped like a bot token under
`oracles/`.

To run the backend against the live guild:

```
perceval discord <guild-id> <channel-id> -t "$DISCORD_BOT_TOKEN" --from-date 2026-01-01
```

The upstream pull request to chaoss/grimoirelab-perceval waits for approval.
It contains `perceval-discord/` as is, plus a README section.

## Gate evidence

| Planted defect | Gate | Diagnostic | Restored |
| --- | --- | --- | --- |
| A byte appended to `perceval-discord/tests/test_discord.py` | `cargo test --test grimoirelab grimoirelab_gl_01` | `oracle.lock.json does not match the wrapper or corpus bytes` | passes |
| A bot-token-shaped string in `oracles/planted.txt` | `cargo test --test grimoirelab grimoirelab_gl_03` | `holds what looks like a Discord token` | passes |
| A byte changed in `chaoss/register.json` | `node oracles/reproject.mjs chaoss <dir>` | `register.json is not the projection of the pinned sources` | passes |
| Upstream's git fixtures extracted as root | `verify.sh perceval` | 2 errors in `test_git` setUpClass (`dubious ownership`) | 1079 pass with a run-scoped `safe.directory` |
