# Foundation observations

`Foundation.Observation.V1` is the Foundation measured by the CHAOSS oracle.
Nothing in it is written by hand: GrimoireLab 1.23.0 collects, a projector
decides, and Lean checks.

| Step | Command | Output |
| --- | --- | --- |
| Pin | `python collect.py pin sources.json` | `sources.json`: the 31 public repositories of `ecosystem/register.json`, every branch and tag by commit, and the cut instant |
| Collect | `python collect.py run sources.json <work> corpus [<responses>]` | `corpus/` and `corpus.json`: one canonical JSON-lines file per subject and source, each pinned by sha256 |
| Replay | `python collect.py run …` again in a fresh work directory and database, then `python collect.py replay corpus.json <replayed> replay.json` | `replay.json`: the digest of every file an independent run wrote |
| Project | `node project.mjs [--check]` | `register.json`: periods, observations, values and open claims |
| Catalog | `node catalog.mjs [--check]` | `app/src/Foundation/Observation/V1/Model.lex.tex`, `app/src/Observations.lex.tex` |

`oracle.sh <work>` installs the Python the collector runs: the set GrimoireLab
1.23.0's `poetry.lock` pins, hash-checked. SortingHat runs in process on
MariaDB, with the settings module upstream ships (`SORTINGHAT_DB_*` name the
database).

## What runs, unmodified

- **Perceval** `git` backend, `no_update`, over a bare repository whose only
  refs are the pinned ones, up to the cut. A commit id is a content address, so
  the pins fix every commit Perceval can see.
- **Perceval** `github` backend, category `issue` (the `github_issues` index
  holds issues and pull requests). The API answers with today's state, so the
  [observations workflow](../.github/workflows/observations.yml) records the
  responses once, keyed by the content address of its inputs, and `run`
  replays them to the backend with no network. No Authorization header is
  recorded, and a user profile keeps only `login`, `id`, `node_id` and `type`.
- **grimoire-elk** `GitEnrich` and `GitHubEnrich`: `get_identities` for the
  identities, `get_rich_item` for the enriched fields. `time_open_days` is left
  out, because grimoire-elk measures it against the clock at enrichment time.
- **SortingHat** `core.api.add_identity` and `core.jobs.unify` with
  sirmordred's default criteria (`matching = ["email"]`, strict mapping).

The corpus publishes no name or email. An identity is its SortingHat uuid, an
email is matched to `governance/agents.json` by its sha256, and a GitHub App
is recognised by GitHub's own rule (the `[bot]` login, or account type `Bot`).

## How an observation is decided

An observation is one metric, one subject and one calendar month (an ISO 8601
interval, in UTC as an Elasticsearch `date_histogram` buckets it).

- **Attribution.** Each contribution is a `prov:Activity`. The
  `uor-contribution-attribution` app decides its credit: a person is credited
  for their own work, and a software agent's work is credited to a person only
  when its `Co-authored-by` trailers name exactly one person. That trailer is
  the delegation's record in the contribution. A denied contribution still
  counts as project activity, but it credits no one.
- **Admission.** The `uor-observation-admission` app decides each observation
  from six fields: the metric is released, the oracle covers the source
  (Perceval core backends), the data is pinned, the replay reproduced it,
  collection is ungoverned for public git and GitHub (the
  `uor-discord-read` app governs Discord), and attribution.
- **Values.** Each value is a computation `chaoss/oracle-methods.json` binds to
  the metric: an index, an aggregation and a field from a Sigils panel. The
  projector evaluates the aggregations whose Elasticsearch semantics are exact
  and simple to reproduce:
  - `count`, `sum`, `avg`, `min` and `max`;
  - `cardinality` while a set stays below its 3000-value precision threshold;
  - Lucene term queries (`field:value`);
  - the `pullRequest` filter;
  - date fields.

  Anything else is refused with its reason (claim OB-04): `median` and
  `percentiles` (TDigest sketches), Painless scripted fields, and fields the
  index does not carry (`author_org_name` needs enrollments, `project` needs
  a projects file). Values from a panel the metric only cites carry
  `method: "panel"`. Only `named` bindings single out one computation.

`registerValidHolds` in `app/src/Observations.lex.tex` proves two things:

- every observation's admission is what the app's rules decide on its recorded
  fields;
- every value refers to a permitted observation of its own metric.

Together they mean that every value is a function of admitted observations.

## Open

- **GitHub** (OB-05). Issues and pull requests enter the corpus once the
  observations workflow has recorded them. This session's GitHub access serves
  only repository-scoped endpoints for a few repositories, and Perceval also
  reads `/users/<login>`.
- **Discord** (GL-03, OB-05). The guild enters the corpus once the read-only
  bot is installed. The `uor-discord-read` decision then governs collection.

## Gate evidence

- **Defect.** In `app/src/Observations.lex.tex`, the first observation's
  `admission := (ctor Foundation.Observation.V1.Model::Admission.permit)` was
  changed to `Admission.deny`.
- **Command.** `lexlean verify src/Observations.lex.tex`, run in the pinned
  SDK.
- **Diagnostic.** Lean rejected `registerValidHolds`: the `decide` goal
  evaluated to `false`. The rules decide `permit` for that observation's
  fields, and the release counts 320 admitted.
- **Restored.** `node observations/catalog.mjs` rewrote the file, `--check`
  passed, and verify passed again.
