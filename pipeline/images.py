"""
Download club crests and player headshots for the viewer.
  public/logos/{CLUB}.png
  public/headshots/{PLAYER_ID}.png  (+ manifest.json listing available ids)
Only players that appear in a network JSON are fetched. Re-runnable.
"""
import json
import time
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / "cache"
DATA = ROOT / "public" / "data"
LOGOS = ROOT / "public" / "logos"
HEADS = ROOT / "public" / "headshots"
HEADERS = {"User-Agent": "euroleague-assist-network/1.0"}


def fetch(url, path):
    if path.exists() or not url:
        return path.exists()
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        if not r.content or "image" not in r.headers.get("Content-Type", "image"):
            return False
        path.write_bytes(r.content)
        time.sleep(0.15)
        return True
    except requests.RequestException as e:
        print(f"  failed {url}: {e}")
        return False


HEAD_W = 180  # thumbnail width; the viewer shows them at 30-60px


def shrink(path, width=HEAD_W):
    """Downscale a headshot in place (the CDN serves 750x1000 PNGs, ~550 KB each)."""
    try:
        with Image.open(path) as im:
            if im.width <= width:
                return
            h = round(im.height * width / im.width)
            im = im.convert("RGBA").resize((width, h), Image.LANCZOS)
            im.save(path, "PNG", optimize=True)
    except Exception as e:  # noqa: BLE001
        print(f"  could not shrink {path.name}: {e}")


def main():
    LOGOS.mkdir(parents=True, exist_ok=True)
    HEADS.mkdir(parents=True, exist_ok=True)
    clubs = json.loads((CACHE / "clubs.json").read_text())["data"]
    for c in clubs:
        ok = fetch((c.get("images") or {}).get("crest", ""), LOGOS / f"{c['code']}.png")
        if ok:
            shrink(LOGOS / f"{c['code']}.png", 256)
        if not ok:
            print(f"  no crest for {c['code']}")

    heads = {}
    for c in clubs:
        for p in json.loads((CACHE / "people" / f"{c['code']}.json").read_text()):
            if p["type"] == "J":
                heads["P" + p["person"]["code"]] = (p.get("images") or {}).get("headshot", "")

    wanted = set()
    for f in (DATA / "assist_networks").glob("*.json"):
        for n in json.loads(f.read_text())["nodes"]:
            wanted.add(n["player_id"])
    have = []
    for pid_ in sorted(wanted):
        if fetch(heads.get(pid_, ""), HEADS / f"{pid_}.png"):
            shrink(HEADS / f"{pid_}.png")
            have.append(pid_)
    (HEADS / "manifest.json").write_text(json.dumps(have))
    print(f"{len(have)}/{len(wanted)} headshots, {len(list(LOGOS.glob('*.png')))} crests")


if __name__ == "__main__":
    main()
