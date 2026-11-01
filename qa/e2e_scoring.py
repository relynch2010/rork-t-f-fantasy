"""End-to-end scoring check on the throwaway QA test league (never the Main League).

Stage "live":  week 1 replayed in stages (partial feed -> full feed -> same feed again -> final). Checks scores move
               correctly, nothing is counted twice, and the Live Activity payload matches the matchup.
Stage "run":   the remaining real Armory meets imported live and marked final.
Stage "check": every scoring line is recomputed by an independent Python implementation of the published rules
               (tables, place, heat, seeded/unseeded percentile, PB/SB, standards, DQ/DNF) and compared line by line.
Results: qa/results/e2e_scoring.json. Usage: python3 qa/e2e_scoring.py [live|run|check|all]"""
import json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account
import sandbox_setup as S

OUT = os.path.join(os.path.dirname(__file__), "results", "e2e_scoring.json")
STARTERS = ["SPR", "DIS", "FLD", "FLEX"]


def load():
    return json.load(open(OUT)) if os.path.exists(OUT) else {}


def save(d):
    json.dump(d, open(OUT, "w"), indent=1)


def tool(lid, tok, op, **kw):
    return req("POST", f"/leagues/{lid}/tools", {"op": op, **kw}, tok, timeout=300)


def act(lid, tok, body):
    return req("POST", f"/leagues/{lid}/action", body, tok, timeout=300)


def snap(lid, tok, week):
    ex = tool(lid, tok, "scoringExport")
    la = tool(lid, tok, "liveActivityPreview", week=week)
    lines = [l for l in ex["lines"] if l["week"] == week]
    res = [r for r in ex["results"] if r["week"] == week and not r["historyOnly"]]
    ids = [l["id"] for l in lines]
    per_ath = collections.Counter((r["athleteIds"][0], r["event"], r["meetId"]) for r in res if not r["relay"])
    # Team score must equal the sum of its starters' lines for the week.
    pts = collections.defaultdict(float)
    for l in lines:
        pts[l["athleteId"]] += l["points"]
    team_ok = {}
    for tid, w in ex["lineups"].items():
        lu = w.get(str(week)) or {}
        calc = round(sum(pts.get(lu.get(s) or "", 0) for s in STARTERS), 2)
        team_ok[tid] = {"server": ex["teams"][tid][str(week)], "starters": calc, "ok": abs(calc - ex["teams"][tid][str(week)]) < 0.01}
    la_ok = all(abs(a["content"]["myScore"] - ex["teams"][a["side"]][str(week)]) < 0.01 for a in la.get("activities", []))
    return {
        "results": len(res), "provisional": sum(1 for r in res if r["provisional"]), "lines": len(lines), "points": round(sum(l["points"] for l in lines), 2),
        "duplicateLineIds": len(ids) - len(set(ids)), "duplicateAthleteEvent": sum(1 for v in per_ath.values() if v > 1),
        "teams": team_ok, "teamsOk": all(v["ok"] for v in team_ok.values()),
        "liveActivity": la.get("activities", [])[:2], "liveActivityMatchesScores": la_ok,
        "liveActivityHasProjection": all("myProj" in a["content"] and "oppProj" in a["content"] and "leagueName" in a["content"] for a in la.get("activities", [])),
        "lineFingerprint": sorted((l["id"], l["points"]) for l in lines),
    }


def live_stage(d, toks):
    lid, t = d["lid"], toks["commish"]
    m = d["meets"]["54930"]
    out = {}
    r = act(lid, t, {"type": "setTestMode", "meetId": m, "mode": {"partial": True}, "sync": False}); print("partial mode", r.get("_status", "ok"), r.get("error", ""))
    r = act(lid, t, {"type": "startLive", "meetId": m}); print("start live", r.get("_status", "ok"), r.get("error", ""))
    out["1_partial"] = snap(lid, t, 1)
    r = act(lid, t, {"type": "setTestMode", "meetId": m, "mode": None, "sync": True}); print("full feed", r.get("_status", "ok"), r.get("error", ""))
    out["2_full"] = snap(lid, t, 1)
    r = act(lid, t, {"type": "setTestMode", "meetId": m, "mode": None, "sync": True}); print("same feed again", r.get("_status", "ok"), r.get("error", ""))
    out["3_resync"] = snap(lid, t, 1)
    r = act(lid, t, {"type": "markFinal", "meetId": m}); print("final", r.get("_status", "ok"), r.get("error", ""))
    out["4_final"] = snap(lid, t, 1)
    out["resyncIdentical"] = out["2_full"]["lineFingerprint"] == out["3_resync"]["lineFingerprint"]
    out["noDoubleCount"] = all(out[k]["duplicateLineIds"] == 0 and out[k]["duplicateAthleteEvent"] == 0 for k in ["1_partial", "2_full", "3_resync", "4_final"])
    out["scoresMovedPartialToFull"] = out["2_full"]["points"] != out["1_partial"]["points"]
    out["finalNoProvisional"] = out["4_final"]["provisional"] == 0
    for k in ["1_partial", "2_full", "3_resync", "4_final"]:
        out[k].pop("lineFingerprint")
        print(k, {x: out[k][x] for x in ["results", "provisional", "lines", "points", "duplicateLineIds", "duplicateAthleteEvent", "teamsOk", "liveActivityMatchesScores", "liveActivityHasProjection"]})
    st = S.st(); st.setdefault("final", [])
    if "54930" not in st["final"]: st["final"].append("54930"); S.save(st)
    return out


