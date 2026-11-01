"""Before/after capture for the 5-tier tables + unseeded brackets migration on the QA sandbox league (real Armory data).
Usage: python3 qa/before_after.py before|after|report   -> qa/results/tables_v2_{before,after,report}.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account

R = os.path.join(os.path.dirname(__file__), "results")
d = json.load(open("/tmp/qa_league.json"))
lid, t = d["lid"], account("commish")

def capture():
    v = req("GET", f"/leagues/{lid}", None, t)
    names = {a["id"]: a["name"] for a in v.get("athletes", [])}
    teams = {x["id"]: x.get("name") for x in v["teams"]}
    sched = [{"id": m["id"], "week": m["week"], "home": teams.get(m["homeId"]), "away": teams.get(m["awayId"]),
              "homeScore": m.get("homeScore"), "awayScore": m.get("awayScore"), "homeFinal": m.get("homeFinal"), "awayFinal": m.get("awayFinal")} for m in v["schedule"]]
    return {"points": v["points"], "names": names, "schedule": sched, "standings": v.get("standings"), "global": req("GET", "/global/status")}

def report():
    b, a = json.load(open(f"{R}/tables_v2_before.json")), json.load(open(f"{R}/tables_v2_after.json"))
    ath = []
    for aid in sorted(set(b["points"]) | set(a["points"])):
        tb, ta = sum(b["points"].get(aid, {}).values()), sum(a["points"].get(aid, {}).values())
        if abs(tb - ta) > 1e-6: ath.append({"athlete": a["names"].get(aid, aid), "id": aid, "before": round(tb, 2), "after": round(ta, 2), "delta": round(ta - tb, 2)})
    ath.sort(key=lambda x: -abs(x["delta"]))
    flips = []
    sb = {m["id"]: m for m in b["schedule"]}
    for m in a["schedule"]:
        o = sb.get(m["id"])
        if not o or o["homeScore"] is None or m["homeScore"] is None: continue
        w0 = (o["homeScore"] > o["awayScore"]) - (o["homeScore"] < o["awayScore"])
        w1 = (m["homeScore"] > m["awayScore"]) - (m["homeScore"] < m["awayScore"])
        if w0 != w1: flips.append({"week": m["week"], "match": f'{m["home"]} vs {m["away"]}', "before": [o["homeScore"], o["awayScore"]], "after": [m["homeScore"], m["awayScore"]], "frozenFinal": [m["homeFinal"], m["awayFinal"]]})
    # Lines for changed athletes: which come from unseeded sections / table tiers.
    unseeded = []
    for x in ath[:40]:
        for w in sorted(a["points"].get(x["id"], {}).keys()):
            br = req("GET", f"/leagues/{lid}/breakdown?athleteId={x['id']}&week={w}", None, t)
            for ln in json.dumps(br).split('"label": ')[1:]:
                lab = ln.split('"')[1]
                if "unseeded" in lab.lower(): unseeded.append({"athlete": x["athlete"], "week": w, "label": lab})
    out = {"changedAthletes": len(ath), "athletes": ath, "matchupFlips": flips, "unseededLines": unseeded[:100],
           "totalBefore": round(sum(sum(p.values()) for p in b["points"].values()), 2), "totalAfter": round(sum(sum(p.values()) for p in a["points"].values()), 2)}
    json.dump(out, open(f"{R}/tables_v2_report.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in out.items() if k not in ("athletes", "unseededLines")}, indent=1)[:3000])
    print("top changes", ath[:10]); print("unseeded lines", len(unseeded), unseeded[:5])

if __name__ == "__main__":
    mode = sys.argv[1]
    if mode in ("before", "after"):
        json.dump(capture(), open(f"{R}/tables_v2_{mode}.json", "w"), indent=1); print("saved", mode)
    else: report()
