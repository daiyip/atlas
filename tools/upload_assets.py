"""Upload generated assets to the Cloudflare R2 bucket served at https://data.atlas.daiyip.com.

Usage: python3 tools/upload_assets.py [ai] [music] [narration] [tiles]
Reads ATLAS_R2_ACCOUNT_ID, ATLAS_R2_ACCESS_KEY_ID, ATLAS_R2_SECRET_ACCESS_KEY and ATLAS_R2_BUCKET from the environment
(prefixed, so other projects can keep their own R2 credentials beside these).
  ai:    data/ai/*.webp (made by tools/pack_ai_illustrations.py) go to atlas/ai/<file>; their names already carry a hash.
  music: data/music/*.m4a (made by tools/pack_music.py) go to atlas/music/<file>; hashed names too.
  narration: data/narration/*.m4a (made by tools/pack_narration.py) go to atlas/narration/<file>; hashed names too.
  tiles: tiles/pack/ and tiles/sat/ (made by tools/pack_tiles.py) go to atlas/tiles/<dir>/<name>-<hash>.png, and
         data/tiles.json ({"pack/4-0-0": "pack/4-0-0-<hash>.png", ...}, read by app.js) is rewritten.
Neither local folder is in git. Only files the bucket lacks are sent. Every name carries a content hash, so the files
are cached as immutable: a changed file gets a new name, and the manifests point to it.
Everything goes under atlas/, the folder Atlas owns on R2; plugin apps keep their files under apps/<id>/ (see
docs/data-updates.md)."""
import json, os, sys, zlib
from concurrent.futures import ThreadPoolExecutor
import boto3
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ROOT_KEY = "atlas/"  # the bucket folder Atlas owns
SETS = {"ai": ("data/ai", ROOT_KEY + "ai/", "image/webp"), "music": ("data/music", ROOT_KEY + "music/", "audio/mp4"),
        "narration": ("data/narration", ROOT_KEY + "narration/", "audio/mp4")}

s3 = boto3.client("s3", endpoint_url=f"https://{os.environ['ATLAS_R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                  aws_access_key_id=os.environ["ATLAS_R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["ATLAS_R2_SECRET_ACCESS_KEY"],
                  region_name="auto")
BUCKET = os.environ["ATLAS_R2_BUCKET"]

def existing(prefix):
    keys = set()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix):
        keys.update(o["Key"] for o in page.get("Contents", []))
    return keys

def upload(files, prefix, ctype):
    """files: {key under prefix: local path}. Sends those the bucket lacks."""
    have = existing(prefix)
    todo = [k for k in sorted(files) if prefix + k not in have]
    def put(k):
        s3.upload_file(files[k], BUCKET, prefix + k,
                       ExtraArgs={"ContentType": ctype, "CacheControl": "public, max-age=31536000, immutable"})
    with ThreadPoolExecutor(16) as ex: list(ex.map(put, todo))
    return len(todo), len(have)

def hashed_tiles():
    files, manifest = {}, {}
    for d in ("pack", "sat"):
        for f in sorted(os.listdir(os.path.join(ROOT, "tiles", d))):
            if not f.endswith(".png"): continue
            path = os.path.join(ROOT, "tiles", d, f)
            h = format(zlib.crc32(open(path, "rb").read()), "08x")
            name = f"{d}/{f[:-4]}-{h}.png"
            files[name], manifest[f"{d}/{f[:-4]}"] = path, name
    return files, manifest

for name in sys.argv[1:] or list(SETS) + ["tiles"]:
    if name == "tiles":
        files, manifest = hashed_tiles()
        sent, had = upload(files, ROOT_KEY + "tiles/", "image/png")
        json.dump(manifest, open(os.path.join(ROOT, "data/tiles.json"), "w"), separators=(",", ":"), sort_keys=True)
    else:
        folder, prefix, ctype = SETS[name]
        sent, had = upload({f: os.path.join(ROOT, folder, f) for f in os.listdir(os.path.join(ROOT, folder))}, prefix, ctype)
    print(name, ":", sent, "uploaded,", had, "already there")
