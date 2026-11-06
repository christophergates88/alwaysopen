"""Gates HQ "Happening now": every minute, what's being built across Christopher's public repos.

Runs on GitHub Actions in this public repo (free minutes), for close to 6 hours per run, then starts the next run.
Each minute it lists the repos, re-reads only the ones that changed, and writes one JSON row into the hq_code table
of the Always Open D1 database. The Gates HQ page reads that row through the owner's Cloudflare connection.
Private repos (Gates HQ agent, Slope, Cason) are filled in by the page itself from its own connectors.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

OWNER = "christophergates88"
NAMES = {"alwaysopen": "Always Open", "gates-hq-agent": "Gates HQ", "lookout": "Lookout", "slope": "Slope",
         "roomprint-ios": "Roomprint", "dockandkey-ios": "Dock & Key", "mantel": "Cason web", "mantel-ios": "Cason"}
WINDOW_H = 48
TOKEN = os.environ.get("GITHUB_TOKEN", "")
RUN_FOR = int(os.environ.get("RUN_FOR_SEC", str(5 * 3600 + 45 * 60)))
LOCAL = ZoneInfo("America/New_York")
STATS_EVERY = 1800   # the 30-day numbers change slowly: refresh each repo's every 30 minutes
DETAIL_MAX = 40      # +/- lines and files for up to this many recent commits per repo (each read once, then cached)


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


cache = {}    # repo -> {"pushed": ..., "commits": [...]}
details = {}  # full sha -> {"add", "del", "nfiles", "files", "diff"}: a commit never changes, so each is read once
stats = {}    # repo -> {"t": epoch, "s": {...}}


def detail(name, sha):
    if sha not in details:
        d = get(f"/repos/{OWNER}/{name}/commits/{sha}")
        st, files = d.get("stats") or {}, d.get("files") or []
        diff = []
        for f in files[:4]:
            diff += [f["filename"].split("/")[-1]] + lines(f.get("patch"))
        details[sha] = {"add": st.get("additions", 0), "del": st.get("deletions", 0), "nfiles": len(files),
                        "files": [f["filename"].split("/")[-1] for f in files[:6]], "diff": diff[:16]}
    return details[sha]


def read_repo(name, pushed):
    since = (datetime.now(timezone.utc) - timedelta(hours=WINDOW_H)).strftime("%Y-%m-%dT%H:%M:%SZ")
    commits = []
    for i, c in enumerate(get(f"/repos/{OWNER}/{name}/commits?since={since}&per_page=50")):
        item = {"sha": c["sha"][:7], "at": c["commit"]["committer"]["date"], "msg": c["commit"]["message"].split("\n")[0][:120]}
        if i < DETAIL_MAX:
            try:
                d = detail(name, c["sha"])
                item.update({k: d[k] for k in ("add", "del", "nfiles", "files")})
                if i == 0:
                    item["diff"] = d["diff"]
            except Exception:  # noqa: BLE001 - one unreadable commit keeps its message only
                pass
        commits.append(item)
    cache[name] = {"pushed": pushed, "commits": commits}


def repo_stats(name):
    """The analytics in Gates HQ: 30 days of commits by local day and hour, 8 weeks of lines, 7 days of builds."""
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    days, hours, n = {}, [0] * 24, 0
    for page in (1, 2, 3, 4):
        cs = get(f"/repos/{OWNER}/{name}/commits?since={since}&per_page=100&page={page}")
        for c in cs:
            t = iso(c["commit"]["committer"]["date"]).astimezone(LOCAL)
            k = t.strftime("%Y-%m-%d")
            days[k] = days.get(k, 0) + 1
            hours[t.hour] += 1
            n += 1
        if len(cs) < 100:
            break
    out = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "days": days, "hours": hours, "n30": n}
    try:   # weekly lines added / removed (GitHub answers 202 with nothing while it works them out)
        wk = get(f"/repos/{OWNER}/{name}/stats/code_frequency")
        if isinstance(wk, list) and wk:
            out["weeks"] = [[datetime.fromtimestamp(w[0], timezone.utc).strftime("%Y-%m-%d"), w[1], -w[2]] for w in wk[-8:]]
    except Exception:  # noqa: BLE001
        pass
    try:   # builds and deploys started by a push, last 7 days
        d7 = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        runs = get(f"/repos/{OWNER}/{name}/actions/runs?created=%3E%3D{d7}&event=push&per_page=100").get("workflow_runs", [])
        done = [w for w in runs if w.get("status") == "completed" and w.get("conclusion") in ("success", "failure", "timed_out")]
        bad = [w for w in done if w.get("conclusion") != "success"]
        out["runs7"] = {"ok": len(done) - len(bad), "fail": len(bad),
                        "last_fail": ({"name": bad[0]["name"], "at": bad[0]["updated_at"]} if bad else None)}
    except Exception:  # noqa: BLE001
        pass
    return out


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
            if time.time() - stats.get(name, {}).get("t", 0) > STATS_EVERY:
                try:
                    stats[name] = {"t": time.time(), "s": repo_stats(name)}
                except Exception:  # noqa: BLE001 - keep the last numbers; try again next half hour
                    stats.setdefault(name, {"s": None})["t"] = time.time() - STATS_EVERY + 300
            if stats.get(name, {}).get("s"):
                r["stats"] = stats[name]["s"]
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
    """File the pulse with the Always Open worker, which writes the hq_code row (its own D1 access)."""
    data = json.dumps(p, separators=(",", ":")).encode()
    req = urllib.request.Request("https://alwaysopenoffice.com/ops/hq-code", data=data, method="POST",
                                 headers={"content-type": "application/json", "x-key": os.environ.get("OPS_KEY", ""),
                                          "user-agent": "gates-hq-code-pulse"})
    with urllib.request.urlopen(req, timeout=20) as r:
        if r.status != 200:
            raise RuntimeError(f"worker answered {r.status}")


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
