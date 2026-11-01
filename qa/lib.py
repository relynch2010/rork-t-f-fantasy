"""QA helpers for the isolated test environment (throwaway accounts/leagues). Tokens are kept in /tmp, never in the repo."""
import json, os, urllib.request, uuid
API = "https://trackdraft-backend.rork.app"
TOK = "/tmp/qa_toks.json"

def req(method, path, body=None, tok=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json", "User-Agent": "qa-script/1.0", **({"Authorization": f"Bearer {tok}"} if tok else {})})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp: return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return {"_status": e.code, **json.loads(e.read() or b"{}")}
        except Exception: return {"_status": e.code}

def toks():
    return json.load(open(TOK)) if os.path.exists(TOK) else {}

def account(key, name=None):
    T = toks()
    if key in T: return T[key]
    email = f"qa-{key}-{uuid.uuid4().hex[:8]}@example.com"
    r = req("POST", "/auth/signup", {"email": email, "password": "qa-pass-1234", "name": name or f"QA {key}"})
    t = r.get("token") or r.get("session", {}).get("token")
    if not t: raise SystemExit(f"signup failed {r}")
    T[key] = t; json.dump(T, open(TOK, "w")); return t
