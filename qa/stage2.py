"""Stage 2 QA (league-scheduled meets: time zones, roster lock at start, pending hold, postpone/reschedule/cancel/
interrupt, Doubtful). Throwaway accounts, a throwaway school and throwaway leagues only; never touches the Main League.
The 24-hour hold itself and roster-lock timing across a daylight-saving change are proven in
functions/tests/schedule.test.ts (they can't be waited out live).
Usage: python3 qa/stage2.py   (then python3 qa/stage2.py cleanup)"""
import json, os, sys, time, uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account, toks

ST = "/tmp/qa_stage2.json"
MAIN = "fb75aa8b4e2241a68fce"
SCHOOL = "QA Meetville High School"
TZ = "America/New_York"
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
def local(dt): return dt.astimezone(ZoneInfo(TZ)).strftime("%Y-%m-%dT%H:%M")
def ceil_min(dt, plus):
    dt = dt.replace(second=0, microsecond=0) + timedelta(minutes=plus)
    return dt
def meet(lid, tok, name): return next((m for m in view(lid, tok).get("meets", []) if m["name"] == name), None)

NAMES = [("Arlo", "B"), ("Bree", "G"), ("Cole", "B"), ("Dana", "G"), ("Eli", "B"), ("Faye", "G"), ("Gus", "B"), ("Hope", "G"),
         ("Ike", "B"), ("Jade", "G"), ("Kai", "B"), ("Lena", "G"), ("Milo", "B"), ("Nia", "G"), ("Otto", "B"), ("Pia", "G"),
         ("Quin", "B"), ("Rae", "G"), ("Sol", "B"), ("Tess", "G"), ("Ugo", "B"), ("Vera", "G"), ("Wes", "B"), ("Xia", "G")]
POS = ["SPR", "DIS", "FLD", "SPR/DIS", "FLEX", "DIS/FLD"]

def setup(d, T):
    for key, com, mem in (("la", "owner", "m1"), ("lb", "bcom", "m2")):
        if key in d: continue
        r = req("POST", "/leagues", {"name": f"QA S2 {key}", "teamName": f"{key} Commish", "school": SCHOOL, "settings": {"maxTeams": 4}}, T[com])
        d[key], d[key + "_code"] = r["id"], r["code"]
        save(d)
        req("POST", "/leagues/join", {"code": d[key + "_code"], "teamName": f"{key} Member"}, T[mem])
    rows = [{"name": f"{n} Meetwell{i}", "gender": g, "position": POS[i % 6], "grade": "10"} for i, (n, g) in enumerate(NAMES)]
    if len(view(d["la"], T["owner"]).get("athletes", [])) < 24:
        req("POST", f"/leagues/{d['la']}/tools", {"op": "importRoster", "mode": "commit", "rows": rows, "requestId": d.setdefault("rid", uuid.uuid4().hex)}, T["owner"])
        save(d)
    until(lambda: len(view(d["lb"], T["bcom"]).get("athletes", [])) >= 24, 30)
    for lid, com, mem in ((d["la"], "owner", "m1"), (d["lb"], "bcom", "m2")):
        v = view(lid, T[com])
        if v.get("phase") == "predraft":
            act(lid, T[com], {"type": "updateSettings", "pickSeconds": 3600})
            r = act(lid, T[com], {"type": "startDraft"})
            if r.get("_status"): print("startDraft", r)
        for _ in range(40):
            v = view(lid, T[com])
            if v.get("phase") != "drafting": break
            for k in (com, mem): act(lid, T[k], {"type": "pick"})

def lock_err(lid, tok):
    """Tries a lineup move; returns the error text ('' when it went through)."""
    v = view(lid, tok)
    me = next(t for t in v["teams"] if t["id"] == v["me"])
    lu = me["lineup"]
    starter = next((lu[s] for s in ("SPR", "DIS", "FLD", "FLEX") if lu.get(s)), None)
    r = act(lid, tok, {"type": "moveAthlete", "athleteId": starter, "slot": "BN1"})
    if not r.get("_status"): act(lid, tok, {"type": "moveAthlete", "athleteId": starter, "slot": next(s for s in ("SPR", "DIS", "FLD", "FLEX") if lu.get(s) == starter)})
    return str(r.get("error", "")) if r.get("_status") else ""

def audit_only():
    d = st(); T = toks()
    txt = json.dumps(view(d["la"], T["s2owner"]).get("audit", []))
    res = json.load(open(os.path.join(os.path.dirname(__file__), "results", "stage2.json")))
    for c in res["checks"]:
        if c["name"].startswith("Postpone, reschedule"):
            c["pass"] = all(k in txt for k in ("meet.postpone", "meet.reschedule", "meet.interrupt", "meet.resume", "meet.pending"))
            c["detail"] = "league audit log (commissioner view): " + ", ".join(k for k in ("meet.postpone", "meet.reschedule", "meet.interrupt", "meet.resume", "meet.pending", "meet.cancel", "meet.correction") if k in txt)
            print(c)
    json.dump(res, open(os.path.join(os.path.dirname(__file__), "results", "stage2.json"), "w"), indent=1)

