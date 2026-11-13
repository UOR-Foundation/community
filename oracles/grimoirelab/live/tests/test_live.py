"""Tests of the live Discord validation.

The pinned paging model is read from the file LIVE_MODEL names (verify.sh
fetches it at the locked commit); its digest is checked like any other read.
The probe tests run the unmodified backend against a local server that
speaks the Discord API v10 subset the backend uses.
"""

import json
import os
import sys
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import live  # noqa: E402

APP = live.load_model(Path(os.environ["LIVE_MODEL"]).read_bytes())
GUILD = "1100000000000000001"
TEXT, NEWS, THREAD = "1200000000000000001", "1200000000000000002", "1200000000000000003"
TOKEN = "fake.discord.bot-token-for-tests"


def snowflake(dt):
    return (int(dt.timestamp() * 1000) - 1420070400000) << 22


def span(trace, sid, attrs, parent=None, t=0):
    s = {"traceId": trace, "spanId": sid, "name": "GET" if parent else "discord.probe",
         "startTimeUnixNano": str(t), "endTimeUnixNano": str(t + 1), "attributes": live.otlp_attrs(attrs)}
    if parent:
        s["parentSpanId"] = parent
    return s


def trace(root, requests):
    spans = [span("t", "r", root)] + [span("t", "c%d" % i, a, "r", i + 1) for i, a in enumerate(requests)]
    return {"resourceSpans": [{"resource": {}, "scopeSpans": [{"scope": {}, "spans": spans}]}]}


ROOT = {"discord.probe.trace": "t", "discord.probe.strategy": "full", "discord.guild_id": GUILD,
        "discord.channel.id": TEXT, "discord.channel.family": "text", "perceval.max_items": 2,
        "perceval.min_rate_to_sleep": 1, "perceval.sleep_for_rate": True}
CHANNEL = {"url.template": "/channels/{channel}", "http.response.status_code": 200,
           "discord.channel.guild_id": GUILD, "discord.ratelimit.remaining": 4}


def page(after, ids):
    return {"url.template": "/channels/{channel}/messages", "http.response.status_code": 200,
            "discord.cursor.after": after, "discord.page.returned": len(ids),
            "discord.page.first_id": str(min(ids)) if ids else None, "discord.ratelimit.remaining": 4}


class TestModel(unittest.TestCase):

    def test_lock_refuses_other_bytes(self):
        with self.assertRaises(ValueError):
            live.load_model(b'{"pattern": "stateMachine"}')

    def test_decide_follows_the_examples(self):
        """Every example the prompt states is what decide returns."""
        names = [f["name"] for f in APP["fields"]]
        kinds = {f["name"]: f["kind"] for f in APP["fields"]}
        for example in APP["examples"]:
            values = example["request"].split()
            record = {n: int(v) if kinds[n] == "number" else v for n, v in zip(names, values)}
            self.assertEqual(live.decide(APP, record)[0], example["response"], example["request"])

    def test_observable_leaves_out_absorbing_rules(self):
        self.assertNotIn("REQ-001", live.observable(APP))
        self.assertIn("otherwise", live.observable(APP))


