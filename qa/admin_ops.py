"""Calls Admin Panel tool ops on the QA test league and stores raw JSON under /tmp/qa_out/<op>.json.
Usage: python3 qa/admin_ops.py op [json-args] [account]"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, toks
d = json.load(open("/tmp/qa_league.json"))
op = sys.argv[1]; args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
who = sys.argv[3] if len(sys.argv) > 3 else "commish"
r = req("POST", f"/leagues/{d['lid']}/tools", {"op": op, **args}, toks()[who], timeout=170)
os.makedirs("/tmp/qa_out", exist_ok=True)
json.dump(r, open(f"/tmp/qa_out/{op}.json", "w"), indent=1)
print(json.dumps(r)[:1500])
