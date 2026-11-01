"""Projection-meets tool QA on the throwaway test league (sandbox mode: its own list, same code as the shared list).
Checks: AthleticLIVE link preview + add, pasted results text (Hy-Tek style and table) preview + add, duplicate taps,
rebuild, remove, projections change, real scoring lines unchanged. Writes qa/results/projmeets_qa.json."""
import json, os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, account
import sandbox_setup as S

OUT = os.path.join(os.path.dirname(__file__), "results", "projmeets_qa.json")
d = S.st(); lid = d["lid"]; t = account("commish")


def tool(op, **kw):
    return req("POST", f"/leagues/{lid}/tools", {"op": op, **kw}, t, timeout=300)


def proj(week):
    p = req("GET", f"/leagues/{lid}/projections?week={week}", None, t, timeout=300)
    return {a: v.get("projected") for a, v in (p.get("athletes") or {}).items()}


def lines_fp():
    ex = tool("scoringExport")
    return sorted((l["id"], l["points"]) for l in ex["lines"]), ex


def brief(r):
    return {k: r.get(k) for k in ["ok", "message", "error", "duplicate", "rows", "events", "results", "athletes", "skipped", "exists", "_status"] if k in r}


R = {}
for m in tool("projMeets").get("meets", []):  # start from an empty test-league list
    tool("projMeetRemove", id=m["id"], requestId=str(uuid.uuid4()))
fp0, ex = lines_fp()
league = req("GET", f"/leagues/{lid}", None, t)
names = {a["id"]: a for a in league["athletes"]}
R["start"] = brief(tool("projMeets")) | {"meets": len(tool("projMeets").get("meets", []))}
week = league["week"] + 1
p0 = proj(week)

# 1. AthleticLIVE link
url = "https://live.athletic.net/meets/54930"
R["alivePreview"] = brief(tool("projMeetPreview", url=url))
R["aliveBadLink"] = brief(tool("projMeetPreview", url="https://example.com/not-a-meet"))
rid = str(uuid.uuid4())
R["aliveAdd"] = brief(tool("projMeetAdd", url=url, requestId=rid))
R["aliveAddDoubleTap"] = brief(tool("projMeetAdd", url=url, requestId=rid))
R["aliveAddAgain"] = brief(tool("projMeetAdd", url=url, requestId=str(uuid.uuid4())))

# 2. Pasted results text built from real marks of this league's athletes (week 3 meet), Hy-Tek style.
res = [r for r in ex["results"] if r["week"] == 3 and not r["relay"] and r["status"] == "OK" and not r["historyOnly"]]
by_ev = {}
for r in res:
    by_ev.setdefault((r["gender"], r["event"]), []).append(r)
lines = ["Cornwall Central QA Pasted Invitational", "Results", ""]
for (g, ev), rows in sorted(by_ev.items()):
    lines.append(f"{'Boys' if g == 'B' else 'Girls'} {ev}")
    lines.append("    Name                    Year School                  Finals")
    lines.append("=" * 60)
    for i, r in enumerate(rows, 1):
        a = names.get(r["athleteIds"][0], {})
        lines.append(f"  {i} {a.get('name', '?'):<24} 11 Cornwall Central        {r['mark']}")
    lines.append("")
hytek = "\n".join(lines)
table = "Event,Gender,First,Last,School,Mark\n" + "\n".join(
    f"{('Boys ' if r['gender'] == 'B' else 'Girls ')}{r['event']},{r['gender']},{names.get(r['athleteIds'][0], {}).get('name', '? ?').split(' ', 1)[0]},{names.get(r['athleteIds'][0], {}).get('name', '? ?').split(' ', 1)[-1]},Cornwall Central,{r['mark']}"
    for r in res)
R["pastedSourceMarks"] = len(res)
R["textPreviewHytek"] = brief(tool("projMeetPreview", text=hytek, name="QA Pasted Invitational", date="2026-01-04"))
R["textPreviewTable"] = brief(tool("projMeetPreview", text=table, name="QA Pasted Table", date="2026-01-05"))
R["textNoDate"] = brief(tool("projMeetPreview", text=hytek, name="QA Pasted Invitational", date=""))
R["textFuture"] = brief(tool("projMeetPreview", text=hytek, name="QA Pasted Invitational", date="2027-06-01"))
R["textNoMatch"] = brief(tool("projMeetAdd", text="Boys 55m\n 1 Nobody Here  11 Elsewhere HS  7.01\n", name="QA No Match", date="2026-01-06", requestId=str(uuid.uuid4())))
R["textAdd"] = brief(tool("projMeetAdd", text=hytek, name="QA Pasted Invitational", date="2026-01-04", requestId=str(uuid.uuid4())))

listed = tool("projMeets")
R["listAfterAdd"] = [{k: m.get(k) for k in ["id", "kind", "name", "date"]} | {"stat": m.get("stat")} for m in listed.get("meets", [])]
p1 = proj(week)
rb = str(uuid.uuid4())
R["rebuild"] = brief(tool("projMeetsRebuild", requestId=rb))
R["rebuildDoubleTap"] = brief(tool("projMeetsRebuild", requestId=rb))
p2 = proj(week)
fp1, _ = lines_fp()

tx = next((m["id"] for m in listed.get("meets", []) if m["kind"] == "TEXT"), None)
R["remove"] = brief(tool("projMeetRemove", id=tx, requestId=str(uuid.uuid4()))) if tx else "no text meet"
R["removeMissing"] = brief(tool("projMeetRemove", id="tx-nope", requestId=str(uuid.uuid4())))
p3 = proj(week)
fp2, _ = lines_fp()


def changed(a, b):
    return sum(1 for k in set(a) | set(b) if abs((a.get(k) or 0) - (b.get(k) or 0)) > 0.005)


R["projectionsChangedAfterAdd"] = changed(p0, p1)
R["projectionsChangedAfterRebuild"] = changed(p1, p2)
R["projectionsChangedAfterRemove"] = changed(p2, p3)
R["realScoringUnchanged"] = fp0 == fp1 == fp2
R["realLines"] = len(fp0)
json.dump(R, open(OUT, "w"), indent=1, default=str)
print(json.dumps(R, indent=1, default=str)[:6000])
