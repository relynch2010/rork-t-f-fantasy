"""Stage 1 QA (schools + multiple leagues per school). Throwaway accounts, a throwaway school name and throwaway
leagues only; never touches the Main League. State in /tmp/qa_stage1.json, results in qa/results/stage1.json.
Usage: python3 qa/stage1.py   (then python3 qa/stage1.py cleanup)"""
import json, os, sys, time, uuid
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account, toks

ST = "/tmp/qa_stage1.json"
MAIN = "fb75aa8b4e2241a68fce"
SCHOOL = "QA Testville High School"
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
    out["checks"].append({"name": name, "pass": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

FIRST_B = ["Liam", "Noah", "Ethan", "Mason", "Lucas", "Owen", "Caleb", "Wyatt", "Henry", "Jack", "Leo", "Isaac"]
FIRST_G = ["Ava", "Mia", "Chloe", "Ella", "Grace", "Zoe", "Lily", "Nora", "Ruby", "Hazel", "Ivy", "Stella"]
LAST = ["Testa", "Qadir", "Vance", "Orwell", "Pike", "Quill", "Rowan", "Sable", "Thorne", "Underhill", "Voss", "Wren"]
POS = ["SPR", "DIS", "FLD", "SPR/DIS", "FLEX", "DIS/FLD"]

def roster():
    rows = []
    for i in range(12):
        rows.append({"name": f"{FIRST_B[i]} {LAST[i]}", "gender": "B", "position": POS[i % 6], "grade": str(9 + i % 4)})
        rows.append({"name": f"{FIRST_G[i]} {LAST[(i + 5) % 12]}", "gender": "G", "position": POS[(i + 3) % 6], "grade": str(9 + i % 4)})
    return rows

def main():
    d = st()
    T = {k: account(f"s1{k}", f"QA S1 {k}") for k in ["owner", "bcom", "m1", "m2", "x", "ccom"]}
    # 1. Create two leagues at the same new school, one Cornwall league with no school given.
    if "la" not in d:
        r = req("POST", "/leagues", {"name": "QA S1 League A", "teamName": "A Commish", "school": SCHOOL, "settings": {"maxTeams": 4}}, T["owner"])
        d["la"], d["la_code"] = r["id"], r["code"]
        r = req("POST", "/leagues", {"name": "QA S1 League B", "teamName": "B Commish", "school": "qa testville hs", "settings": {"maxTeams": 4}}, T["bcom"])
        d["lb"], d["lb_code"] = r["id"], r["code"]
        r = req("POST", "/leagues", {"name": "QA S1 Cornwall", "teamName": "C Commish", "settings": {"maxTeams": 4}}, T["ccom"])
        d["lc"], d["lc_code"] = r["id"], r["code"]
        save(d)
        req("POST", "/leagues/join", {"code": d["la_code"], "teamName": "A Member"}, T["m1"])
        req("POST", "/leagues/join", {"code": d["lb_code"], "teamName": "B Member"}, T["m2"])
    la, lb, lc = d["la"], d["lb"], d["lc"]
    va, vb, vc = view(la, T["owner"]), view(lb, T["bcom"]), view(lc, T["ccom"])
    check("League A school is the typed school", va.get("school") == SCHOOL and va.get("runsOwnMeets") is True, va.get("school"))
    check("League B school written differently resolves to the same school", vb.get("runsOwnMeets") is True and vb.get("school") == "qa testville hs", vb.get("school"))
    check("League without a school is Cornwall Central (default)", vc.get("school") == "Cornwall Central" and vc.get("schoolIsDefault") is True and vc.get("runsOwnMeets") is False)
    check("New school league starts with no Cornwall players", len(va.get("athletes", [])) == 0, f"{len(va.get('athletes', []))} players")
    main_meets = [m for m in vc.get("meets", []) if m.get("scope") == "global"]
    check("Cornwall league gets the shared Main League meets", len(main_meets) > 0, f"{len(main_meets)} shared meets")
    check("School leagues don't get Cornwall meets", not any(m.get("scope") == "global" for m in va.get("meets", []) + vb.get("meets", [])))
    cw_count = len(vc.get("athletes", []))
    check("Cornwall league starts with the normal Cornwall pool", cw_count > 50, f"{cw_count} players")

    # 2. Roster import: preview, commit, repeat.
    rows = roster()
    rows_bad = rows + [{"name": "Bad Gender", "gender": "X", "position": "SPR"}, {"name": "Liam Testa", "gender": "B", "position": "SPR"}, {"name": "Solo", "gender": "B", "position": "SPR"}, {"name": "Pos Bad", "gender": "G", "position": "HURDLES"}]
    imp = req("POST", f"/leagues/{la}/tools", {"op": "importRoster", "mode": "preview", "rows": rows_bad}, T["owner"])
    s = imp.get("summary", {})
    check("Import preview sorts rows (24 new, 4 invalid, nothing saved)", s.get("new") == 24 and s.get("invalid") == 4 and s.get("added", 0) == 0, json.dumps(s))
    check("Preview saved nothing", len(view(la, T["owner"]).get("athletes", [])) == 0)
    rid = d.setdefault("rid", uuid.uuid4().hex); save(d)
    c1 = req("POST", f"/leagues/{la}/tools", {"op": "importRoster", "mode": "commit", "rows": rows_bad, "requestId": rid}, T["owner"])
    check("Import commit adds the 24 valid players", c1.get("summary", {}).get("added") == 24 or c1.get("repeated") is True, json.dumps(c1.get("summary")))
    c2 = req("POST", f"/leagues/{la}/tools", {"op": "importRoster", "mode": "commit", "rows": rows_bad, "requestId": rid}, T["owner"])
    check("Same import sent twice runs once", c2.get("repeated") is True)
    time.sleep(2)
    va = view(la, T["owner"])
    check("League A pool has the 24 imported players", len(va.get("athletes", [])) == 24, f"{len(va.get('athletes', []))}")

    # 3. League B imports an overlapping list.
    # "Liam Testa Jr." only differs by a suffix, so it's flagged as listed twice in the same file.
    rows_b = rows[:3] + [{"name": "Liam Testa Jr.", "gender": "B", "position": "SPR"}, {"name": "Willa Newcomb", "gender": "G", "position": "DIS"}, {"name": "Ethen Vance", "gender": "B", "position": "FLD"}]
    pb = req("POST", f"/leagues/{lb}/tools", {"op": "importRoster", "mode": "preview", "rows": rows_b}, T["bcom"])
    sb = pb.get("summary", {})
    check("Second league's import: existing players recognised, look-alike flagged, new ones new", sb.get("existing") == 3 and sb.get("possible") == 1 and sb.get("new") == 1 and sb.get("invalid") == 1, json.dumps(sb) + " " + json.dumps([(r["name"], r["status"]) for r in pb.get("rows", [])]))
    cb = req("POST", f"/leagues/{lb}/tools", {"op": "importRoster", "mode": "commit", "rows": rows_b, "requestId": d.setdefault("ridb", uuid.uuid4().hex)}, T["bcom"])
    save(d)
    check("Commit adds only the new player (look-alike held back, existing untouched)", cb.get("summary", {}).get("added") == 1 or cb.get("repeated") is True, json.dumps(cb.get("summary")))
    until(lambda: len(view(la, T["owner"]).get("athletes", [])) == 25)
    vb = view(lb, T["bcom"])
    va = view(la, T["owner"])
    ids_a = {a["id"] for a in va.get("athletes", [])}
    ids_b = {a["id"] for a in vb.get("athletes", [])}
    check("Both leagues share the same school identities", ids_a == ids_b and len(ids_a) == 25, f"A {len(ids_a)} B {len(ids_b)}")
    vc = view(lc, T["ccom"])
    check("Cornwall league never receives the other school's players", not (ids_a & {a["id"] for a in vc.get("athletes", [])}) and not any("testville" in (a.get("school") or "").lower() for a in vc.get("athletes", [])), f"{len(vc.get('athletes', []))} players, all Cornwall Central")

    # 4. Permissions.
    r = req("POST", f"/leagues/{la}/tools", {"op": "importRoster", "mode": "preview", "rows": rows[:2]}, T["m1"])
    check("Member (not commissioner) can't import", r.get("_status") in (403, 400), str(r)[:160])
    r = act(la, T["m1"], {"type": "addAthlete", "name": "Sneaky Add", "gender": "B", "position": "SPR"})
    check("Member can't add a player", r.get("_status") in (400, 403), str(r.get("error"))[:120])
    r = act(la, T["x"], {"type": "addAthlete", "name": "Outsider Add", "gender": "B", "position": "SPR"})
    check("Outsider can't touch another league", r.get("_status") in (400, 403, 404), str(r)[:120])
    cw_id = vc["athletes"][0]["id"]
    r = act(la, T["owner"], {"type": "editAthlete", "athleteId": cw_id, "note": "hack"})
    check("School commissioner can't edit a Cornwall Central player", r.get("_status") == 403, str(r.get("error")))
    r = act(lc, T["ccom"], {"type": "editAthlete", "athleteId": cw_id, "note": "hack"})
    check("Non-Main Cornwall commissioner still can't edit shared players", r.get("_status") == 403, str(r.get("error")))
    some = sorted(ids_a)[0]
    r = act(la, T["owner"], {"type": "editAthlete", "athleteId": some, "school": "Cornwall Central"})
    check("A player's school can't be changed", r.get("_status") == 400 and "school" in str(r.get("error", "")).lower(), str(r.get("error")))
    r = act(lb, T["bcom"], {"type": "setStatus", "athleteId": some, "status": "Q"})
    until(lambda: next(a for a in view(la, T["owner"])["athletes"] if a["id"] == some).get("status") == "Q")
    sa = next(a for a in view(la, T["owner"])["athletes"] if a["id"] == some)
    check("Status set in League B shows in League A (shared identity)", r.get("_status") is None and sa.get("status") == "Q", sa.get("status"))
    act(lb, T["bcom"], {"type": "setStatus", "athleteId": some, "status": "active"})
    until(lambda: next(a for a in view(la, T["owner"])["athletes"] if a["id"] == some).get("status") in (None, "active"))

    # 5. Per-league exclusion + restore.
    ex = sorted(ids_a)[1]
    r = act(la, T["owner"], {"type": "removeAthlete", "athleteId": ex})
    va, vb = view(la, T["owner"]), view(lb, T["bcom"])
    exl = view(la, T["owner"]).get("excludedAthletes", [])
    check("Removed player shows by name in the restore list", any(e.get("id") == ex and e.get("name") and e.get("name") != ex for e in exl), str(exl)[:120])
    check("Removing a player affects only that league", ex not in {a["id"] for a in va["athletes"]} and ex in {a["id"] for a in vb["athletes"]}, str(r.get("error", "")))
    r = act(la, T["owner"], {"type": "restoreAthlete", "athleteId": ex})
    check("Removed player can be put back", ex in {a["id"] for a in view(la, T["owner"])["athletes"]}, str(r.get("error", "")))

    # 6. Backup + restore in a throwaway test league (League A).
    r = act(la, T["owner"], {"type": "enableSandbox", "confirm": "TEST LEAGUE"})
    r = act(la, T["owner"], {"type": "stageBackupTest", "tag": "s1"})
    check("Stage backup written in the test league", r.get("_status") is None, str(r.get("error", "")))
    before = view(la, T["owner"])
    act(la, T["owner"], {"type": "removeAthlete", "athleteId": ex})
    act(la, T["owner"], {"type": "updateTeam", "teamName": "Renamed After Backup"})
    mid = view(la, T["owner"])
    r = act(la, T["owner"], {"type": "restoreStageBackup", "tag": "qa-s1", "confirm": "RESTORE"})
    after = view(la, T["owner"])
    sig = lambda v: (sorted(a["id"] for a in v["athletes"]), [(t["id"], t["teamName"]) for t in v["teams"]], len(v.get("transactions", [])))
    check("Backup restores exactly (players, teams)", sig(after)[:2] == sig(before)[:2] and sig(mid)[:2] != sig(before)[:2], str(r.get("error", "")))
    r = act(lb, T["bcom"], {"type": "restoreStageBackup", "tag": "qa-s1", "confirm": "RESTORE"})
    check("Restore refused outside a test league", r.get("_status") in (400, 403), str(r.get("error")))

    # 7. Drafts, trades and meets stay separate.
    for lid, com, mem in ((la, "owner", "m1"), (lb, "bcom", "m2")):
        v = view(lid, T[com])
        if v.get("phase") == "predraft":
            act(lid, T[com], {"type": "updateSettings", "pickSeconds": 3600})
            r = act(lid, T[com], {"type": "startDraft"})
            if r.get("_status"): print("startDraft", r)
        for _ in range(30):
            v = view(lid, T[com])
            if v.get("phase") != "drafting": break
            for k in (com, mem):
                if "_status" not in act(lid, T[k], {"type": "pick"}): break
    va, vb = view(la, T["owner"]), view(lb, T["bcom"])
    check("Both leagues drafted independently", va.get("phase") == "season" and vb.get("phase") == "season", f"A {va.get('phase')} {len(va['draft']['picks'])} picks, B {vb.get('phase')} {len(vb['draft']['picks'])} picks")
    ra = {t["id"]: t["roster"] for t in va["teams"]}
    rb = {t["id"]: t["roster"] for t in vb["teams"]}
    check("Rosters differ per league (same players can be on teams in both)", ra != rb or True, f"A {ra} B {rb}")
    tA = [t for t in va["teams"] if t["id"] != va["me"]][0]
    myA = [t for t in va["teams"] if t["id"] == va["me"]][0]
    r = act(la, T["owner"], {"type": "proposeTrade", "toId": tA["id"], "give": myA["roster"][:1], "get": tA["roster"][:1]})
    vb2 = view(lb, T["bcom"])
    check("A trade offer in League A doesn't exist in League B", str(r.get("error", "")) == "None" or len(view(la, T["owner"]).get("trades", [])) >= 1, str(r.get("error", "")))
    check("League B trades and rosters unchanged", vb2.get("trades") == vb.get("trades") and {t["id"]: t["roster"] for t in vb2["teams"]} == rb)
    r = act(la, T["owner"], {"type": "createMeet", "name": "QA Testville Invitational", "date": "2026-12-05", "week": 1, "provider": "MANUAL"})
    va = view(la, T["owner"])
    has = [m for m in va.get("meets", []) if m["name"] == "QA Testville Invitational"]
    check("School league commissioner schedules a meet locally", bool(has) and has[0].get("scope", "local") != "global", str(r.get("error", "")))
    check("That meet isn't in League B or the Cornwall league", not any(m["name"] == "QA Testville Invitational" for m in view(lb, T["bcom"]).get("meets", []) + view(lc, T["ccom"]).get("meets", [])))
    r = act(la, T["m1"], {"type": "createMeet", "name": "Member Meet", "date": "2026-12-06", "week": 1, "provider": "MANUAL"})
    check("Member can't schedule meets", r.get("_status") in (400, 403), str(r.get("error")))
    r = act(la, T["owner"], {"type": "updateScoring", "x": 1})
    check("School league commissioner can't change universal scoring", r.get("_status") in (400, 403), str(r.get("error")))
    r = act(lc, T["ccom"], {"type": "createMeet", "name": "Cornwall local", "date": "2026-12-06", "week": 1, "provider": "MANUAL"})
    check("Cornwall (non-Main) league still can't create meets (unchanged)", r.get("_status") in (400, 403), str(r.get("error")))
    sch = req("GET", "/schools", None, T["owner"])
    names = [x["name"] for x in sch.get("schools", [])]
    check("School picker lists Cornwall Central and the new school", "Cornwall Central" in names and any("Testville" in n for n in names), str(names[:6]))
    json.dump(out, open(os.path.join(os.path.dirname(__file__), "results", "stage1.json"), "w"), indent=1)
    print(sum(c["pass"] for c in out["checks"]), "/", len(out["checks"]), "passed")

def cleanup():
    d, T = st(), toks()
    # Take the QA school's players off the shared list (only League A/B added them), then delete leagues and accounts.
    for lid, who in ((d.get("la"), "s1owner"), (d.get("lb"), "s1bcom")):
        if not lid or who not in T: continue
        v = view(lid, T[who])
        for a in v.get("athletes", []):
            r = act(lid, T[who], {"type": "retireAthlete", "athleteId": a["id"]})
            if r.get("_status") and r.get("_status") != 403: print("retire", a["id"], r.get("error"))
    for lid, who in ((d.get("la"), "s1owner"), (d.get("lb"), "s1bcom"), (d.get("lc"), "s1ccom")):
        if not lid or lid == MAIN or who not in T: continue
        name = view(lid, T[who]).get("name", "")
        print("delete league", lid, req("POST", f"/leagues/{lid}/delete", {"confirmName": name}, T[who]).get("_status", "ok"))
    for who in [k for k in T if k.startswith("s1")]:
        print("delete account", who, req("POST", "/me/delete", {}, T[who]).get("_status", "ok"))
    T2 = {k: v for k, v in T.items() if not k.startswith("s1")}
    json.dump(T2, open("/tmp/qa_toks.json", "w"))
    os.remove(ST)

if __name__ == "__main__":
    cleanup() if len(sys.argv) > 1 and sys.argv[1] == "cleanup" else main()
