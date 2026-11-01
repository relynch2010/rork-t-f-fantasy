"""Deletes the QA leagues and QA accounts created for projection/table testing. Never touches the Main League."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from lib import req, toks

MAIN = "fb75aa8b4e2241a68fce"
T = toks()
leagues = [("aee058da23fa40778bfd", "probe2")]
if os.path.exists("/tmp/qa_league.json"):
    leagues.append((json.load(open("/tmp/qa_league.json"))["lid"], "commish"))
for lid, who in leagues:
    if lid == MAIN or who not in T: continue
    name = req("GET", f"/leagues/{lid}", None, T[who]).get("name", "")
    print("delete league", lid, req("POST", f"/leagues/{lid}/delete", {"confirmName": name}, T[who]))
for who, tok in T.items():
    print("delete account", who, req("POST", "/me/delete", {}, tok))
os.remove("/tmp/qa_toks.json")