# ---------- independent re-implementation of the published scoring rules ----------
PLAUSIBLE = {
    "55m": (5, 15), "60m": (5.5, 16), "100m": (9, 25), "200m": (19, 50), "300m": (30, 80), "400m": (43, 120), "500m": (58, 160),
    "600m": (70, 200), "800m": (100, 330), "1000m": (130, 420), "1500m": (200, 600), "1600m": (220, 640), "mile": (220, 650),
    "3000m": (440, 1300), "3200m": (470, 1400), "2mile": (470, 1400), "5000m": (760, 2200),
    "55mhurdles": (6.5, 16), "60mhurdles": (7, 17), "100mhurdles": (12, 30), "110mhurdles": (12.5, 30), "300mhurdles": (34, 90),
    "400mhurdles": (46, 120), "highjump": (0.8, 2.6), "polevault": (1.2, 6.5), "longjump": (2, 9.5), "triplejump": (5, 19),
    "shotput": (3, 25), "discus": (8, 80), "javelin": (8, 100), "weightthrow": (5, 30), "hammer": (8, 90),
}
FIELD = {"highjump", "polevault", "longjump", "triplejump", "shotput", "discus", "javelin", "weightthrow", "hammer"}


def school_year(date):
    """Published season rule: Aug-Dec meets belong to the season named by the next year."""
    y, m = int(date[:4]), int(date[5:7])
    return y + 1 if m >= 8 else y


def ek(e):
    return re.sub(r"[^a-z0-9]", "", e.lower())


def kind(e):
    k = ek(e)
    if k in FIELD:
        return "field"
    if k in ("pentathlon", "heptathlon", "decathlon"):
        return "points"
    return "time"


def mark_value(raw, knd):
    t = (raw or "").strip().lower().replace("\u2019", "'")
    t = re.sub(r"^[*#]+", "", t)
    t = re.sub(r"\s*[hq*]$", "", t)
    if not t:
        return None
    if knd == "time":
        t = re.sub(r"\s*(s|sec|secs)$", "", t)
        if not re.fullmatch(r"\d+(?::\d{1,2}){0,2}(?:\.\d+)?", t):
            return None
        v = 0.0
        for i, p in enumerate(t.split(":")):
            if i > 0 and float(p) >= 60:
                return None
            v = v * 60 + float(p)
        return v if v > 0 else None
    m = re.fullmatch(r"(\d+)\s*(?:'|ft|feet|-)\s*(\d+(?:\.\d+)?)?\s*(?:\"|in|inches)?", t)
    if m:
        inch = float(m.group(2) or 0)
        if inch >= 12:
            return None
        return (int(m.group(1)) + inch / 12) * 0.3048
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(?:m|meters|metres)?", t)
    if m:
        return float(m.group(1))
    return None


def better(a, b, knd):
    return a < b - 1e-9 if knd == "time" else a > b + 1e-9


def applies(R, code, relay, knd):
    if (R.get("enabled") or {}).get(code) is False:
        return False
    a = (R.get("applies") or {}).get(code) or []
    if not a:
        return True
    has_kind = "individual" in a or "relay" in a
    has_surf = "track" in a or "field" in a
    return (not has_kind or ("relay" if relay else "individual") in a) and (not has_surf or ("field" if knd == "field" else "track") in a)


def ordinal_place(table, place):
    return table[place - 1] if 1 <= place <= len(table) else None