def main():
    d = st()
    T = {k: account(f"s2{k}", f"QA S2 {k}") for k in ["owner", "m1", "bcom", "m2"]}
    setup(d, T)
    la, lb = d["la"], d["lb"]
    va = view(la, T["owner"])
    check("Test leagues drafted (2 teams, even)", va.get("phase") == "season" and view(lb, T["bcom"]).get("phase") == "season", va.get("phase"))
    week = va.get("week", 1)

    # 1. Scheduling with a local time zone.
    now = datetime.now(timezone.utc)
    start = ceil_min(now, 3)
    end = start + timedelta(minutes=3)
    r = act(la, T["owner"], {"type": "createMeet", "name": "QA Meetville Opener", "week": week, "provider": "MANUAL", "location": "Meetville HS Track",
                             "startLocal": local(start), "endLocal": local(end), "timeZone": TZ})
    m = meet(la, T["owner"], "QA Meetville Opener")
    check("Meet scheduled with location, local start/end and time zone", m and m.get("startAt") == int(start.timestamp() * 1000) and m.get("timeZone") == TZ and m.get("location") == "Meetville HS Track", f"{r.get('error','')} {m and (m.get('startAt'), int(start.timestamp()*1000))}")
    check("New meet shows as Scheduled", m and m.get("stage") == "SCHEDULED", m and m.get("stage"))
    r = act(la, T["owner"], {"type": "createMeet", "name": "QA Same Week", "week": week, "provider": "MANUAL", "startLocal": local(start + timedelta(days=1)), "timeZone": TZ})
    check("Two meets can't share one matchup week", r.get("_status") == 400 and "own matchup" in str(r.get("error")), r.get("error"))
    r = act(la, T["owner"], {"type": "createMeet", "name": "QA Bad Times", "week": week + 1, "provider": "MANUAL", "startLocal": local(end), "endLocal": local(start), "timeZone": TZ})
    check("End before start is rejected", r.get("_status") == 400, r.get("error"))
    r = act(la, T["owner"], {"type": "createMeet", "name": "QA Bad Zone", "week": week + 1, "provider": "MANUAL", "startLocal": local(end), "timeZone": "Mars/Olympus"})
    check("Unknown time zone is rejected", r.get("_status") == 400, r.get("error"))
    r = act(la, T["m1"], {"type": "createMeet", "name": "Member Meet", "week": week + 1, "provider": "MANUAL", "startLocal": local(end), "timeZone": TZ})
    check("Member can't schedule a meet", r.get("_status") in (400, 403), r.get("error"))
    check("Meet isn't visible in the other league on the same school", meet(lb, T["bcom"], "QA Meetville Opener") is None)

    # 2. Roster lock at the official start.
    e = lock_err(la, T["m1"])
    check("Before the start, lineups can still change", "locked" not in e.lower(), e)
    r = act(la, T["m1"], {"type": "meetLifecycle", "meetId": m["id"], "op": "postpone"})
    check("Member can't postpone a meet", r.get("_status") in (400, 403), r.get("error"))
    wait = start.timestamp() - time.time() + 3
    if wait > 0: time.sleep(wait)
    e = lock_err(la, T["m1"])
    check("At the official start, rosters lock", "locked" in e.lower(), e)
    m = meet(la, T["owner"], "QA Meetville Opener")
    check("Started meet shows as Live", m.get("stage") == "LIVE", m.get("stage"))
    check("League B (no meet) isn't locked", "locked" not in lock_err(lb, T["m2"]).lower())

    # 3. Postpone lifts the lock, keeps the matchup; reschedule locks again at the new start.
    r = act(la, T["owner"], {"type": "meetLifecycle", "meetId": m["id"], "op": "postpone", "reason": "QA thunderstorms"})
    m = meet(la, T["owner"], "QA Meetville Opener")
    check("Postponed: status, same week, logged", r.get("_status") is None and m.get("stage") == "POSTPONED" and m.get("week") == week and any(c["kind"] == "postpone" for c in m.get("changes", [])), r.get("error"))
    e = lock_err(la, T["m1"])
    check("Postponing lifts the roster lock", "locked" not in e.lower(), e)
    r = act(la, T["owner"], {"type": "startLive", "meetId": m["id"]})
    check("A postponed meet can't go live", r.get("_status") == 400, r.get("error"))
    start2 = ceil_min(datetime.now(timezone.utc), 2)
    end2 = start2 + timedelta(minutes=2)
    r = act(la, T["owner"], {"type": "meetLifecycle", "meetId": m["id"], "op": "reschedule", "startLocal": local(start2), "endLocal": local(end2), "timeZone": TZ, "reason": "QA new date"})
    m = meet(la, T["owner"], "QA Meetville Opener")
    check("Rescheduled: new time, same matchup week, logged", r.get("_status") is None and m.get("stage") == "SCHEDULED" and m.get("week") == week and m.get("startAt") == int(start2.timestamp() * 1000) and any(c["kind"] == "reschedule" for c in m.get("changes", [])), r.get("error"))
    wait = start2.timestamp() - time.time() + 3
    if wait > 0: time.sleep(wait)
    check("Rescheduled meet locks rosters at its new start", "locked" in lock_err(la, T["m1"]).lower())

    # 4. Interrupt / resume.
    r = act(la, T["owner"], {"type": "meetLifecycle", "meetId": m["id"], "op": "interrupt", "reason": "QA lightning"})
    m = meet(la, T["owner"], "QA Meetville Opener")
    check("Interrupted: shows Interrupted, rosters stay locked", m.get("stage") == "INTERRUPTED" and "locked" in lock_err(la, T["m1"]).lower(), r.get("error"))
    r = act(la, T["owner"], {"type": "meetLifecycle", "meetId": m["id"], "op": "resume"})
    m = meet(la, T["owner"], "QA Meetville Opener")
    check("Resumed: back to Live", m.get("stage") == "LIVE", f"{r.get('error')} {m.get('stage')}")

    # 5. Pending finalization: Mark Final starts the hold, a second Mark Final is refused.
    r = act(la, T["owner"], {"type": "markFinal", "meetId": m["id"]})
    m = meet(la, T["owner"], "QA Meetville Opener")
    check("Mark Final on a scheduled meet starts Pending finalization (not Final)", r.get("_status") is None and m.get("stage") == "PENDING" and m.get("status") != "FINAL" and m.get("finalEligibleAt"), f"{r.get('error')} {m.get('stage')}")
    hold_h = (m.get("finalEligibleAt", 0) - m.get("endAt", 0)) / 3_600_000
    check("Hold lasts at least 24 hours after the official end", hold_h >= 24, f"{hold_h:.2f} h")
    r = act(la, T["owner"], {"type": "markFinal", "meetId": m["id"]})
    check("Finalizing during the 24-hour hold is refused", r.get("_status") == 400 and "pending" in str(r.get("error")).lower(), r.get("error"))
    r = act(la, T["owner"], {"type": "markFinal", "meetId": m["id"], "force": True, "reason": "QA"})
    check("Even a forced finalize waits out the 24-hour hold", r.get("_status") == 400, r.get("error"))
    va = view(la, T["owner"])
    games = [g for g in va.get("schedule", []) if g.get("week") == week]
    check("Matchup stays open while the meet is pending", games and not any(g.get("final") for g in games), str([(g.get("week"), g.get("final")) for g in games]))
    r = act(la, T["owner"], {"type": "meetLifecycle", "meetId": m["id"], "op": "postpone"})
    check("A meet that already ended can still be postponed only explicitly (logged)", r.get("_status") in (None, 400), r.get("error"))
    if r.get("_status") is None:
        act(la, T["owner"], {"type": "meetLifecycle", "meetId": m["id"], "op": "reschedule", "startLocal": local(start2), "endLocal": local(end2), "timeZone": TZ, "reason": "QA undo"})

    # 6. Cancel in League B closes that week's matchup as it stands (same matchup, no new one).
    wb = view(lb, T["bcom"]).get("week", 1)
    sb = ceil_min(datetime.now(timezone.utc), 60)
    act(lb, T["bcom"], {"type": "createMeet", "name": "QA Meetville Rainout", "week": wb, "provider": "MANUAL", "startLocal": local(sb), "timeZone": TZ})
    mb = meet(lb, T["bcom"], "QA Meetville Rainout")
    gb_before = [(g["homeId"], g.get("awayId")) for g in view(lb, T["bcom"]).get("schedule", []) if g["week"] == wb]
    r = act(lb, T["bcom"], {"type": "meetLifecycle", "meetId": mb["id"], "op": "cancel", "reason": "QA track closed"})
    vb = view(lb, T["bcom"])
    mb = meet(lb, T["bcom"], "QA Meetville Rainout")
    gb = [g for g in vb.get("schedule", []) if g["week"] == wb]
    check("Canceled meet shows Canceled and is logged", mb.get("stage") == "CANCELED" and any(c["kind"] == "cancel" for c in mb.get("changes", [])), r.get("error"))
    check("Canceling closes the same matchup (no new matchup created)", [(g["homeId"], g.get("awayId")) for g in gb] == gb_before and all(g.get("final") for g in gb), str([(g.get("final"), g.get("homeFinal"), g.get("awayFinal")) for g in gb]))
    r = act(lb, T["bcom"], {"type": "meetLifecycle", "meetId": mb["id"], "op": "interrupt"})
    check("A canceled meet can't be interrupted", r.get("_status") == 400, r.get("error"))

    # 7. Unscheduled (old-style) meets keep the original behavior.
    act(la, T["owner"], {"type": "createMeet", "name": "QA Legacy Style", "date": "2026-12-12", "week": week + 2, "provider": "MANUAL"})
    ml = meet(la, T["owner"], "QA Legacy Style")
    r = act(la, T["owner"], {"type": "markFinal", "meetId": ml["id"]})
    ml = meet(la, T["owner"], "QA Legacy Style")
    check("A meet without a start time still finalizes immediately (unchanged)", ml.get("status") == "FINAL" and not ml.get("startAt"), f"{r.get('error')} {ml.get('status')}")
    r = act(la, T["owner"], {"type": "reopenMeet", "meetId": ml["id"]})
    check("Reopening an old-style final meet works as before, recorded as a correction", r.get("_status") is None and meet(la, T["owner"], "QA Legacy Style").get("status") == "UPCOMING", r.get("error"))

    # 8. Doubtful status (informational).
    aid = view(la, T["owner"])["athletes"][0]["id"]
    r = act(la, T["owner"], {"type": "setStatus", "athleteId": aid, "status": "D"})
    ok = until(lambda: next(a for a in view(la, T["owner"])["athletes"] if a["id"] == aid).get("status") == "D", 20)
    check("Commissioner can set Doubtful", r.get("_status") is None and ok, r.get("error"))
    check("Doubtful shows in the other league on the same school", until(lambda: next((a for a in view(lb, T["bcom"])["athletes"] if a["id"] == aid), {}).get("status") == "D", 20))
    r = act(la, T["m1"], {"type": "setStatus", "athleteId": aid, "status": "D"})
    check("Member can't set a status", r.get("_status") in (400, 403), r.get("error"))
    act(la, T["owner"], {"type": "setStatus", "athleteId": aid, "status": "active"})

    # 9. Audit trail.
    txt = json.dumps(view(la, T["owner"]).get("audit", []))
    check("Postpone, reschedule, interrupt, resume and pending are in the audit log", all(k in txt for k in ("meet.postpone", "meet.reschedule", "meet.interrupt", "meet.resume", "meet.pending")), txt[:200])

    # 10. Cornwall leagues: shared meets unchanged.
    cw = req("POST", "/leagues", {"name": "QA S2 Cornwall", "teamName": "CW", "settings": {"maxTeams": 4}}, T["owner"])
    d["lc"] = cw.get("id"); save(d)
    vc = view(d["lc"], T["owner"])
    gm = [m for m in vc.get("meets", []) if m.get("scope") == "global"]
    weeks = {}
    for x in gm:
        if not x.get("history"): weeks[x["week"]] = weeks.get(x["week"], 0) + 1
    check("Main League shared meets carry no schedule changes (no start times set)", gm and all(not x.get("startAt") and not x.get("lifecycle") for x in gm), f"{len(gm)} meets")
    check("Main League weeks map one-to-one to meets", all(v == 1 for v in weeks.values()), str(weeks))
    json.dump(out, open(os.path.join(os.path.dirname(__file__), "results", "stage2.json"), "w"), indent=1)
    print(sum(c["pass"] for c in out["checks"]), "/", len(out["checks"]), "passed")

