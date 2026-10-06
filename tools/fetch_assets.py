"""Download the generated assets that live on R2 (https://data.atlas.daiyip.com) back into a local checkout. Files sit under the bucket's atlas/ prefix.

Usage: python3 tools/fetch_assets.py [tiles] [ai] [music] [narration]
  tiles: every pack named in data/tiles.json, saved as tiles/<pack|sat>/<z>-<x>-<y>.png (the hash dropped), the
         layout tools/pack_tiles.py writes and tools/terrain_grid.py reads.
  ai:    every picture named in data/ai-illustrations.json, saved as data/ai/<file>.webp (960x640 packed copies;
         the full-size originals are not on R2).
Public URLs, so no credentials are needed. Files already present with the right content are skipped."""
import json, os, sys, urllib.request, zlib
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA_URL = "https://data.atlas.daiyip.com/atlas"  # the folder Atlas owns on R2

def jobs(name):
    if name == "tiles":
        for key, file in json.load(open(os.path.join(ROOT, "data/tiles.json"))).items():
            yield f"{DATA_URL}/tiles/{file}", os.path.join(ROOT, "tiles", key + ".png"), file.rsplit("-", 1)[1][:8]
    elif name == "narration":
        for n in json.load(open(os.path.join(ROOT, "data/narration.json"))).values():
            for k, file in n.items():
                if k != "h": yield f"{DATA_URL}/narration/{file}", os.path.join(ROOT, "data/narration", file), None
    elif name == "music":
        for m in json.load(open(os.path.join(ROOT, "data/music.json"))).values():
            yield f"{DATA_URL}/music/{m['f']}", os.path.join(ROOT, "data/music", m["f"]), None
    else:
        for im in json.load(open(os.path.join(ROOT, "data/ai-illustrations.json")))["images"].values():
            yield f"{DATA_URL}/ai/{im['f']}", os.path.join(ROOT, "data/ai", im["f"]), None

def get(job):
    url, path, crc = job
    if os.path.exists(path) and (crc is None or format(zlib.crc32(open(path, "rb").read()), "08x") == crc): return 0
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "atlas-fetch"}), timeout=120).read()
    open(path, "wb").write(data)
    return 1

for name in sys.argv[1:] or ["tiles", "ai", "music", "narration"]:
    with ThreadPoolExecutor(8) as ex: n = sum(ex.map(get, list(jobs(name))))
    print(name, ":", n, "downloaded")
