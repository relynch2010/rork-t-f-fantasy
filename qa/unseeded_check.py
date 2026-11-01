"""Unseeded percentile check in the QA test league only: re-imports one real Armory meet as an open week-8 test meet
(left LIVE, not final), previews and publishes non-zero sandbox unseeded brackets, then counts "unseeded" breakdown
lines. Also confirms the global (Main League) rules keep zeros. Writes qa/results/unseeded_check.json."""
import json, os, sys, time, uuid
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account

d = json.load(open("/tmp/qa_league.json")); lid = d["lid"]; t = account("commish")
act = lambda body: req("POST", f"/leagues/{lid}/action", body, t)
out = {}
meet = d.get("unseededMeet")
if not meet:
    before = {m["id"] for m in req("GET", f"/leagues/{lid}", None, t).get("meets", [])}
    r = act({"type": "createMeet", "testMeet": True, "name": "Armory unseeded check", "date": "2026-01-16", "week": 8, "provider": "ATHLETICLIVE", "sourceUrl": sys.argv[1] if len(sys.argv) > 1 else "https://live.athletic.net/meets/54959"})
    out["create"] = r.get("_status", "ok")
    meet = [m["id"] for m in req("GET", f"/leagues/{lid}", None, t)["meets"] if m["id"] not in before][0]
    d["unseededMeet"] = meet; json.dump(d, open("/tmp/qa_league.json", "w"), indent=1)
if not d.get("unseededLive"):
    out["live"] = str(act({"type": "startLive", "meetId": meet}).get("error", "ok"))[:200]; time.sleep(20)
rules = {"percentileUnseeded": [{"pct": 0.05, "pts": 6}, {"pct": 0.1, "pts": 4}, {"pct": 0.2, "pts": 3}, {"pct": 0.3, "pts": 2}, {"pct": 0.4, "pts": 1}]}
admin = lambda op, **kw: req("POST", f"/leagues/{lid}/tools", {"op": op, "mode": "sandbox", **kw}, t)
if d.get("unseededPublished"): pv = pub = {}
else: pv = admin("draftPreview", rules=rules)
out["preview"] = {k: pv.get(k) for k in ("athletesAffected", "unchanged", "error", "_status")}
if not d.get("unseededPublished"): pub = admin("sandboxPublish", rules=rules, confirm="PUBLISH", requestId=uuid.uuid4().hex)
out["publish"] = {k: pub.get(k) for k in ("ok", "message", "error", "_status")}
time.sleep(5)
v = req("GET", f"/leagues/{lid}", None, t)
lines, uns = [], []
for aid in [k for k, w in v.get("points", {}).items() if "8" in w]:
    a = {"id": aid}
    b = req("GET", f"/leagues/{lid}/breakdown?week=8&athleteId={aid}", None, t)
    ls = [l for e in b.get("events", []) for l in (e.get("lines") or e.get("items") or [])]
    lines += ls; uns += [{"athlete": a["id"], **l} if isinstance(l, dict) else {"athlete": a["id"], "line": l} for l in ls if "unseeded" in json.dumps(l).lower()]
out["week8Lines"] = len(lines); out["unseededLines"] = len(uns); out["samples"] = uns[:4]
g = req("GET", "/global", None, t); g = g.get("config", g)
latest = sorted(g["rules"], key=lambda x: x.get("version", 0))[-1]
out["mainLeagueUnseeded"] = latest["rules"].get("percentileUnseeded")
json.dump(out, open(os.path.join(os.path.dirname(__file__), "results/unseeded_check.json"), "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != "samples"}, indent=1)); print(json.dumps(out["samples"][:2])[:800])
