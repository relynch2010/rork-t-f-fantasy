"""Builds the throwaway QA test league: 4 QA accounts, sandbox flag, app auto-draft, and the 7 real 2025-26 Armory
meets as weeks 1-7 (rehearsal meets, imported from AthleticLIVE, then marked final in order).
Never touches the Main League. State goes to /tmp/qa_league.json. Usage: python3 qa/sandbox_setup.py [stage]"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account

ST = "/tmp/qa_league.json"
MEETS = [("54930", "2025-12-12"), ("54946", "2025-12-20"), ("54949", "2026-01-02"), ("54953", "2026-01-09"),
         ("54959", "2026-01-16"), ("54976", "2026-02-07"), ("58418", "2026-02-16")]

def st(): return json.load(open(ST)) if os.path.exists(ST) else {}
def save(d): json.dump(d, open(ST, "w"), indent=1)
def act(lid, tok, body): return req("POST", f"/leagues/{lid}/action", body, tok)

def setup():
    d = st()
    toks = {k: account(k, f"QA {k}") for k in ["commish", "m1", "m2", "m3"]}
    if "lid" not in d:
        r = req("POST", "/leagues", {"name": "QA Audit Sandbox", "teamName": "QA Commish", "settings": {"maxTeams": 4, "regularWeeks": 7, "playoffTeams": 0}}, toks["commish"])
        d["lid"], d["code"] = r["id"], r["code"]; save(d)
        for k in ["m1", "m2", "m3"]:
            j = req("POST", "/leagues/join", {"code": d["code"], "teamName": f"QA {k}"}, toks[k]); print("join", k, j.get("_status", "ok"), j.get("error", ""))
    lid = d["lid"]
    r = act(lid, toks["commish"], {"type": "enableSandbox", "confirm": "TEST LEAGUE"}); print("sandbox", r.get("_status", "ok"), r.get("error", ""))
    print("settings", act(lid, toks["commish"], {"type": "updateSettings", "pickSeconds": 3600}).get("_status", "ok"))
    return d, toks

def draft(d, toks):
    lid = d["lid"]
    r = act(lid, toks["commish"], {"type": "startDraft"}); print("start", r.get("_status", "ok"), r.get("error", ""))
    for i in range(40):
        ok = False
        for k, t in toks.items():
            r = act(lid, t, {"type": "pick"})
            if "_status" not in r: ok = True; break
            if "not your pick" not in str(r.get("error", "")).lower(): print("pick err", k, r); return
        if not ok: break
        v = req("GET", f"/leagues/{lid}", None, toks["commish"])
        if v.get("phase") != "drafting": print("draft done, phase", v.get("phase"), "picks", len(v.get("draft", {}).get("picks", []))); return
    print("draft loop ended")

def meets(d, toks):
    lid, t = d["lid"], toks["commish"]
    d.setdefault("meets", {})
    for i, (mid, date) in enumerate(MEETS, start=1):
        if mid in d["meets"]: continue
        before = {m["id"] for m in req("GET", f"/leagues/{lid}", None, t).get("meets", [])}
        r = act(lid, t, {"type": "createMeet", "testMeet": True, "name": f"Armory {date}", "date": date, "week": i, "provider": "ATHLETICLIVE", "sourceUrl": f"https://live.athletic.net/meets/{mid}"})
        if "_status" in r: print("create", mid, r); return
        new = [m for m in req("GET", f"/leagues/{lid}", None, t).get("meets", []) if m["id"] not in before]
        d["meets"][mid] = new[0]["id"]; save(d)
        print("created", mid, "week", i)

def run(d, toks):
    lid, t = d["lid"], toks["commish"]
    d.setdefault("final", [])
    for mid, _ in MEETS:
        if mid in d["final"]: continue
        m = d["meets"][mid]
        r = act(lid, t, {"type": "startLive", "meetId": m}); print("live", mid, r.get("_status", "ok"), str(r.get("error", ""))[:160])
        r = act(lid, t, {"type": "markFinal", "meetId": m}); print("final", mid, r.get("_status", "ok"), str(r.get("error", ""))[:160])
        if "_status" in r: return
        v = req("GET", f"/leagues/{lid}", None, t)
        print("  week", v.get("week"), "advanceAt", v.get("advanceAt"))
        d["final"].append(mid); save(d)

if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "all"
    d, toks = setup()
    if stage in ("all", "draft"): draft(d, toks)
    if stage in ("all", "meets"): meets(d, toks)
    if stage in ("all", "run"): run(d, toks)
