"""Run the Perceval Discord backend against a live guild and record each run
as an OpenTelemetry trace (OTLP/JSON) for `live.py` to check.

The backend runs unmodified. A response hook on its HTTP session records one
span per request; the probe's root span records how the fetch ended. Spans
hold ids, counts and headers, never message content, authors or the token.
"""

import hashlib
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

from grimoirelab_toolkit.uris import urijoin
from requests.exceptions import HTTPError

import perceval.backends.core.discord as discord
from perceval.archive import ArchiveManager
from perceval.errors import BackendError, RateLimitError

from live import FAMILIES, otlp_attrs

EPOCH = datetime(2015, 1, 1, tzinfo=timezone.utc)

# Messages Discord sends with an author's text, as opposed to system
# messages (joins, pins, boosts) whose content is empty by design.
TEXT_TYPES = (0, 19)
# Fields that make a text message carry something even with empty content.
CARRIERS = ("attachments", "embeds", "sticker_items", "components", "poll")


def strategy_params(strategy, now):
    """The backend arguments of each strategy in the portfolio."""
    p = {"max_items": 100, "from_date": EPOCH, "sleep_for_rate": True, "min_rate_to_sleep": 1,
         "guild": None, "channel": None, "archive": False}
    if strategy == "recent":
        p["from_date"] = now - timedelta(days=1)
    elif strategy == "small":
        p.update(max_items=2, from_date=now - timedelta(days=7))
    elif strategy == "replay":
        p.update(max_items=10, from_date=now - timedelta(days=30), archive=True)
    elif strategy == "foreign":
        # No channel belongs to guild 1, so the guild check must refuse.
        p["guild"] = "1"
    elif strategy == "missing":
        # No channel has id 1, so Discord answers 404 Unknown Channel.
        p["channel"] = "1"
    elif strategy == "floor":
        # A floor above any bucket, without sleeping: the client must stop
        # after the first response instead of spending the bucket.
        p.update(sleep_for_rate=False, min_rate_to_sleep=10000)
    elif strategy != "full":
        raise ValueError("unknown strategy " + strategy)
    return p


class Recorder:
    """A requests response hook that turns each response into span attributes."""

    def __init__(self):
        self.spans = []

    def __call__(self, response, *args, **kwargs):
        end = time.time_ns()
        start = end - int(response.elapsed.total_seconds() * 1e9)
        url = urlsplit(response.request.url)
        messages = url.path.rstrip("/").endswith("/messages")
        a = {
            "http.request.method": response.request.method,
            "server.address": url.hostname,
            "url.template": "/channels/{channel}/messages" if messages else "/channels/{channel}",
            "http.response.status_code": response.status_code,
        }
        h = response.headers
        if "X-RateLimit-Remaining" in h:
            a["discord.ratelimit.remaining"] = int(h["X-RateLimit-Remaining"])
        if "X-RateLimit-Reset-After" in h:
            a["discord.ratelimit.reset_after"] = float(h["X-RateLimit-Reset-After"])
        a["discord.ratelimit.bucket"] = h.get("X-RateLimit-Bucket")
        if response.status_code < 400:
            body = response.json()
            if messages:
                query = parse_qs(url.query)
                ids = sorted(int(m["id"]) for m in body)
                text = [m for m in body if m.get("type") in TEXT_TYPES]
                a.update({
                    "discord.cursor.after": int(query["after"][0]),
                    "discord.page.limit": int(query["limit"][0]),
                    "discord.page.returned": len(body),
                    "discord.page.first_id": str(ids[0]) if ids else None,
                    "discord.page.last_id": str(ids[-1]) if ids else None,
                    "discord.page.text_messages": len(text),
                    "discord.page.content_empty": sum(
                        1 for m in text if not m.get("content") and not any(m.get(c) for c in CARRIERS)),
                })
            else:
                a["discord.channel.guild_id"] = body.get("guild_id")
                a["discord.channel.type"] = body.get("type")
        self.spans.append((start, end, a))
        return response


class ProbedDiscord(discord.Discord):
    """The Discord backend with the recorder on its client's session."""

    recorder = None

    def _init_client(self, from_archive=False):
        client = super()._init_client(from_archive=from_archive)
        if not from_archive and self.recorder is not None:
            client.session.hooks["response"].append(self.recorder)
        return client


