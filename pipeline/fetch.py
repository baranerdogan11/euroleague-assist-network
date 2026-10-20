"""
Fetch every played EuroLeague 2026-27 game's play-by-play and boxscore,
plus the club list and rosters, into pipeline/cache/. Re-runnable: files
already on disk are skipped, so a nightly run only pulls new rounds.

    python pipeline/fetch.py            # incremental
    python pipeline/fetch.py --force    # refetch everything
"""
import json
import sys
import time
from pathlib import Path

import requests

SEASON = "E2026"
API = "https://api-live.euroleague.net/v2/competitions/E/seasons"
LIVE = "https://live.euroleague.net/api"
CACHE = Path(__file__).resolve().parent / "cache"
HEADERS = {"Accept": "application/json", "User-Agent": "euroleague-assist-network/1.0"}


def get_json(url, retries=6):
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            if r.status_code == 429:
                # live.euroleague.net throttles bursts; honour Retry-After
                # when given, otherwise back off geometrically.
                wait = float(r.headers.get("Retry-After") or 5 * (attempt + 1))
                print(f"  429 on {url.split('?')[0].rsplit('/', 1)[-1]} — waiting {wait:.0f}s")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} for {url}: {e}")
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"gave up on {url}")


def cached(path, url, force=False):
    if path.exists() and not force:
        return json.loads(path.read_text())
    data = get_json(url)
    path.write_text(json.dumps(data))
    return data


def main(force=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "pbp").mkdir(exist_ok=True)
    (CACHE / "box").mkdir(exist_ok=True)
    (CACHE / "people").mkdir(exist_ok=True)

    # Games list is always refreshed — it's what tells us about new rounds.
    games = get_json(f"{API}/{SEASON}/games?limit=500")["data"]
    (CACHE / "games.json").write_text(json.dumps(games))
    played = sorted((g for g in games if g["played"]), key=lambda g: g["gameCode"])
    print(f"{len(games)} scheduled, {len(played)} played, "
          f"rounds through {max(g['round'] for g in played) if played else 0}")

    clubs = cached(CACHE / "clubs.json", f"{API}/{SEASON}/clubs", force=True)["data"]
    print(f"{len(clubs)} clubs")
    for c in clubs:
        code = c["code"]
        cached(CACHE / "people" / f"{code}.json",
               f"{API}/{SEASON}/clubs/{code}/people", force)

    for g in played:
        code = g["gameCode"]
        pbp_path = CACHE / "pbp" / f"{code}.json"
        box_path = CACHE / "box" / f"{code}.json"
        fresh = not pbp_path.exists() or not box_path.exists() or force
        cached(pbp_path, f"{LIVE}/PlayByPlay?gamecode={code}&seasoncode={SEASON}", force)
        cached(box_path, f"{LIVE}/Boxscore?gamecode={code}&seasoncode={SEASON}", force)
        if fresh:
            print(f"  fetched game {code} (R{g['round']}) "
                  f"{g['local']['club']['code']} v {g['road']['club']['code']}")
            time.sleep(1.0)
    print("done")


if __name__ == "__main__":
    main(force="--force" in sys.argv)
