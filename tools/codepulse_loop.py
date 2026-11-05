"""Gates HQ "Happening now": every minute, what's being built across Christopher's public repos.

Runs on GitHub Actions in this public repo (free minutes), for close to 6 hours per run, then starts the next run.
Each minute it lists the repos, re-reads only the ones that changed, and writes one JSON row into the hq_code table
of the Always Open D1 database. The Gates HQ page reads that row through the owner's Cloudflare connection.
Private repos (Gates HQ agent, Slope, Cason) are filled in by the page itself from its own connectors.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

OWNER = "christophergates88"
NAMES = {"alwaysopen": "Always Open", "gates-hq-agent": "Gates HQ", "lookout": "Lookout", "slope": "Slope",
         "roomprint-ios": "Roomprint", "dockandkey-ios": "Dock & Key", "mantel": "Cason web", "mantel-ios": "Cason"}
WINDOW_H = 48
TOKEN = os.environ.get("GITHUB_TOKEN", "")
RUN_FOR = int(os.environ.get("RUN_FOR_SEC", str(5 * 3600 + 45 * 60)))


def get(path):
    req = urllib.request.Request("https://api.github.com" + path, headers={
        "Accept": "application/vnd.github+json", "User-Agent": "gates-hq-code-pulse",
        **({"Authorization": f"Bearer {TOKEN}"} if TOKEN else {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def lines(patch, n=4):
    out = []
    for ln in (patch or "").splitlines():
        if ln.startswith(("+++", "---", "@@")):
            continue
        if ln[:1] in "+-" and ln[1:].strip():
            out.append(ln[0] + " " + ln[1:].strip()[:110])
        if len(out) >= n:
            break
    return out


def iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


cache = {}   # repo -> {"pushed": ..., "commits": [...]}


def read_repo(name, pushed):
    since = (datetime.now(timezone.utc) - timedelta(hours=WINDOW_H)).strftime("%Y-%m-%dT%H:%M:%SZ")
    commits = []
    for i, c in enumerate(get(f"/repos/{OWNER}/{name}/commits?since={since}&per_page=8")):
        item = {"sha": c["sha"][:7], "at": c["commit"]["committer"]["date"], "msg": c["commit"]["message"].split("\n")[0][:120]}
        if i < 3:
            d = get(f"/repos/{OWNER}/{name}/commits/{c['sha']}")
            st, files = d.get("stats") or {}, d.get("files") or []
            item.update({"add": st.get("additions", 0), "del": st.get("deletions", 0), "nfiles": len(files),
                         "files": [f["filename"].split("/")[-1] for f in files[:6]]})
            if i == 0:
                diff = []
                for f in files[:4]:
                    diff += [f["filename"].split("/")[-1]] + lines(f.get("patch"))
                item["diff"] = diff[:16]
        commits.append(item)
    cache[name] = {"pushed": pushed, "commits": commits}


def pulse():
    now = datetime.now(timezone.utc)
    try:
        listed = {r["name"]: r for r in get(f"/users/{OWNER}/repos?sort=pushed&per_page=50")}
    except Exception:  # noqa: BLE001 - fall back to one call per repo
        listed = {}
        for name in NAMES:
            try:
                info = get(f"/repos/{OWNER}/{name}")
                if not info.get("private"):
                    listed[name] = info
            except Exception:  # noqa: BLE001
                pass
    repos = []
    for name, label in NAMES.items():
        r = {"repo": name, "name": label, "commits": [], "running": [], "error": ""}
        info = listed.get(name)
        if not info:   # private: the page fills it in
            r["error"] = "private"
            repos.append(r)
            continue
        r["pushed"] = info.get("pushed_at")
        try:
            if cache.get(name, {}).get("pushed") != r["pushed"]:
                read_repo(name, r["pushed"])
            r["commits"] = cache[name]["commits"]
            # deploys follow pushes: only ask about running jobs for repos pushed in the last 2 hours
            if r["pushed"] and now - iso(r["pushed"]) < timedelta(hours=2):
                runs = get(f"/repos/{OWNER}/{name}/actions/runs?per_page=5").get("workflow_runs", [])
                r["running"] = [{"name": w["name"], "status": w["status"], "at": w["created_at"]}
                                for w in runs if w["status"] in ("in_progress", "queued") and w["name"] != "Gates HQ live code pulse"]
                last = next((w for w in runs if w["status"] == "completed"), None)
                if last:
                    r["last_run"] = {"name": last["name"], "ok": last["conclusion"] == "success", "at": last["updated_at"]}
        except Exception as e:  # noqa: BLE001
            r["error"] = str(e)[:120]
        repos.append(r)
    return {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "window_h": WINDOW_H, "repos": repos,
            "pace": {"gap": 60, "why": "live every minute (free)", "free": True}}


def write(p):
    body = json.dumps(p, separators=(",", ":")).replace("'", "''")
    with open("pulse.sql", "w") as f:
        f.write(f"INSERT OR REPLACE INTO hq_code (id, at, json) VALUES (1, '{p['at']}', '{body}');\n")
    r = subprocess.run(["wrangler", "d1", "execute", "alwaysopen", "--remote", "--file", "pulse.sql"],
                       capture_output=True, text=True, timeout=90, input="y\n")
    if r.returncode != 0:
        raise RuntimeError(("wrangler: " + (r.stderr or r.stdout))[-400:].replace("\n", " "))


def main():
    end = time.time() + RUN_FOR
    n = 0
    while time.time() < end:
        start = time.time()
        try:
            p = pulse()
            write(p)
            n += 1
            print(f"{p['at']} filed ({sum(len(r['commits']) for r in p['repos'])} commits)", flush=True)
        except Exception as e:  # noqa: BLE001 - a bad minute must not end the run
            print(f"{datetime.now(timezone.utc):%H:%M:%S} error: {e}", flush=True)
        time.sleep(max(5, 60 - (time.time() - start)))
    print(f"done: {n} pulses")


if __name__ == "__main__":
    if "--once" in sys.argv:
        print(json.dumps(pulse())[:1500])
    else:
        main()