def _id(*parts, size):
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:size]


def run(strategy, guild, channel, family, token, tick, now=None, max_pages=50):
    """Run one probe and return its OTLP spans."""
    now = now or datetime.now(timezone.utc)
    p = strategy_params(strategy, now)
    guild_arg, channel_arg = p["guild"] or guild, p["channel"] or channel
    trace = _id(str(tick), strategy, channel, size=32)
    recorder = Recorder()
    root = {
        "discord.probe.trace": trace, "discord.probe.strategy": strategy,
        "discord.guild_id": guild_arg, "discord.channel.id": channel_arg,
        "discord.channel.family": family,
        "perceval.max_items": p["max_items"], "perceval.min_rate_to_sleep": p["min_rate_to_sleep"],
        "perceval.sleep_for_rate": p["sleep_for_rate"],
    }
    with tempfile.TemporaryDirectory() as tmp:
        archive = ArchiveManager(os.path.join(tmp, "archive")).create_archive() if p["archive"] else None
        backend = ProbedDiscord(guild_arg, channel_arg, token, max_items=p["max_items"], archive=archive,
                                sleep_for_rate=p["sleep_for_rate"], min_rate_to_sleep=p["min_rate_to_sleep"])
        backend.recorder = recorder
        start = time.time_ns()
        uuids = []
        try:
            for item in backend.fetch(from_date=p["from_date"]):
                uuids.append(item["uuid"])
                if len(recorder.spans) > max_pages:
                    root["discord.probe.outcome"] = "truncated"
                    break
            else:
                root["discord.probe.outcome"] = "done"
        except BackendError as e:
            root.update({"discord.probe.outcome": "refused", "error.type": type(e).__name__})
        except (HTTPError, RateLimitError) as e:
            root.update({"discord.probe.outcome": "failed", "error.type": type(e).__name__})
        root["discord.items"] = len(uuids)
        if archive is not None and root["discord.probe.outcome"] == "done":
            replayed = ProbedDiscord(guild_arg, channel_arg, token, max_items=p["max_items"], archive=archive)
            root["discord.replay.equal"] = [i["uuid"] for i in replayed.fetch_from_archive()] == uuids
            with open(archive.archive_path, "rb") as f:
                root["discord.archive.token_free"] = token.encode() not in f.read()
        end = time.time_ns()

    root_id = _id(trace, "root", size=16)
    spans = [{
        "traceId": trace, "spanId": root_id, "name": "discord.probe", "kind": 1,
        "startTimeUnixNano": str(start), "endTimeUnixNano": str(end),
        "attributes": otlp_attrs(root),
        "status": {"code": 2 if root["discord.probe.outcome"] in ("refused", "failed") else 1},
    }]
    for i, (s, e, a) in enumerate(recorder.spans):
        spans.append({
            "traceId": trace, "spanId": _id(trace, str(i), size=16), "parentSpanId": root_id,
            "name": "GET", "kind": 3, "startTimeUnixNano": str(s), "endTimeUnixNano": str(e),
            "attributes": otlp_attrs(a),
            "status": {"code": 2 if a["http.response.status_code"] >= 400 else 0},
        })
    return spans


def channels(guild, token):
    """The guild's message channels and active threads, by family, each sorted by id."""
    client = discord.DiscordClient(token, sleep_for_rate=True)
    listed = client.fetch(urijoin(client.base_url, "guilds", guild, "channels")).json()
    threads = client.fetch(urijoin(client.base_url, "guilds", guild, "threads", "active")).json()["threads"]
    by_family = {}
    for c in listed + threads:
        family = FAMILIES.get(c.get("type"))
        if family:
            by_family.setdefault(family, []).append(c["id"])
    return {f: sorted(ids, key=int) for f, ids in by_family.items()}


def document(spans, version):
    return {"resourceSpans": [{
        "resource": {"attributes": otlp_attrs({
            "service.name": "perceval-discord-live", "service.version": version})},
        "scopeSpans": [{"scope": {"name": "uor.community.discord-live", "version": "1"}, "spans": spans}],
    }]}