class TestConform(unittest.TestCase):

    def test_a_conforming_fetch(self):
        root = dict(ROOT, **{"discord.probe.outcome": "done"})
        divergences, exercised = live.conform(APP, trace(root, [CHANNEL, page(0, [5, 6]), page(6, [7])]))
        self.assertEqual(divergences, [])
        self.assertIn("otherwise", exercised[0][1])

    def test_a_fetch_that_stops_early_diverges(self):
        """A full page followed by no request and a done outcome is not a run of the model."""
        root = dict(ROOT, **{"discord.probe.outcome": "done"})
        divergences, _ = live.conform(APP, trace(root, [CHANNEL, page(0, [5, 6])]))
        self.assertEqual(len(divergences), 1)
        self.assertEqual((divergences[0]["expected"], divergences[0]["observed"]), ("paging", "done"))

    def test_a_fetch_that_follows_a_foreign_channel_diverges(self):
        root = dict(ROOT, **{"discord.probe.outcome": "done", "discord.guild_id": "1"})
        divergences, _ = live.conform(APP, trace(root, [CHANNEL, page(0, [5])]))
        self.assertEqual(divergences[0]["expected"], "refused")

    def test_truncated_probe_leaves_out_its_last_step(self):
        root = dict(ROOT, **{"discord.probe.outcome": "truncated"})
        divergences, exercised = live.conform(APP, trace(root, [CHANNEL, page(0, [5, 6])]))
        self.assertEqual(divergences, [])
        self.assertEqual(len(live.steps(root, [CHANNEL, page(0, [5, 6])])), 1)

    def test_replay_and_token_checks(self):
        root = dict(ROOT, **{"discord.probe.outcome": "done", "discord.replay.equal": False,
                             "discord.archive.token_free": False})
        divergences, _ = live.conform(APP, trace(root, [CHANNEL, page(0, [5])]))
        self.assertEqual(sorted(d["check"] for d in divergences),
                         ["discord.archive.token_free", "discord.replay.equal"])

    def test_content_intent(self):
        root = dict(ROOT, **{"discord.probe.outcome": "done", "perceval.max_items": 100})
        empty = dict(page(0, list(range(1, 13))),
                     **{"discord.page.text_messages": 12, "discord.page.content_empty": 12})
        divergences, _ = live.conform(APP, trace(root, [CHANNEL, empty]))
        self.assertEqual([d["check"] for d in divergences], ["discord.content.intent"])


class TestEngine(unittest.TestCase):

    def test_learn_is_bounded(self):
        state = live.initial_state()
        for _ in range(40):
            live.learn(state, "text", "full", True)
        self.assertEqual(live.weight(state, "text", "full"), live.W_MAX)
        for _ in range(40):
            live.learn(state, "text", "full", False)
        self.assertEqual(live.weight(state, "text", "full"), live.W_MIN)

    def test_schedule_orders_by_weight_then_portfolio(self):
        state = live.initial_state()
        self.assertEqual(live.schedule(state, "text", 3), live.STRATEGIES[:3])
        live.learn(state, "text", "floor", True)
        live.learn(state, "text", "full", False)
        order = live.schedule(state, "text", len(live.STRATEGIES))
        self.assertEqual(order[0], "floor")
        self.assertEqual(order[-1], "full")
        self.assertEqual(sorted(order), sorted(live.STRATEGIES))

    def test_consolidate_rewards_new_coverage_only_once(self):
        state = live.initial_state()
        root = dict(ROOT, **{"discord.probe.outcome": "done"})
        exercised = [(root, ["REQ-008", "otherwise"])]
        live.consolidate(state, exercised, [], 0)
        self.assertEqual(live.weight(state, "text", "full"), live.W_INITIAL + live.RAISE)
        live.consolidate(state, exercised, [], 1)
        self.assertEqual(live.weight(state, "text", "full"), live.W_INITIAL + live.RAISE - live.LOWER)
        self.assertEqual(state["tick"], 2)
        self.assertNotIn("REQ-008", live.uncovered(APP, state))


# --- a local Discord ------------------------------------------------------------

class FakeDiscord(BaseHTTPRequestHandler):
    messages = []

    def log_message(self, *args):
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-RateLimit-Remaining", "4")
        self.send_header("X-RateLimit-Reset-After", "0.01")
        self.send_header("X-RateLimit-Bucket", "fake")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlsplit(self.path)
        parts = url.path.split("/")[3:]
        if self.headers.get("Authorization") != "Bot " + TOKEN:
            return self.reply(401, {"message": "401: Unauthorized", "code": 0})
        if parts == ["guilds", GUILD, "channels"]:
            return self.reply(200, [{"id": TEXT, "type": 0}, {"id": NEWS, "type": 5}, {"id": "9", "type": 4}])
        if parts == ["guilds", GUILD, "threads", "active"]:
            return self.reply(200, {"threads": [{"id": THREAD, "type": 11}], "members": []})
        if parts[0] == "channels" and parts[1] in (TEXT, NEWS, THREAD):
            if len(parts) == 2:
                return self.reply(200, {"id": parts[1], "guild_id": GUILD, "type": 0, "name": "general"})
            q = parse_qs(url.query)
            after, limit = int(q["after"][0]), int(q["limit"][0])
            newer = sorted((m for m in self.messages if int(m["id"]) > after), key=lambda m: int(m["id"]))
            return self.reply(200, list(reversed(newer[:limit])))
        return self.reply(404, {"message": "Unknown Channel", "code": 10003})


