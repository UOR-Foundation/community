"""The pure half of the live Discord validation: the paging model, the
conformance of a probe's telemetry to it, and the learning engine that picks
the next tick's probes.

Nothing here touches the network or Perceval, so it is tested anywhere with
`python3 -m unittest`. `probe.py` produces the telemetry; `tick.py` runs a
tick end to end.

Telemetry is OpenTelemetry trace data in OTLP/JSON. A probe is one trace: a
root span named `discord.probe` and one child span per HTTP request, carrying
the HTTP client semantic conventions (`http.request.method`, `url.template`,
`http.response.status_code`) and `discord.*` attributes. No span holds
message content, an author or a token: only ids, counts and headers.

The engine follows the bounded Hebbian pattern of afflom/rule30
(tools/r30/enginemodel.py) and casey-allard/lexlean-r4 (xtask/src/engine.rs):
integer weights per (family, strategy) in [W_MIN, W_MAX], raised when a probe
was informative and lowered when it was not, consolidated as committed state,
and a schedule that orders strategies by weight with ties in portfolio order.
"""

import hashlib
import json
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL_LOCK = HERE / "model.lock.json"

# The Discord API v10 channel types a probe can read messages from, grouped
# into the families the engine learns about. A forum (15) and a media
# channel (16) hold no messages of their own; their posts are threads.
FAMILIES = {
    0: "text", 5: "announcement", 2: "voice", 13: "voice",
    10: "thread", 11: "thread", 12: "thread",
}

# The probe portfolio, in tie-break order. Each exercises a part of the model:
# full/recent/small read real pages (REQ-008 and otherwise), replay checks
# the archive round trip, foreign names another guild (REQ-004), missing
# names an unknown channel (REQ-006) and floor sets the rate floor above the
# bucket (REQ-009).
STRATEGIES = ["full", "recent", "small", "replay", "foreign", "missing", "floor"]

W_MIN, W_MAX, W_INITIAL = 1, 16, 8
RAISE, LOWER = 2, 1
HISTORY = 12


# --- the model ---------------------------------------------------------------

def load_model(text=None):
    """The state machine of the pinned prompt, refused unless its digest matches."""
    lock = json.loads(MODEL_LOCK.read_text())
    if text is None:
        url = "https://raw.githubusercontent.com/{repository}/{commit}/{path}".format(**lock)
        with urllib.request.urlopen(url, timeout=30) as response:
            text = response.read()
    if isinstance(text, str):
        text = text.encode()
    digest = hashlib.sha256(text).hexdigest()
    if digest != lock["sha256"]:
        raise ValueError("{path} at {commit} is {got}, the lock pins {sha256}".format(got=digest, **lock))
    prompt = json.loads(text)
    if prompt.get("pattern") != "stateMachine":
        raise ValueError("the pinned prompt is not a state machine")
    return prompt["app"]


def rule_ids(app):
    return ["REQ-{:03d}".format(i + 1) for i in range(len(app["rules"]))] + ["otherwise"]


def _operand(value, record):
    return record[value["field"]] if isinstance(value, dict) else value


def _holds(cond, record):
    left, right, op = record[cond["field"]], _operand(cond["value"], record), cond["op"]
    return {
        "is": lambda: left == right, "=": lambda: left == right,
        "is not": lambda: left != right, "!=": lambda: left != right,
        "<": lambda: left < right, "<=": lambda: left <= right,
        ">": lambda: left > right, ">=": lambda: left >= right,
    }[op]()


def decide(app, record):
    """The model's next state for a record, and the rule that decided it (first hit)."""
    for i, rule in enumerate(app["rules"]):
        if all(_holds(c, record) for c in rule["when"]):
            return rule["then"], "REQ-{:03d}".format(i + 1)
    return app["otherwise"], "otherwise"


# --- telemetry ---------------------------------------------------------------

def attrs(span):
    """An OTLP span's attributes as a plain dict."""
    out = {}
    for a in span.get("attributes", []):
        v = a["value"]
        out[a["key"]] = next(iter(v.values()))
    return out


