"""Projection scenarios on the QA sandbox league (real 2025-26 Armory results) + the fresh preseason probe league.
Checks: every week's projection only uses marks dated before that week's meet; byes; typical-meet estimates.
Writes qa/results/projection_scenarios.json. Usage: python3 qa/projection_scenarios.py"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account

d = json.load(open("/tmp/qa_league.json"))
lid, t = d["lid"], account("commish")
pre_lid, pre_t = json.load(open("/tmp/qa_pre.json"))["lid"], account("probe2")
out = {"leak": [], "weeks": {}, "preseason": {}, "bye": {}}

def proj(L, tok, q): return req("GET", f"/leagues/{L}/projections?{q}", None, tok, timeout=240)

# Preseason: fresh league, no results of its own, real Main League schedule (first meet 2026-12-11).
r = proj(pre_lid, pre_t, "rankings=1&week=1")
out["preseason"] = {"stateCounts": r.get("stateCounts"), "top": [(x["athleteId"], x["projected"]) for x in sorted(r["rows"], key=lambda x: -x["projected"])[:5]]}

# Midseason / postseason: weeks 1-7 are finished Armory meets; check no future marks are used.
v = req("GET", f"/leagues/{lid}", None, t)
rostered = sorted({a for tm in v.get("teams", []) for a in tm.get("roster", [])})[:12]
for w in range(1, 10):
    r = proj(lid, t, f"rankings=1&week={w}")
    out["weeks"][w] = {"noMeet": r.get("noMeet"), "estimate": r.get("estimate"), "stateCounts": r.get("stateCounts")}
    for a in rostered:
        p = proj(lid, t, f"athleteId={a}&week={w}")
        pr, date = p.get("projection") or {}, p.get("date")
        for e in pr.get("events", []):
            for s in e.get("sources", []) or []:
                if s["date"] >= date and not pr.get("estimate"):
                    out["leak"].append({"week": w, "athlete": a, "event": e["event"], "source": s, "weekDate": date})
    print("week", w, out["weeks"][w])

# Bye: schedule an upcoming test meet in week 10 -> weeks 8-9 become byes ("No meet this week"), not estimates.
before = {m["id"] for m in v.get("meets", [])}
c = req("POST", f"/leagues/{lid}/action", {"type": "createMeet", "testMeet": True, "name": "QA future meet", "date": "2026-12-30", "week": 10, "provider": "ATHLETICLIVE", "sourceUrl": "https://live.athletic.net/meets/58418"}, t)
new = [m["id"] for m in req("GET", f"/leagues/{lid}", None, t).get("meets", []) if m["id"] not in before]
for w in (8, 9):
    r = proj(lid, t, f"rankings=1&week={w}")
    out["bye"][w] = {"noMeet": r.get("noMeet"), "estimate": r.get("estimate"), "stateCounts": r.get("stateCounts"), "create": c.get("_status", "ok")}
for m in new: req("POST", f"/leagues/{lid}/action", {"type": "deleteMeet", "meetId": m}, t)
print("bye", out["bye"])
print("leaks", len(out["leak"]), out["leak"][:3])
json.dump(out, open(os.path.join(os.path.dirname(__file__), "results/projection_scenarios.json"), "w"), indent=1)
