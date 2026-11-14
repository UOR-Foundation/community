"""One tick of the live Discord validation.

    python tick.py <guild-id> --state engine.json --out <dir> [--k 3] [--max-pages 50]

The bot token is read from DISCORD_BOT_TOKEN and never written. A tick:

1. loads the engine state (weights, coverage, history) and the paging model
   pinned by model.lock.json;
2. lists the guild's channels and active threads by family;
3. runs, for each family, the k strategies the engine schedules, on the
   family's channel the tick number selects (round robin);
4. checks every probe's trace against the model;
5. folds the outcomes into the engine state.

It writes traces.otlp.json, engine.json and report.json to --out, and exits
1 when any probe diverged from the model, so the divergence fails the run.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import perceval.backends.core.discord as discord

import live
import probe


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("guild")
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--k", type=int, default=3)
    parser.add_argument("--max-pages", type=int, default=50)
    parser.add_argument("--model", type=Path, help="a local copy of the pinned prompt (its digest is still checked)")
    args = parser.parse_args(argv)

    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        print("DISCORD_BOT_TOKEN is not set: the live validation needs the read-only bot", file=sys.stderr)
        return 2

    app = live.load_model(args.model.read_bytes() if args.model else None)
    state = json.loads(args.state.read_text()) if args.state.exists() else live.initial_state()
    tick = state["tick"]

    families = probe.channels(args.guild, token)
    spans = []
    for family in sorted(families):
        ids = families[family]
        channel = ids[tick % len(ids)]
        for strategy in live.schedule(state, family, args.k):
            spans += probe.run(strategy, args.guild, channel, family, token, tick, max_pages=args.max_pages)

    otlp = probe.document(spans, discord.Discord.version)
    divergences, exercised = live.conform(app, otlp)
    live.consolidate(state, exercised, divergences, tick)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "traces.otlp.json").write_text(json.dumps(otlp, indent=1) + "\n")
    (args.out / "engine.json").write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")
    report = {
        "tick": tick,
        "families": {f: len(ids) for f, ids in sorted(families.items())},
        "probes": [{"strategy": r["discord.probe.strategy"], "family": r["discord.channel.family"],
                    "outcome": r["discord.probe.outcome"], "rules": rules} for r, rules in exercised],
        "divergences": divergences,
        "uncovered": live.uncovered(app, state),
        "weights": state["weights"],
    }
    (args.out / "report.json").write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps({k: report[k] for k in ("tick", "families", "divergences", "uncovered")}, indent=1))
    return 1 if divergences else 0


if __name__ == "__main__":
    sys.exit(main())
