"""Pack AI-generated event illustrations (made by tools/ai_illustrate.py) into data/ai-illustrations.json and
data/ai/<bucket>-<hash>.json (WebP data URLs, loaded on demand by app.js, shown labelled as AI-generated).

Usage: python3 tools/pack_ai_illustrations.py OUT_DIR/openai
data/ai-illustrations-skip.json lists event ids whose picture was judged wrong or unsuitable."""
import base64, collections, io, json, os, sys, zlib
from PIL import Image
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
P = lambda *a: os.path.join(ROOT, *a)
SRC, BUCKETS, BOX, MODEL = sys.argv[1], 8, (480, 320), "GPT Image 2"

skip = set(json.load(open(P("data/ai-illustrations-skip.json")))) if os.path.exists(P("data/ai-illustrations-skip.json")) else set()
keys, images, buckets = {}, {}, collections.defaultdict(dict)
for n, f in enumerate(sorted(x for x in os.listdir(SRC) if x.endswith(".png"))):
    eid = f[:-4]
    if eid in skip: continue
    im = Image.open(os.path.join(SRC, f)).convert("RGB")
    im.thumbnail(BOX, Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "WEBP", quality=60, method=6)
    iid, b = "ai-" + eid, n % BUCKETS
    buckets[b][iid] = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
    images[iid] = {"b": b, "page": eid, "ai": MODEL, "w": im.width, "h": im.height}
    keys["a:" + eid] = iid
os.makedirs(P("data/ai"), exist_ok=True)
for f in os.listdir(P("data/ai")): os.remove(P("data/ai", f))
for b, d in buckets.items():
    # The file name carries a content hash: sw.js keeps data/ai/ files forever under the same name.
    text = json.dumps(d, separators=(",", ":"))
    name = f"{b}-{zlib.crc32(text.encode()):08x}"
    open(P(f"data/ai/{name}.json"), "w").write(text)
    for iid in d: images[iid]["b"] = name
json.dump({"keys": keys, "images": images}, open(P("data/ai-illustrations.json"), "w"), separators=(",", ":"))
size = sum(os.path.getsize(P("data/ai", f)) for f in os.listdir(P("data/ai")))
print(len(keys), "events,", round(size / 1e6, 1), "MB")