def expected_lines(ex):
    rules = ex["rules"]
    best, sbest, std_awarded = {}, {}, {}
    for aid, evs in ex["pbs"].items():
        for e, mk in evs.items():
            v = mark_value(mk, kind(e))
            if v is not None:
                best[f"{aid}|{ek(e)}"] = v
    res = sorted(ex["results"], key=lambda r: (r["date"], 0 if r["source"] == "live" else 1, r["seq"], r["sourceKey"] or r["id"]))
    out = {}
    for r in res:
        e = ek(r["event"]); knd = kind(r["event"])
        season = r["season"] or school_year(r["date"])
        R = rules.get(str(r["week"])) or rules[sorted(rules, key=int)[-1]]
        on = lambda c: applies(R, c, r["relay"], knd)
        v = mark_value(r["mark"], knd) if r["status"] == "OK" else None
        for aid in r["athleteIds"]:
            def push(code, pts):
                out[f'{r["id"]}:{code}:{aid}'] = round(pts, 4)
            k = f"{aid}|{e}"; sk = f"{k}|{season}"
            if r["historyOnly"]:
                if v is not None and not r["relay"]:
                    if k not in best or better(v, best[k], knd): best[k] = v
                    if sk not in sbest or better(v, sbest[sk], knd): sbest[sk] = v
                continue
            if on("part"): push("part", R["participation"])
            if r["status"] != "OK":
                if on("dq"): push("dq", R["dqdnf"])
                continue
            if r["place"] and on("place"):
                p = ordinal_place(R["relay"] if r["relay"] else R["overall"], r["place"])
                if p: push("place", p)
            if r["heatPlace"] and on("heat"):
                if r["week"] < ex["legacyHeatBeforeWeek"]:
                    if r["heatPlace"] == 1: push("heat", 2)
                else:
                    p = ordinal_place(R["heat"], r["heatPlace"])
                    if p: push("heat", p)
            pp = r["pctPlace"] if r["pctPlace"] is not None else r["place"]
            if on("pct") and pp and r["seeded"] and pp <= r["seeded"]:
                uns = r["section"] == "unseeded" and isinstance(R.get("percentileUnseeded"), list)
                br = sorted(R["percentileUnseeded"] if uns else R["percentile"], key=lambda t: t["pct"])
                tier = next((t for t in br if pp / r["seeded"] <= t["pct"] + 1e-9), None)
                if tier and tier["pts"]: push("pct", tier["pts"])
            if on("perf") and not r["relay"] and knd != "points" and v is not None:
                lo, hi = PLAUSIBLE.get(e, (0, 1e9))
                if lo <= v <= hi:
                    tiers = [p for p in ex["performance"].get(str(r["week"]), []) if p[0] == season and p[1] in ("X", r["gender"]) and p[2] == e and p[4] > 0
                             and (v <= p[3] + 1e-5 if knd == "time" else v >= p[3] - 1e-5)]
                    if tiers: push("perf", max(p[4] for p in tiers))
            is_pb = is_sb = False
            if r["best"] == "PB": is_pb = True
            elif r["best"] == "SB": is_sb = True
            elif r["best"] == "auto" and v is not None and not r["relay"]:
                if k in best and better(v, best[k], knd): is_pb = True
                elif sk in sbest and better(v, sbest[sk], knd): is_sb = True
            if on("best"):
                if is_pb: push("best", R["pb"])
                elif is_sb: push("best", R["sb"])
            if v is not None and not r["relay"]:
                if k not in best or better(v, best[k], knd): best[k] = v
                if sk not in sbest or better(v, sbest[sk], knd): sbest[sk] = v
            if v is not None and on("std"):
                cap = R["standardCap"]
                met = [min(cap, max(0, s[4])) for s in ex["standards"].get(str(r["week"]), []) if s[0] == season and s[1] == r["gender"] and s[2] == e
                       and (lambda sv: sv is not None and (v <= sv + 1e-9 if knd == "time" else v >= sv - 1e-9))(mark_value(s[3], knd))]
                top = max(met) if met else 0
                ak = f"{aid}|{season}"
                if top > std_awarded.get(ak, 0):
                    push("std", top - std_awarded.get(ak, 0)); std_awarded[ak] = top
    rw = lambda w: rules.get(str(w)) or rules[sorted(rules, key=int)[-1]]
    seen = set()
    for rec in sorted(ex["records"], key=lambda x: (x["date"], x["at"])):
        k = (rec["athleteId"], ek(rec["event"]), rec["season"])
        if k in seen: continue
        seen.add(k); out[f'{rec["id"]}:sr:{rec["athleteId"]}'] = rw(rec["week"])["schoolRecord"]
    seen = set()
    for f in ex["fumbles"]:
        k = (f["athleteId"], ek(f["meet"]), f["date"], ek(f["event"]))
        if k in seen: continue
        seen.add(k); out[f'{f["id"]}:fumble:{f["athleteId"]}'] = rw(f["week"])["fumble"]
    return out