def otlp_value(v):
    if isinstance(v, bool):
        return {"boolValue": v}
    if isinstance(v, int):
        return {"intValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    return {"stringValue": str(v)}


def otlp_attrs(d):
    return [{"key": k, "value": otlp_value(v)} for k, v in sorted(d.items()) if v is not None]


def probes(otlp):
    """Each probe of an OTLP/JSON document: (root attributes, request attributes in order)."""
    spans = [s for rs in otlp["resourceSpans"] for ss in rs["scopeSpans"] for s in ss["spans"]]
    roots = [s for s in spans if s["name"] == "discord.probe"]
    out = []
    for root in roots:
        children = [s for s in spans if s.get("parentSpanId") == root["spanId"]]
        children.sort(key=lambda s: int(s["startTimeUnixNano"]))
        out.append((attrs(root), [attrs(c) for c in children]))
    return out


def classify(request, guild):
    """The model's `response` value for one request span."""
    status = int(request["http.response.status_code"])
    if status >= 400:
        return "error"
    if request["url.template"] == "/channels/{channel}":
        return "ok" if request.get("discord.channel.guild_id") == guild else "foreign"
    first, after = request.get("discord.page.first_id"), request.get("discord.cursor.after")
    if first is not None and int(first) <= int(after):
        return "stale"
    return "ok"


def steps(root, requests):
    """The model records a probe's telemetry implies, each with the next state observed.

    The state before a request is `channel` for the first and `paging` after
    it. The next state is `paging` when another request followed, and the
    probe's outcome after the last one. A probe its page budget cut short
    has no observed next state for its last request, which is then left out.
    """
    out = []
    floor, sleep = int(root["perceval.min_rate_to_sleep"]), root["perceval.sleep_for_rate"]
    limit = int(root["perceval.max_items"])
    for i, request in enumerate(requests):
        if i + 1 < len(requests):
            observed = "paging"
        elif root["discord.probe.outcome"] == "truncated":
            break
        else:
            observed = root["discord.probe.outcome"]
        remaining = request.get("discord.ratelimit.remaining")
        record = {
            "state": "channel" if i == 0 else "paging",
            "response": classify(request, root["discord.guild_id"]),
            "returned": int(request.get("discord.page.returned", 0)),
            "limit": limit,
            # A response without the header: the client never sleeps, which
            # the model states as a remaining above the floor.
            "remaining": int(remaining) if remaining is not None else floor + 1,
            "floor": floor,
            "sleep": "yes" if sleep else "no",
        }
        out.append((record, observed))
    return out


def conform(app, otlp):
    """Check every probe against the model: the divergences and the rules each probe exercised."""
    divergences, exercised = [], []
    for root, requests in probes(otlp):
        rules = set()
        for record, observed in steps(root, requests):
            expected, rule = decide(app, record)
            rules.add(rule)
            if expected != observed:
                divergences.append({
                    "trace": root["discord.probe.trace"], "strategy": root["discord.probe.strategy"],
                    "record": record, "rule": rule, "expected": expected, "observed": observed,
                })
        for check in ("discord.replay.equal", "discord.archive.token_free"):
            if root.get(check) is False:
                divergences.append({
                    "trace": root["discord.probe.trace"], "strategy": root["discord.probe.strategy"],
                    "check": check,
                })
        exercised.append((root, sorted(rules)))
    divergences += content_intent(otlp)
    return divergences, exercised


# Without the Message Content intent Discord still answers 200, with every
# text message's content empty: data loss no status code shows. Below this
# many text messages the sample says nothing.
INTENT_SAMPLE, INTENT_EMPTY_SHARE = 10, 0.9


def content_intent(otlp):
    """A divergence when nearly every text message read came back without content."""
    text = empty = 0
    for _, requests in probes(otlp):
        for r in requests:
            text += int(r.get("discord.page.text_messages", 0))
            empty += int(r.get("discord.page.content_empty", 0))
    if text >= INTENT_SAMPLE and empty >= INTENT_EMPTY_SHARE * text:
        return [{"check": "discord.content.intent", "text_messages": text, "content_empty": empty}]
    return []


# --- the engine --------------------------------------------------------------

def initial_state():
    return {"schema": "uor-community/discord-live-engine/1", "tick": 0,
            "weights": {}, "coverage": {}, "history": []}


def weight(state, family, strategy):
    return state["weights"].get(family, {}).get(strategy, W_INITIAL)


def learn(state, family, strategy, informative):
    """The bounded Hebbian rule: raise an informative strategy, lower the rest, clamp."""
    w = weight(state, family, strategy) + (RAISE if informative else -LOWER)
    state["weights"].setdefault(family, {})[strategy] = max(W_MIN, min(W_MAX, w))


def schedule(state, family, k):
    """The k strategies to run for a family: by weight, ties in portfolio order."""
    order = sorted(range(len(STRATEGIES)), key=lambda i: (-weight(state, family, STRATEGIES[i]), i))
    return [STRATEGIES[i] for i in order[:k]]


def consolidate(state, exercised, divergences, tick_id):
    """Fold a tick's outcomes into the state: coverage, weights and history.

    A probe is informative when it diverged from the model or exercised a
    rule its family had not exercised before: coverage-guided, so probes that
    keep confirming known behavior lose weight to the ones that reach new
    parts of the model.
    """
    diverged = {d["trace"] for d in divergences}
    for root, rules in exercised:
        family, strategy = root["discord.channel.family"], root["discord.probe.strategy"]
        seen = set(state["coverage"].get(family, []))
        new = set(rules) - seen
        learn(state, family, strategy, bool(new) or root["discord.probe.trace"] in diverged)
        state["coverage"][family] = sorted(seen | set(rules))
    state["tick"] += 1
    state["history"] = (state["history"] + [{
        "tick": tick_id, "probes": len(exercised), "divergences": len(divergences),
    }])[-HISTORY:]
    return state


def observable(app):
    """The rules a probe can exercise: not those that only keep a final state final."""
    final = set(app.get("final", ["done", "refused", "failed"]))
    keep = []
    for rid, rule in zip(rule_ids(app), app["rules"] + [None]):
        absorbing = rule is not None and any(
            c["field"] == "state" and c["op"] == "is" and c["value"] in final for c in rule["when"])
        if not absorbing:
            keep.append(rid)
    return keep


def uncovered(app, state):
    """The observable rules no family has exercised live yet: what the model still claims unobserved."""
    seen = set().union(*[set(v) for v in state["coverage"].values()]) if state["coverage"] else set()
    return [r for r in observable(app) if r not in seen]


if __name__ == "__main__":
    # python live.py fetch <out>: write the pinned prompt, checked, to <out>.
    import sys
    if sys.argv[1:2] != ["fetch"] or len(sys.argv) != 3:
        sys.exit("usage: live.py fetch <out>")
    lock = json.loads(MODEL_LOCK.read_text())
    url = "https://raw.githubusercontent.com/{repository}/{commit}/{path}".format(**lock)
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read()
    load_model(data)
    Path(sys.argv[2]).write_bytes(data)
