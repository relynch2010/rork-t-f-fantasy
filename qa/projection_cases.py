"""Projection cases with real athletes in the QA test league: week 7 (finished, what the old screens showed) vs week 8 (fixed)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, toks
d = json.load(open("/tmp/qa_league.json")); t = toks()["commish"]; lid = d["lid"]
w7 = req("GET", f"/leagues/{lid}/projections?week=7", None, t)["athletes"]
rk = {r["athleteId"]: r for r in req("GET", f"/leagues/{lid}/projections?week=7&rankings=1", None, t)["rows"]}
rk8 = req("GET", f"/leagues/{lid}/projections?week=8&rankings=1", None, t)
r8 = {r["athleteId"]: r for r in rk8["rows"]}
print("rankings requested week 7 ->", next(iter([req("GET", f"/leagues/{lid}/projections?week=7&rankings=1", None, t)]))["targetWeek"])
ids = sys.argv[1:] or ["madelinelarkin", "albertkirienko", "aidenjeanmarie", "abubakardiallo", "madisonriccardi", "aidenschultze"]
for a in ids:
    p = w7.get(a, {}); r = r8.get(a, {})
    print(a, "| w7:", p.get("state"), p.get("projected"), p.get("actual"), "|", p.get("note", "")[:60],
          "| rank(w7 req):", rk.get(a, {}).get("state"), rk.get(a, {}).get("projected"),
          "| w8:", r.get("state"), r.get("projected"), "up", r.get("upside"), "outlook", r.get("outlookPerMeet"), r.get("availability"))
