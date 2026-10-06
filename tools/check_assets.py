"""Check that every file the indexes name is on R2 and can be read by the page.

Usage: python3 tools/check_assets.py
For each file named in data/tiles.json, data/ai-illustrations.json, data/music.json and data/narration.json, asks https://data.atlas.daiyip.com/atlas for it
(HEAD, with the site's Origin) and expects 200, the right content type and Access-Control-Allow-Origin (the app
fetch()es the packs, so a missing CORS header breaks them as surely as a missing file; see docs/data-updates.md).
Exits 1 and lists the failures if any. Run by .github/workflows/assets.yml."""
import json, os, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA_URL, ORIGIN = "https://data.atlas.daiyip.com/atlas", "https://atlas.daiyip.com"  # the folder Atlas owns on R2

def files():
    for f in json.load(open(os.path.join(ROOT, "data/tiles.json"))).values(): yield f"tiles/{f}", "image/png"
    for im in json.load(open(os.path.join(ROOT, "data/ai-illustrations.json")))["images"].values(): yield f"ai/{im['f']}", "image/webp"
    if os.path.exists(os.path.join(ROOT, "data/music.json")):
        for m in json.load(open(os.path.join(ROOT, "data/music.json"))).values(): yield f"music/{m['f']}", "audio/mp4"
    if os.path.exists(os.path.join(ROOT, "data/narration.json")):
        for n in json.load(open(os.path.join(ROOT, "data/narration.json"))).values():
            for k, f in n.items():
                if k != "h": yield f"narration/{f}", "audio/mp4"

def check(item):
    path, ctype = item
    req = urllib.request.Request(f"{DATA_URL}/{path}", method="HEAD", headers={"Origin": ORIGIN, "User-Agent": "atlas-check"})
    for attempt in range(3):
        try:
            r = urllib.request.urlopen(req, timeout=30)
            problems = [p for p, bad in (("content type " + str(r.headers.get("Content-Type")), r.headers.get("Content-Type") != ctype),
                                         ("no Access-Control-Allow-Origin", not r.headers.get("Access-Control-Allow-Origin"))) if bad]
            return path, "; ".join(problems) or None
        except urllib.error.HTTPError as e:
            if e.code < 500: return path, f"HTTP {e.code}"
            err = f"HTTP {e.code}"
        except Exception as e:
            err = str(e)
        time.sleep(2 * (attempt + 1))
    return path, err

items = list(files())
with ThreadPoolExecutor(8) as ex: bad = [(p, why) for p, why in ex.map(check, items) if why]
for p, why in bad: print("FAIL", p, "-", why)
print(f"{len(items) - len(bad)}/{len(items)} files fine")
sys.exit(1 if bad else 0)