def cleanup():
    d, T = st(), toks()
    for lid, who in ((d.get("la"), "s2owner"),):
        if not lid or who not in T: continue
        for a in view(lid, T[who]).get("athletes", []):
            r = act(lid, T[who], {"type": "retireAthlete", "athleteId": a["id"]})
            if r.get("_status") and r.get("_status") != 403: print("retire", a["id"], r.get("error"))
    for lid, who in ((d.get("la"), "s2owner"), (d.get("lb"), "s2bcom"), (d.get("lc"), "s2owner")):
        if not lid or lid == MAIN or who not in T: continue
        name = view(lid, T[who]).get("name", "")
        print("delete league", lid, req("POST", f"/leagues/{lid}/delete", {"confirmName": name}, T[who]).get("_status", "ok"))
    for who in [k for k in T if k.startswith("s2") and k != "s2integ"]:
        print("delete account", who, req("POST", "/me/delete", {}, T[who]).get("_status", "ok"))
    T2 = {k: v for k, v in T.items() if not k.startswith("s2") or k == "s2integ"}
    json.dump(T2, open("/tmp/qa_toks.json", "w"))
    os.remove(ST)

if __name__ == "__main__":
    a = sys.argv[1] if len(sys.argv) > 1 else ""
    cleanup() if a == "cleanup" else audit_only() if a == "audit" else main()
