#!/usr/bin/env python3
"""Rebuild wellness/data.js (weekly workout hours) from Strava.

What it does
  1. Gets a fresh Strava access token with the refresh-token flow.
  2. Downloads every activity (GET /athlete/activities, 200 per page) and saves the raw
     dump OUTSIDE the repo (it contains GPS, names and timestamps: never commit it).
  3. Writes wellness/data.js with weekly aggregates only.

Rerun
  export STRAVA_CLIENT_SECRET=...            # never hardcode or commit it
  # either a tokens file (the refreshed tokens are written back to it, chmod 600) ...
  python3 scripts/build_wellness.py --tokens ~/.strava/tokens.json --raw ~/.strava/activities_raw.json
  # ... or a refresh token in the environment (CI style; nothing is written back)
  STRAVA_REFRESH_TOKEN=... python3 scripts/build_wellness.py --raw /tmp/activities_raw.json
  # rebuild from an existing dump without calling Strava
  python3 scripts/build_wellness.py --from-raw ~/.strava/activities_raw.json

  STRAVA_CLIENT_ID defaults to 284564 (the app's public client ID); override with the env var.
  Scopes needed: read,activity:read_all. Rate limit: 100 requests / 15 min; about 16 pages
  for ~3,100 activities, and the script waits if it gets a 429.

What is published (privacy)
  Per ISO week (Monday start, America/New_York): total hours, activity count, and hours and
  counts per Strava sport_type. Nothing else: no per-activity rows, names, times of day,
  GPS/polylines/lat-lng, locations, heart rate or gear.

Duration rule
  hours = moving_time, or elapsed_time when moving_time is 0 (some strength or
  manually logged sessions). An activity is assigned to the week of its start time in
  America/New_York. Indoor sessions (strength, HIIT, yoga, machines) longer than CAP_HOURS
  are capped at CAP_HOURS: Strava's median strength session here is about 20 minutes, so a
  6-10 hour "weight training" entry is a watch left running. Outdoor activities (runs,
  rides, hikes, ski days) are never capped.
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request, urllib.error
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "wellness" / "data.js"
TZ = ZoneInfo("America/New_York")
API = "https://www.strava.com/api/v3"
CAP_HOURS = 3.0  # indoor sessions longer than this are almost always a watch left running
CAPPED_TYPES = {"WeightTraining", "Workout", "Crossfit", "HighIntensityIntervalTraining", "Yoga", "Pilates",
                "StairStepper", "Elliptical", "Rowing", "VirtualRow"}

# sport_type -> display group (anything unlisted goes to "other")
GROUPS = [
    ("strength", "Strength & HIIT", "#2f4b7c", ["WeightTraining", "Workout", "Crossfit", "HighIntensityIntervalTraining"]),
    ("yoga", "Yoga", "#8a6fb0", ["Yoga", "Pilates"]),
    ("run", "Run", "#2e8b7a", ["Run", "TrailRun", "VirtualRun"]),
    ("ride", "Ride", "#d08c2e", ["Ride", "VirtualRide", "EBikeRide", "MountainBikeRide", "GravelRide", "EMountainBikeRide"]),
    ("walk", "Walk & hike", "#a9a77a", ["Walk", "Hike"]),
    ("other", "Other", "#bdbdbd", []),  # skiing, swimming, paddling, stair-stepper, rowing, ...
]


def log(*a):
    print(*a, file=sys.stderr)


def post_form(url, data):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        # report status only; the body could echo request details
        sys.exit(f"Token refresh failed: HTTP {e.code}")


def get_access_token(tokens_path):
    cid = os.environ.get("STRAVA_CLIENT_ID", "284564")
    secret = os.environ.get("STRAVA_CLIENT_SECRET")
    tok = None
    if tokens_path:
        tok = json.loads(Path(tokens_path).expanduser().read_text())
        if tok.get("expires_at", 0) - time.time() > 3600:
            return tok["access_token"]
        refresh = tok["refresh_token"]
    else:
        refresh = os.environ.get("STRAVA_REFRESH_TOKEN")
    if not secret or not refresh:
        sys.exit("Need STRAVA_CLIENT_SECRET and a refresh token (--tokens FILE or STRAVA_REFRESH_TOKEN).")
    new = post_form("https://www.strava.com/oauth/token", {
        "client_id": cid, "client_secret": secret, "grant_type": "refresh_token", "refresh_token": refresh})
    if tokens_path:
        tok.update({k: new[k] for k in ("access_token", "refresh_token", "expires_at", "expires_in") if k in new})
        p = Path(tokens_path).expanduser()
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(tok))
        os.chmod(tmp, 0o600)
        tmp.replace(p)
        os.chmod(p, 0o600)
        log("Access token refreshed and saved back to the tokens file.")
    else:
        log("Access token refreshed (not saved).")
    return new["access_token"]


def fetch_all(access):
    acts, page = [], 1
    while True:
        url = f"{API}/athlete/activities?per_page=200&page={page}"
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + access})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                batch = json.load(r)
                usage = r.headers.get("X-RateLimit-Usage") or r.headers.get("X-ReadRateLimit-Usage")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                log("Rate limited; waiting 15 minutes.")
                time.sleep(15 * 60)
                continue
            sys.exit(f"Activities request failed on page {page}: HTTP {e.code}")
        log(f"page {page}: {len(batch)} activities (rate usage {usage})")
        if not batch:
            break
        acts.extend(batch)
        page += 1
        time.sleep(1)
    return acts


def duration_hours(a):
    s = a.get("moving_time") or 0
    if s <= 0:
        s = a.get("elapsed_time") or 0
    h = s / 3600
    if (a.get("sport_type") or a.get("type")) in CAPPED_TYPES and h > CAP_HOURS:
        return CAP_HOURS, True
    return h, False


def week_start(a):
    utc = datetime.strptime(a["start_date"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    d = utc.astimezone(TZ).date()
    return d - timedelta(days=d.weekday())


def aggregate(acts):
    weeks = defaultdict(lambda: {"h": 0.0, "n": 0, "by": defaultdict(lambda: [0.0, 0])})
    capped = 0
    for a in acts:
        h, was_capped = duration_hours(a)
        capped += was_capped
        t = a.get("sport_type") or a.get("type") or "Other"
        w = weeks[week_start(a)]
        w["h"] += h
        w["n"] += 1
        w["by"][t][0] += h
        w["by"][t][1] += 1
    out = []
    for k in sorted(weeks):
        w = weeks[k]
        out.append({"w": k.isoformat(), "h": round(w["h"], 3), "n": w["n"],
                    "by": {t: [round(v[0], 3), v[1]] for t, v in sorted(w["by"].items())}})
    return out, capped


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tokens", default=os.environ.get("STRAVA_TOKENS_FILE"), help="tokens JSON file (refreshed in place)")
    ap.add_argument("--raw", help="where to save the raw activity dump (must be outside the repo)")
    ap.add_argument("--from-raw", help="build from an existing raw dump instead of calling Strava")
    args = ap.parse_args()

    for p in (args.raw, args.from_raw):
        if p and ROOT in Path(p).expanduser().resolve().parents:
            sys.exit("Keep the raw dump outside the repo.")

    if args.from_raw:
        acts = json.loads(Path(args.from_raw).expanduser().read_text())
    else:
        acts = fetch_all(get_access_token(args.tokens))
        if args.raw:
            p = Path(args.raw).expanduser()
            p.write_text(json.dumps(acts))
            os.chmod(p, 0o600)
            log(f"Raw dump saved ({len(acts)} activities).")

    weeks, capped = aggregate(acts)
    types = sorted({t for w in weeks for t in w["by"]})
    tmap = {t: g for g, _, _, members in GROUPS for t in members}
    now = datetime.now(TZ)
    data = {
        "source": "Strava",
        "generated": now.date().isoformat(),
        "currentWeek": (now.date() - timedelta(days=now.weekday())).isoformat(),
        "timezone": "America/New_York",
        "rule": f"Hours are moving time, or elapsed time when moving time is 0. Indoor sessions (strength, HIIT, yoga, machines) are capped at {CAP_HOURS:g} h each. Weeks start on Monday.",
        "activities": len(acts),
        "rawHours": round(sum((a.get("moving_time") or a.get("elapsed_time") or 0) for a in acts) / 3600, 1),
        "capped": capped,
        "groups": [{"key": g, "name": n, "color": c} for g, n, c, _ in GROUPS],
        "typeGroup": {t: tmap.get(t, "other") for t in types},
        "weeks": weeks,
    }
    js = ("/* Generated by scripts/build_wellness.py from Strava. Do not edit by hand.\n"
          "   Weekly aggregates only: per Monday-start week (America/New_York), total hours, activity count,\n"
          "   and [hours, count] per sport type. No per-activity data. */\n"
          "window.WELLNESS = " + json.dumps(data, separators=(",", ":")) + ";\n")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(js)
    total_h = sum(w["h"] for w in weeks)
    log(f"Wrote {OUT.relative_to(ROOT)}: {len(acts)} activities, {len(weeks)} active weeks, "
        f"{total_h:.1f} h, {capped} sessions capped, types: {', '.join(types)}")


if __name__ == "__main__":
    main()
