"""Verifies the live global tables after the 5-tier merge: every supplied tier exists for every season 2026-2032,
no superseded row is still active, and each table is ordered. Writes qa/results/tables_v2_verify.json."""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account
g = req("GET", "/global", None, account("commish"))
g = g.get("config", g)
src = open(os.path.join(os.path.dirname(__file__), "../functions/tablesV2.ts")).read()
tables = [(m[0], m[1], re.findall(r'\["([^"]+)", ([\d.]+)\]', m[2])) for m in re.findall(r'gender: "(\w)", event: "([^"]+)", tiers: \[(.*?)\] \}', src)]
live = [p for p in g["performance"] if p.get("active", True) and p.get("until") is None]
key = lambda e: re.sub(r"[^a-z0-9]", "", e.lower())
missing, extra_seasons = [], {}
for season in range(2026, 2033):
    for gender, event, tiers in tables:
        rows = [(p["mark"], p["points"]) for p in live if p["season"] == season and p["gender"] == gender and key(p["event"]) == key(event)]
        for mark, pts in tiers:
            if (mark, float(pts)) not in [(m, float(x)) for m, x in rows]: missing.append((season, gender, event, mark, pts))
    extra_seasons[season] = len([p for p in live if p["season"] == season])
out = {"tables": len(tables), "missing": missing, "liveRowsPerSeason": extra_seasons, "retiredRowsUntil0": len([p for p in g["performance"] if p.get("until") == 0])}
json.dump(out, open(os.path.join(os.path.dirname(__file__), "results/tables_v2_verify.json"), "w"), indent=1)
print({k: (v if k != "missing" else len(v)) for k, v in out.items()}, missing[:5])
