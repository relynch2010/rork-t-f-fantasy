"""Integration test in the QA test league: draft/preview change nothing, sandbox publish (participation 1 -> 2) updates
open-week projections, finished weeks keep identical fingerprints, duplicate tap ignored, non-commissioner blocked."""
import json, os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, toks
d = json.load(open("/tmp/qa_league.json")); T = toks(); lid = d["lid"]
tool = lambda op, who="commish", **a: req("POST", f"/leagues/{lid}/tools", {"op": op, **a}, T[who], timeout=170)
rank = lambda: req("GET", f"/leagues/{lid}/projections?week=8&rankings=1", None, T["commish"], timeout=120)
out = {}
fp0 = tool("fingerprint")
r0 = rank()
out["rankBefore"] = {x["athleteId"]: (x.get("projected"), x.get("state"), x.get("upside")) for x in r0.get("rows", [])}
cur = tool("draftLoad")["current"]["rules"]
draft = {**cur, "participation": 2}
out["draftSave"] = tool("draftSave", rules=draft).get("message")
out["preview"] = {k: v for k, v in tool("draftPreview").items() if k in ("athletesAffected", "finishedWeekChanges", "unchanged", "finishedWeeksProtected", "diff")}
fp1 = tool("fingerprint")
out["draftAndPreviewChangedNothing"] = fp0["hash"] == fp1["hash"]
out["nonCommishPublish"] = tool("sandboxPublish", who="m1", confirm="PUBLISH")
out["noConfirm"] = tool("sandboxPublish", confirm="publish")
rid = uuid.uuid4().hex
out["publish"] = tool("sandboxPublish", confirm="PUBLISH", requestId=rid)
out["duplicateTap"] = tool("sandboxPublish", confirm="PUBLISH", requestId=rid)
fp2 = tool("fingerprint")
out["finishedWeeksIdentical"] = fp0["hash"] == fp2["hash"]
r1 = rank()
after = {x["athleteId"]: (x.get("projected"), x.get("state"), x.get("upside")) for x in r1.get("rows", [])}
moved = [(k, out["rankBefore"][k][0], v[0]) for k, v in after.items() if k in out["rankBefore"] and v[0] != out["rankBefore"][k][0]]
out["projectionsChanged"] = len(moved); out["projectionExamples"] = moved[:6]
out["rankMeta"] = {k: r1.get(k) for k in ("requestedWeek", "targetWeek", "noMeet", "stateCounts")}
out["refresh"] = tool("projHealth", refresh=True).get("message")
out["fp3Identical"] = tool("fingerprint")["hash"] == fp0["hash"]
vers = tool("adminVersions")
out["sandboxVersions"] = [(v["version"], v["note"]) for v in vers["sandbox"]]
out["restore"] = tool("sandboxRestore", confirm="PUBLISH", version=5, source="global", requestId=uuid.uuid4().hex)
out["afterRestoreVersions"] = [(v["version"], v["note"]) for v in tool("adminVersions")["sandbox"]]
out["fp4Identical"] = tool("fingerprint")["hash"] == fp0["hash"]
r2 = rank()
back = {x["athleteId"]: x.get("projected") for x in r2.get("rows", [])}
out["projectionsBackToBaseline"] = all(back.get(k) == v[0] for k, v in out["rankBefore"].items() if k in back)
out["changelog"] = [(e["kind"], e["text"][:90]) for e in tool("changelog")["entries"][:8]]
json.dump(out, open("/tmp/qa_out/sandbox_publish_test.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != "rankBefore"}, indent=1))
