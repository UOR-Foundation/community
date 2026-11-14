# GrimoireLab, the CHAOSS oracle

GrimoireLab is the tool CHAOSS names for its metrics. It is the oracle here
because it carries the strongest validation evidence: each component ships an
upstream test suite with offline replay. This directory runs those suites,
unmodified, at the component set GrimoireLab 1.23.0 fixes:

| Component | Commit | Upstream suite |
| --- | --- | --- |
| Perceval 1.6.2 | `d60867ab` | `tests/run_tests.py`, 1050 tests including the Discord backend's 30, plus flake8, with `upstream.patch` (README and help text) applied |
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

## Live validation

`live/` validates the backend against the Foundation's guild. It keeps the
telemetry it records and uses that telemetry to choose the next probes
(GL-04). The pattern is the engine of afflom/rule30 and casey-allard/lexlean-r4.

- `probe.py` runs the unmodified backend. A response hook on its HTTP session
  records each request as an OpenTelemetry span (OTLP/JSON, HTTP client
  semantic conventions plus `discord.*` attributes: cursor, page size,
  rate-limit headers, and the number of messages with empty content). It
  records no content, no author and no token.
- `live.py` reads the paging state machine of the contribution Prism. That is
  `app/prompt.json` of UOR-Foundation/grimoirelab-discord at the commit and
  SHA-256 that `model.lock.json` pins. Every step of every trace must be a
  transition of that model.
- `live.py` also runs four checks of its own:
  - an archive must replay to the same items;
  - an archive must not hold the token;
  - most text messages coming back empty means the Message Content intent is off;
  - the pinned Chronicler, with the Discord eventizer, must turn the fetched
    items into valid CloudEvents 1.0 events (specversion, id, source and type
    present, ids unique, one message event per item). The trace records the
    count of each event type, not the events.
- The engine keeps an integer weight for each pair of channel family and
  probe strategy, bounded to [1, 16]. A probe that diverged from the model, or
  that reached a rule its family had not reached before, gains 2; any other
  probe loses 1. Each family runs its three heaviest strategies, with ties
  broken in portfolio order.
  - Portfolio: full, recent, small pages, archive replay, foreign guild,
    unknown channel, rate floor.
  - `report.json` lists the rules no probe has reached yet.
- `tick.py` runs one tick. The `discord-live` workflow runs it every six hours
  with the bot's token and commits the state, traces and report to the
  `telemetry/discord` branch. A divergence fails the run.
- `verify.sh perceval` also runs `live/tests` against a local Discord that
  speaks the API subset the backend uses. Both `perceval` and `live` stage
  the pinned Chronicler with its overlay and install its runtime set with
  hashes required.
- Writing the eventizer check found a trap: a subclass of the backend
  changes `backend_name` in every item, and Chronicler then refuses the
  items. The probe therefore wraps the unmodified backend instead.

The harness's first run found a defect. Perceval archives the whole response
object, and that object keeps the request that was sent, with the session's
`Authorization` header. `sanitize_for_archive` sees only the per-request
headers, so the bot token reached the archive. The backend now removes the
token from the response before it is archived, and `test_archive_holds_no_token`
fails without that fix. Upstream's other backends that pass a token as an
extra header (GitHub, GitLab, Slack and others) put it on the session the same
way. They are likely affected too, but this has not been tested.

## Gate evidence

| Planted defect | Gate | Diagnostic | Restored |
| --- | --- | --- | --- |
| A byte appended to `perceval-discord/tests/test_discord.py` | `cargo test --test grimoirelab grimoirelab_gl_01` | `oracle.lock.json does not match the wrapper or corpus bytes` | passes |
| A bot-token-shaped string in `oracles/planted.txt` | `cargo test --test grimoirelab grimoirelab_gl_03` | `holds what looks like a Discord token` | passes |
| A byte changed in `chaoss/register.json` | `node oracles/reproject.mjs chaoss <dir>` | `register.json is not the projection of the pinned sources` | passes |
| Upstream's git fixtures extracted as root | `verify.sh perceval` | 2 errors in `test_git` setUpClass (`dubious ownership`) | 1079 pass with a run-scoped `safe.directory` |
| The token-removing response hook disabled in `discord.py` | `verify.sh perceval` (`test_archive_holds_no_token`) | `the token is in the archive` | 1050 pass |
| A full page followed by no request, reported as done | `live/tests` (`test_a_fetch_that_stops_early_diverges`) | one divergence: expected `paging`, observed `done` | 20 pass |
