"""Pack tour narration (made by tools/ai_narration.py) into data/narration/<tour>__<step>__<voice>-<hash>.m4a (40 kbps
mono AAC, with macOS afconvert) and the index data/narration.json:
{"<tour>/<step>": {"h": caption CRC, "<voice>": file, ...}}, read by app.js. Only files whose caption CRC matches the
step's current Chinese caption are packed. Upload with tools/upload_assets.py narration; data/narration/ is not in git.

Usage: python3 tools/pack_narration.py ~/Pictures/atlas-ai/narration"""
import json, os, subprocess, sys, tempfile, zlib
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ai_narration import steps, text_hash, VOICES
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
P = lambda *a: os.path.join(ROOT, *a)
SRC = sys.argv[1]

os.makedirs(P("data/narration"), exist_ok=True)
jobs = [(t, i, h, v) for t, i, text in steps(set()) for h in [text_hash(text)] for v in VOICES
        if os.path.exists(os.path.join(SRC, f"{t}__{i}__{v}__{h}.wav"))]

def pack(job):
    t, i, h, v = job
    src = os.path.join(SRC, f"{t}__{i}__{v}__{h}.wav")
    with tempfile.NamedTemporaryFile(suffix=".m4a") as tmp:
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-c", "1", "-b", "40000", src, tmp.name], check=True)
        data = open(tmp.name, "rb").read()
    name = f"{t}__{i}__{v}-{zlib.crc32(data):08x}.m4a"
    if not os.path.exists(P("data/narration", name)): open(P("data/narration", name), "wb").write(data)
    return t, i, h, v, name

index, files = {}, set()
with ThreadPoolExecutor(8) as ex:
    for t, i, h, v, name in ex.map(pack, jobs):
        index.setdefault(f"{t}/{i}", {"h": h})[v] = name; files.add(name)
for f in os.listdir(P("data/narration")):
    if f not in files: os.remove(P("data/narration", f))
json.dump(index, open(P("data/narration.json"), "w"), separators=(",", ":"), sort_keys=True)
print(len(index), "steps,", len(files), "files,", round(sum(os.path.getsize(P("data/narration", f)) for f in files) / 1e6, 1), "MB")
