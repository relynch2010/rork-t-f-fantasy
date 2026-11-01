"""Stage 3 QA (seasons, roles and safety): even-team draft rule, indoor/outdoor season type, new season + archive browse,
leaving a league (with commissioner hand-off), account deletion hand-off, server-side permission checks and cross-league
reads. Throwaway accounts, a throwaway school and throwaway leagues only; never touches the Main League.
Usage: python3 qa/stage3.py   (then python3 qa/stage3.py cleanup)"""
import json, os, sys, time, uuid
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account, toks

ST = "/tmp/qa_stage3.json"
MAIN = "fb75aa8b4e2241a68fce"
SCHOOL = "QA Seasonville High School"
out = {"checks": []}

def st(): return json.load(open(ST)) if os.path.exists(ST) else {}
def save(d): json.dump(d, open(ST, "w"), indent=1)
def act(lid, tok, body): return req("POST", f"/leagues/{lid}/action", body, tok)
def view(lid, tok): return req("GET", f"/leagues/{lid}", None, tok)
def until(fn, secs=40):
    end = time.time() + secs
    while True:
        v = fn()
        if v or time.time() > end: return v
        time.sleep(2)
def check(name, ok, detail=""):
    out["checks"].append({"name": name, "pass": bool(ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))
def denied(r): return r.get("_status") in (400, 401, 403, 404, 409)
def my_leagues(tok): return [l["leagueId"] for l in req("GET", "/leagues", None, tok).get("leagues", [])]

FIRST = ["Arlo", "Bree", "Cole", "Dana", "Eli", "Faye", "Gus", "Hope", "Ike", "Jade", "Kai", "Lena", "Milo", "Nia", "Otto", "Pia",
         "Quin", "Rae", "Sol", "Tess", "Ugo", "Vera", "Wes", "Xia", "Yul", "Zoe", "Abe", "Bea", "Cy", "Di", "Ed", "Flo"]
POS = ["SPR", "DIS", "FLD", "SPR/DIS", "FLEX", "DIS/FLD"]

def main():
    d = st()
    T = {k: account(k, f"QA {k}") for k in ("s3com", "s3m1", "s3m2", "s3m3", "s3bcom", "s3bmem", "s3dcom", "s3dmem", "s3out")}

    # League A (school league): commissioner + 2 members = 3 teams (odd).
    if "la" not in d:
        r = req("POST", "/leagues", {"name": "QA S3 A", "teamName": "A Commish", "school": SCHOOL, "settings": {"maxTeams": 4}}, T["s3com"])
        d["la"], d["la_code"] = r["id"], r["code"]; save(d)
        for k in ("s3m1", "s3m2"): req("POST", "/leagues/join", {"code": d["la_code"], "teamName": f"{k} team"}, T[k])
        rows = [{"name": f"{n} Seasonwell{i}", "gender": "B" if i % 2 else "G", "position": POS[i % 6], "grade": "11"} for i, n in enumerate(FIRST)]
        req("POST", f"/leagues/{d['la']}/tools", {"op": "importRoster", "mode": "commit", "rows": rows, "requestId": uuid.uuid4().hex}, T["s3com"])
        save(d)
    la = d["la"]

    # --- Even team count
    v = view(la, T["s3com"])
    check("View flags an odd team count before the draft", v.get("evenTeamsNeeded") is True and len(v.get("teams", [])) == 3, (v.get("evenTeamsNeeded"), len(v.get("teams", []))))
    r = act(la, T["s3com"], {"type": "startDraft"})
    check("Draft blocked with 3 teams (server)", denied(r) and "even number" in r.get("error", ""), r.get("error"))

    # --- Season type
    r = act(la, T["s3m1"], {"type": "setSeasonType", "seasonType": "outdoor"})
    check("Member can't set the season type", denied(r), r.get("_status"))
    r = act(la, T["s3com"], {"type": "setSeasonType", "seasonType": "outdoor"})
    v = view(la, T["s3com"])
    check("Commissioner sets Outdoor before the draft", v.get("seasonType") == "outdoor" and "Outdoor" in v.get("seasonLabel", ""), (r.get("error"), v.get("seasonLabel")))

    # --- Leave before the draft (member) and rejoin
    r = act(la, T["s3m2"], {"type": "leaveLeague"})
    v = view(la, T["s3com"])
    check("Member leaves before the draft (team removed, league gone from their list)", not r.get("_status") and len(v.get("teams", [])) == 2 and la not in my_leagues(T["s3m2"]), (r.get("error"), len(v.get("teams", []))))
    r = view(la, T["s3m2"])
    check("Former member can't read the league afterwards", denied(r), r.get("_status"))
    for k in ("s3m2", "s3m3"): req("POST", "/leagues/join", {"code": d["la_code"], "teamName": f"{k} team"}, T[k])
    v = view(la, T["s3com"])
    check("Joining still works one person at a time (now 4 teams, even)", len(v.get("teams", [])) == 4 and not v.get("evenTeamsNeeded"), len(v.get("teams", [])))

    # --- Draft league A
    if v.get("phase") == "predraft":
        act(la, T["s3com"], {"type": "updateSettings", "pickSeconds": 3600})
        r = act(la, T["s3com"], {"type": "startDraft"})
        check("Draft starts with 4 teams", not r.get("_status"), r.get("error"))
    for _ in range(80):
        v = view(la, T["s3com"])
        if v.get("phase") != "drafting": break
        for k in ("s3com", "s3m1", "s3m2", "s3m3"): act(la, T[k], {"type": "pick"})
    v = view(la, T["s3com"])
    check("Draft completes; season running", v.get("phase") == "season", v.get("phase"))

    # --- Leave after the draft is refused
    r = act(la, T["s3m1"], {"type": "leaveLeague"})
    check("Member can't leave mid-season (rosters protected)", denied(r) and len(view(la, T["s3com"]).get("teams", [])) == 4, r.get("error"))

    # --- Permissions inside the league
    r = act(la, T["s3m1"], {"type": "startNewSeason", "seasonType": "indoor", "confirm": "NEW SEASON", "endEarly": True})
    check("Member can't start a new season", denied(r), r.get("_status"))
    r = act(la, T["s3m1"], {"type": "updateSettings", "pickSeconds": 60})
    check("Member can't change league settings", denied(r), r.get("_status"))
    r = req("POST", "/global/action", {"type": "transferPlatformRole", "email": "nobody@example.com", "confirm": "TRANSFER"}, T["s3com"])
    check("League commissioner can't transfer the platform role", denied(r), (r.get("_status"), r.get("error")))
    r = req("POST", "/global/action", {"type": "publishScoring", "confirm": "PUBLISH"}, T["s3com"])
    check("League commissioner can't publish universal scoring", denied(r), (r.get("_status"), r.get("error")))
    v = view(la, T["s3com"])
    check("League commissioner gets no global-settings access", not v.get("canEditGlobal"), v.get("canEditGlobal"))

    # --- Cross-league reads (league B is another commissioner's)
    if "lb" not in d:
        r = req("POST", "/leagues", {"name": "QA S3 B", "teamName": "B Commish", "school": SCHOOL, "settings": {"maxTeams": 4}}, T["s3bcom"])
        d["lb"], d["lb_code"] = r["id"], r["code"]; save(d)
        req("POST", "/leagues/join", {"code": d["lb_code"], "teamName": "B Member"}, T["s3bmem"])
    lb = d["lb"]
    r = view(lb, T["s3com"])
    check("Commissioner of league A can't read league B", denied(r), r.get("_status"))
    r = act(lb, T["s3com"], {"type": "updateSettings", "pickSeconds": 60})
    check("Commissioner of league A can't act on league B", denied(r), r.get("_status"))
    r = req("GET", f"/leagues/{lb}/matchup?week=1", None, T["s3m1"])
    check("Member of A can't read B's matchups", denied(r), r.get("_status"))

    # --- New season with archive
    r = act(la, T["s3com"], {"type": "startNewSeason", "seasonType": "indoor", "confirm": "nope", "endEarly": True})
    check("New season needs typed NEW SEASON", denied(r), r.get("error"))
    r = act(la, T["s3com"], {"type": "startNewSeason", "seasonType": "indoor", "confirm": "NEW SEASON"})
    check("Running season can't be replaced without End Early", denied(r) and "still running" in r.get("error", ""), r.get("error"))
    before = view(la, T["s3com"])
    rostered = sum(len([x for x in (t.get("roster") or [])]) for t in before.get("teams", []))
    r = act(la, T["s3com"], {"type": "startNewSeason", "seasonType": "indoor", "confirm": "NEW SEASON", "endEarly": True})
    v = view(la, T["s3com"])
    arch = v.get("archives", [])
    check("New season starts at pre-draft as Indoor with rosters cleared", not r.get("_status") and v.get("phase") == "predraft" and v.get("seasonType") == "indoor"
          and all(not (t.get("roster") or []) for t in v.get("teams", [])), (r.get("error"), v.get("phase"), v.get("seasonType")))
    check("Old season listed in the archive with its champion", len(arch) == 1 and arch[0].get("champion") and "Outdoor" in arch[0].get("label", ""), arch[:1])
    if arch:
        a = req("GET", f"/leagues/{la}/archive?id={arch[0]['id']}", None, T["s3m3"])
        check("Member can browse the archived season (standings, matchups, rosters, transactions)",
              len(a.get("standings", [])) == 4 and len(a.get("rosters", [])) == 4 and sum(len(x["athletes"]) for x in a.get("rosters", [])) > 0 and len(a.get("matchups", [])) > 0 and len(a.get("transactions", [])) > 0,
              {k: len(a.get(k, [])) for k in ("standings", "rosters", "matchups", "transactions")})
        a2 = req("GET", f"/leagues/{la}/archive?id={arch[0]['id']}", None, T["s3bmem"])
        check("Non-member can't read another league's archive", denied(a2), a2.get("_status"))
    check("Teams and members kept across seasons", len(v.get("teams", [])) == 4 and len(before.get("teams", [])) == 4, rostered)
    r = act(la, T["s3com"], {"type": "startDraft"})
    check("New season can be drafted again", not r.get("_status") and view(la, T["s3com"]).get("phase") == "drafting", r.get("error"))

    # --- Cornwall (home) leagues: new season deferred to the platform
    if "lh" not in d:
        r = req("POST", "/leagues", {"name": "QA S3 Home", "teamName": "H Commish", "settings": {"maxTeams": 4}}, T["s3com"])
        d["lh"] = r["id"]; save(d)
    r = act(d["lh"], T["s3com"], {"type": "startNewSeason", "seasonType": "indoor", "confirm": "NEW SEASON", "endEarly": True})
    check("Cornwall Central league can't start its own season (follows the platform)", denied(r), r.get("error"))

    # --- Commissioner leaves league B before the draft: must name a successor
    r = act(lb, T["s3bcom"], {"type": "leaveLeague"})
    check("Commissioner can't leave without naming a successor", denied(r) and "Pick a member" in r.get("error", ""), r.get("error"))
    bmem_id = next(t["id"] for t in view(lb, T["s3bmem"])["teams"] if t["id"] != view(lb, T["s3bcom"])["me"])
    r = act(lb, T["s3bcom"], {"type": "leaveLeague", "newCommissionerTeamId": bmem_id})
    vb = view(lb, T["s3bmem"])
    check("Commissioner leaves after handing off (successor is commissioner, team removed)", not r.get("_status") and vb.get("commissionerId") == bmem_id and len(vb.get("teams", [])) == 1, (r.get("error"), vb.get("commissionerId")))
    check("Hand-off recorded in the audit log", any(x.get("action") == "commissioner.handoff" for x in vb.get("audit", [])), [x.get("action") for x in vb.get("audit", [])][-5:])

    # --- Account deletion forces a hand-off
    if "ld" not in d:
        r = req("POST", "/leagues", {"name": "QA S3 D", "teamName": "D Commish", "school": SCHOOL, "settings": {"maxTeams": 4}}, T["s3dcom"])
        d["ld"], d["ld_code"] = r["id"], r["code"]; save(d)
        req("POST", "/leagues/join", {"code": d["ld_code"], "teamName": "D Member"}, T["s3dmem"])
    ld = d["ld"]
    r = req("POST", "/me/delete", {}, T["s3dcom"])
    need = r.get("needsHandoff", [])
    check("Deleting a commissioner's account is refused until a successor is picked (409 + list)", r.get("_status") == 409 and any(n["leagueId"] == ld for n in need), (r.get("_status"), [n.get("name") for n in need]))
    dmem_id = next(o["teamId"] for n in need if n["leagueId"] == ld for o in n["others"]) if need else ""
    r = req("POST", "/me/delete", {"handoffs": {ld: "not-a-member"}}, T["s3dcom"])
    check("A successor who isn't a member is rejected", r.get("_status") == 409, r.get("_status"))
    r = req("POST", "/me/delete", {"handoffs": {ld: dmem_id}}, T["s3dcom"])
    vd = view(ld, T["s3dmem"])
    check("Account deleted after hand-off; league keeps an active commissioner", not r.get("_status") and vd.get("commissionerId") == dmem_id, (r.get("_status"), r.get("error"), vd.get("commissionerId")))
    T2 = toks(); T2.pop("s3dcom", None); json.dump(T2, open("/tmp/qa_toks.json", "w"))
    r = req("POST", "/me/delete", {}, T["s3out"])
    check("Account with no commissioned leagues deletes normally", not r.get("_status"), r.get("_status"))
    T2 = toks(); T2.pop("s3out", None); json.dump(T2, open("/tmp/qa_toks.json", "w"))

    # --- Privacy: athlete fields visible to league members
    v = view(la, T["s3m1"])
    keys = sorted({k for a in v.get("athletes", []) for k in a.keys()})
    out["athleteFields"] = keys
    bad = [k for k in keys if k.lower() in ("email", "phone", "birthdate", "dob", "address", "userid", "password")]
    check("Athlete records carry no contact or personal fields", not bad, keys)

    out["passed"] = sum(c["pass"] for c in out["checks"]); out["total"] = len(out["checks"])
    print(f"\n{out['passed']}/{out['total']} passed")
    os.makedirs(os.path.join(os.path.dirname(__file__), "results"), exist_ok=True)
    json.dump(out, open(os.path.join(os.path.dirname(__file__), "results", "stage3.json"), "w"), indent=1)

def cleanup():
    d, T = st(), toks()
    if d.get("la") and "s3com" in T:
        for a in view(d["la"], T["s3com"]).get("athletes", []):
            act(d["la"], T["s3com"], {"type": "retireAthlete", "athleteId": a["id"]})
    for key, who in (("la", "s3com"), ("lh", "s3com"), ("lb", "s3bmem"), ("ld", "s3dmem")):
        lid = d.get(key)
        if not lid or lid == MAIN or who not in T: continue
        name = view(lid, T[who]).get("name", "")
        print("delete league", lid, req("POST", f"/leagues/{lid}/delete", {"confirmName": name}, T[who]).get("_status", "ok"))
    for who in [k for k in T if k.startswith("s3")]:
        print("delete account", who, req("POST", "/me/delete", {}, T[who]).get("_status", "ok"))
    json.dump({k: v for k, v in T.items() if not k.startswith("s3")}, open("/tmp/qa_toks.json", "w"))
    if os.path.exists(ST): os.remove(ST)

if __name__ == "__main__":
    cleanup() if (sys.argv[1:] or [""])[0] == "cleanup" else main()