class TestProbe(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        import perceval.backends.core.discord as discord
        import probe
        import tick
        cls.probe, cls.tick = probe, tick
        now = datetime.now(timezone.utc)
        FakeDiscord.messages = [{
            "id": str(snowflake(now) - (12 - i) * (1 << 22) * 60000), "type": 0, "content": "m%d" % i,
            "timestamp": now.isoformat(), "author": {"id": "1", "username": "u"},
            "attachments": [], "embeds": [],
        } for i in range(12)]
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeDiscord)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.saved = discord.DISCORD_API_URL
        discord.DISCORD_API_URL = "http://127.0.0.1:%d/api/v10/" % cls.server.server_port
        cls.discord = discord

    @classmethod
    def tearDownClass(cls):
        cls.discord.DISCORD_API_URL = cls.saved
        cls.server.shutdown()

    def one(self, strategy):
        spans = self.probe.run(strategy, GUILD, TEXT, "text", TOKEN, 0)
        otlp = self.probe.document(spans, "test")
        divergences, exercised = live.conform(APP, otlp)
        self.assertEqual(divergences, [], strategy)
        return exercised[0]

    def test_every_strategy_conforms(self):
        outcomes = {s: self.one(s)[0]["discord.probe.outcome"] for s in live.STRATEGIES}
        self.assertEqual(outcomes, {"full": "done", "recent": "done", "small": "done", "replay": "done",
                                    "foreign": "refused", "missing": "failed", "floor": "failed"})

    def test_rules_the_strategies_reach(self):
        self.assertIn("REQ-004", self.one("foreign")[1])
        self.assertIn("REQ-006", self.one("missing")[1])
        self.assertIn("REQ-009", self.one("floor")[1])
        self.assertIn("otherwise", self.one("small")[1])

    def test_replay_round_trips_without_the_token(self):
        root = self.one("replay")[0]
        self.assertIs(root["discord.replay.equal"], True)
        self.assertIs(root["discord.archive.token_free"], True)

    def test_telemetry_holds_no_content_or_token(self):
        text = json.dumps(self.probe.document(self.probe.run("full", GUILD, TEXT, "text", TOKEN, 0), "t"))
        self.assertNotIn(TOKEN, text)
        self.assertNotIn('"m1"', text)
        self.assertNotIn("username", text)

    def test_a_tick(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            out, state = Path(tmp) / "out", Path(tmp) / "engine.json"
            os.environ["DISCORD_BOT_TOKEN"] = TOKEN
            try:
                code = self.tick.main([GUILD, "--state", str(state), "--out", str(out),
                                       "--model", os.environ["LIVE_MODEL"]])
            finally:
                del os.environ["DISCORD_BOT_TOKEN"]
            self.assertEqual(code, 0)
            report = json.loads((out / "report.json").read_text())
            self.assertEqual(report["families"], {"announcement": 1, "text": 1, "thread": 1})
            self.assertEqual(len(report["probes"]), 9)
            engine = json.loads((out / "engine.json").read_text())
            self.assertEqual(engine["tick"], 1)

    def test_a_tick_without_a_token_refuses(self):
        os.environ.pop("DISCORD_BOT_TOKEN", None)
        self.assertEqual(self.tick.main([GUILD, "--state", "x", "--out", "y"]), 2)


if __name__ == "__main__":
    unittest.main()