def check_stage(d, toks, variant=None):
    lid, t = d["lid"], toks["commish"]
    ex = tool(lid, t, "scoringExport", **({"variant": variant} if variant else {}))
    if variant and not ex.get("variant"): raise SystemExit("variant was not applied")
    exp = expected_lines(ex)
    got = {l["id"]: round(l["points"], 4) for l in ex["lines"]}
    missing = sorted(set(exp) - set(got)); extra = sorted(set(got) - set(exp))
    diff = sorted(k for k in set(exp) & set(got) if abs(exp[k] - got[k]) > 1e-6)
    by_code = collections.Counter(l["code"] for l in ex["lines"])
    res = [r for r in ex["results"] if not r["historyOnly"]]
    events = collections.defaultdict(set)
    perf_lines = {l["sourceId"] for l in ex["lines"] if l["code"] == "perf"}
    no_perf = collections.Counter()
    for r in res:
        if r["relay"] or r["status"] != "OK": continue
        events[ek(r["event"])].add(r["gender"])
        if r["id"] not in perf_lines: no_perf[f'{r["gender"]} {r["event"]}'] += 1
    tables = {(p[0], p[1], p[2]) for w in ex["performance"].values() for p in w}
    seasons = sorted({r["season"] or school_year(r["date"]) for r in res})
    missing_tables = sorted({f'{s} {g} {e}' for e, gs in events.items() for g in gs for s in seasons if (s, g, e) not in tables and (s, "X", e) not in tables})
    out = {
        "results": len(res), "lines": len(got), "byCode": by_code, "expectedLines": len(exp),
        "missing": missing[:40], "extra": extra[:40], "pointDiffs": [(k, exp[k], got[k]) for k in diff[:40]],
        "allMatch": not missing and not extra and not diff,
        "eventsScored": {e: sorted(g) for e, g in sorted(events.items())},
        "resultSeasons": seasons, "eventsWithoutTableForSeason": missing_tables,
        "okResultsWithoutPerfLine": dict(no_perf.most_common(40)),
        "rulesWeek1": ex["rules"].get("1"),
    }
    print(json.dumps({k: out[k] for k in ["results", "lines", "expectedLines", "allMatch", "byCode", "resultSeasons"]}, default=str))
    print("missing", missing[:5], "extra", extra[:5], "diffs", out["pointDiffs"][:5])
    print("no table:", missing_tables[:20])
    return out


VARIANT = {  # exercises every rule the live settings score at 0
    "overall": [10, 8, 6, 4, 2, 1], "relay": [8, 6, 4], "heat": [3, 2, 1],
    "percentileUnseeded": [{"pct": 0.05, "pts": 6}, {"pct": 0.10, "pts": 4}, {"pct": 0.20, "pts": 3}, {"pct": 0.30, "pts": 2}, {"pct": 0.40, "pts": 1}],
}


def rules_stage(d, toks):
    """Test league only: publish a rule variant, add a school record and a baton fumble, then re-check every line."""
    import uuid
    lid, t = d["lid"], toks["commish"]
    pub = tool(lid, t, "sandboxPublish", rules=VARIANT, confirm="PUBLISH", requestId=str(uuid.uuid4()))
    print("publish", {k: pub.get(k) for k in ["ok", "message", "finishedWeeksUnchanged", "error"]})
    ex = tool(lid, t, "scoringExport")
    week = max(int(w) for w in ex["rules"])
    tid, lu = next(iter(ex["lineups"].items()))
    aid = (lu.get(str(week)) or lu.get("1") or {}).get("SPR")
    r1 = act(lid, t, {"type": "addSchoolRecord", "athleteId": aid, "event": "55m", "date": "2026-02-16", "mark": "6.60", "school": "Cornwall Central", "season": 2026, "week": week})
    r2 = act(lid, t, {"type": "addFumble", "athleteId": aid, "meet": "QA relay", "event": "4x200 Relay", "date": "2026-02-16", "week": week})
    r3 = act(lid, t, {"type": "addFumble", "athleteId": aid, "meet": "QA relay", "event": "4x200 Relay", "date": "2026-02-16", "week": week})
    print("record", r1.get("_status", "ok"), r1.get("error", ""), "fumble", r2.get("_status", "ok"), "same fumble twice", r3.get("_status", "ok"))
    return {"publish": {k: pub.get(k) for k in ["ok", "message", "finishedWeeksUnchanged"]}, "variant": VARIANT, "week": week, "athlete": aid}


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "all"
    d = S.st()
    toks = {k: account(k) for k in ["commish", "m1", "m2", "m3"]}
    R = load()
    if stage in ("live", "all"): R["live"] = live_stage(d, toks); save(R)
    if stage in ("run", "all"): S.run(S.st(), toks)
    if stage in ("check", "all"): R["check"] = check_stage(S.st(), toks); save(R)
    if stage in ("rules", "all"): R["rules"] = rules_stage(S.st(), toks); R["checkWithRecords"] = check_stage(S.st(), toks); R["checkVariant"] = check_stage(S.st(), toks, VARIANT); save(R)
