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
  Aggregates only, in America/New_York local time:
  - per ISO week (Monday start): total hours, activity count, hours and counts per sport_type;
  - per calendar month: hours and counts per sport_type;
  - per calendar year, and per like-for-like year-to-date span (Jan 1 through the snapshot's
    month/day in every year): hours and counts per sport_type, the number of weeks in the span
    and how many of them were active.
  Nothing else: no per-activity rows, names, times of day, GPS/polylines/lat-lng, locations,
  heart rate or gear. The snapshot date ("generated") is the fetch date; with --from-raw it is
  the raw file's modification date.

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
from datetime import date, datetime, timedelta, timezone
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


def local_day(a):
    utc = datetime.strptime(a["start_date"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return utc.astimezone(TZ).date()


def week_start(a):
    d = local_day(a)
    return d - timedelta(days=d.weekday())


def sport(a):
    return a.get("sport_type") or a.get("type") or "Other"


def span_summary(acts, start, end, tmap):
    """Aggregate activities whose local start day is in [start, end] (inclusive).
    Returns {days, wk, aw:[active weeks, active weeks without walks & hikes], by:{type:[hours, count]}}.
    wk = number of Monday-start weeks overlapping the span."""
    by = defaultdict(lambda: [0.0, 0])
    act_all, act_nowalk = set(), set()
    for a in acts:
        d = local_day(a)
        if not (start <= d <= end):
            continue
        h, _ = duration_hours(a)
        t = sport(a)
        by[t][0] += h
        by[t][1] += 1
        ws = d - timedelta(days=d.weekday())
        act_all.add(ws)
        if tmap.get(t, "other") != "walk":
            act_nowalk.add(ws)
    first_mon = start - timedelta(days=start.weekday())
    wk = (end - first_mon).days // 7 + 1
    return {"days": (end - start).days + 1, "wk": wk, "aw": [len(act_all), len(act_nowalk)],
            "by": {t: [round(v[0], 3), v[1]] for t, v in sorted(by.items())}}


def month_totals(acts):
    months = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for a in acts:
        h, _ = duration_hours(a)
        v = months[local_day(a).strftime("%Y-%m")][sport(a)]
        v[0] += h
        v[1] += 1
    return [{"m": m, "by": {t: [round(v[0], 3), v[1]] for t, v in sorted(months[m].items())}} for m in sorted(months)]


def year_and_ytd(acts, today, tmap):
    """Calendar-year totals (current year through today) and like-for-like year-to-date
    totals: Jan 1 through today's month/day in every year."""
    years, ytd = {}, {}
    first = min(local_day(a) for a in acts).year
    for y in range(first, today.year + 1):
        end_y = min(date(y, 12, 31), today)
        years[str(y)] = span_summary(acts, date(y, 1, 1), end_y, tmap)
        md = (today.month, min(today.day, 28) if today.month == 2 and today.day == 29 else today.day)
        ytd[str(y)] = span_summary(acts, date(y, 1, 1), date(y, *md), tmap)
    return years, ytd


def aggregate(acts):
    weeks = defaultdict(lambda: {"h": 0.0, "n": 0, "by": defaultdict(lambda: [0.0, 0])})
    capped = 0
    for a in acts:
        h, was_capped = duration_hours(a)
        capped += was_capped
        t = sport(a)
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

    now = datetime.now(TZ)
    if args.from_raw:
        raw_path = Path(args.from_raw).expanduser()
        acts = json.loads(raw_path.read_text())
        # The snapshot date is when the dump was fetched, so YTD spans match the data.
        now = datetime.fromtimestamp(raw_path.stat().st_mtime, TZ)
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
    years, ytd = year_and_ytd(acts, now.date(), tmap)
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
        # Calendar months (local time) with [hours, count] per sport type.
        "months": month_totals(acts),
        # Calendar years (the current one through "generated") and like-for-like year-to-date
        # spans (Jan 1 through the month/day of "generated" in every year).
        "years": years,
        "ytd": ytd,
    }
    js = ("/* Generated by scripts/build_wellness.py from Strava. Do not edit by hand.\n"
          "   Aggregates only (America/New_York): per Monday-start week, per calendar month, per calendar\n"
          "   year and per year-to-date span: hours, activity counts, active-week counts and [hours, count]\n"
          "   per sport type. No per-activity data. */\n"
          "window.WELLNESS = " + json.dumps(data, separators=(",", ":")) + ";\n")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(js)
    total_h = sum(w["h"] for w in weeks)
    log(f"Wrote {OUT.relative_to(ROOT)}: {len(acts)} activities, {len(weeks)} active weeks, "
        f"{total_h:.1f} h, {capped} sessions capped, types: {', '.join(types)}")


if __name__ == "__main__":
    main()
