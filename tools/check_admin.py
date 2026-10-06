"""Compare the drafted seat snapshots (tools/admin/*.json) with CHGIS V6 (tools/.cache/chgis-admin.json, made by
tools/chgis_admin.py) at each snapshot's year. Prints coverage and seat distances, and lists drafted seats that sit
far from CHGIS's seat of the same name, so they can be re-checked. Output names only, never CHGIS's values.

    python3 tools/check_admin.py [--far KM] [snapshot ...]"""
import glob, json, math, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
args = sys.argv[1:]
far = float(args[args.index("--far") + 1]) if "--far" in args else 25
names = [a for a in args if not a.startswith("--") and not re.match(r"^\d+(\.\d+)?$", a)]
ref_all = json.load(open(os.path.join(ROOT, "tools/.cache/chgis-admin.json")))
T = ref_all["types"]


def km(a, b, c, e):
    p = math.pi / 180
    return 6371 * math.acos(min(1, math.sin(b * p) * math.sin(e * p) + math.cos(b * p) * math.cos(e * p) * math.cos((a - c) * p)))


for path in sorted(glob.glob(os.path.join(ROOT, "tools/admin/*.json"))):
    snap = os.path.basename(path)[:-5]
    if names and snap not in names: continue
    y = int(snap.rsplit("_", 1)[1])
    dr = json.load(open(path))
    ref = [r for r in ref_all["items"] if r[5] <= y <= (r[6] if r[6] is not None else 1911) and T[r[2]][2] == 2]
    used, matches = set(), []
    for x in dr:
        best = next((i for i, r in enumerate(ref) if i not in used and r[0] == x["name_zh"]), None)
        if best is None:  # same stem (长沙国 / 长沙郡) within 60 km
            stem = x["name_zh"][:-1] if len(x["name_zh"]) > 2 else x["name_zh"]
            best = next((i for i, r in enumerate(ref) if i not in used and r[0].startswith(stem) and km(r[3], r[4], x["lon"], x["lat"]) < 60), None)
        if best is not None:
            used.add(best)
            r = ref[best]
            matches.append((x, km(r[3], r[4], x["lon"], x["lat"])))
    d = sorted(m[1] for m in matches)
    q = lambda p: round(d[int(p * (len(d) - 1))]) if d else None
    print(f"{snap}: draft {len(dr)}, CHGIS {len(ref)}, matched {len(matches)} ({len(matches) / max(1, len(ref)):.0%} of CHGIS); km p50 {q(.5)} p90 {q(.9)}")
    off = [f"{m[0]['name_zh']}({round(m[1])}km)" for m in matches if m[1] > far]
    if off: print(f"   far (> {far:g} km):", " ".join(off))
    print("   not in CHGIS:", len(dr) - len(matches), "· CHGIS seats not drafted:", len(ref) - len(used))
