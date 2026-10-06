"""Temporary probe: latency, errors and match rate of the TGAZ API for card lookups (name + year)."""
import concurrent.futures as cf, json, random, statistics, time, urllib.parse, urllib.request
UA = {"User-Agent": "Atlas/1.0 (https://github.com/daiyip/atlas; educational history map)", "Origin": "https://atlas.daiyip.com"}
d = json.load(open("data/admin.json"))
random.seed(7)
sample = random.sample(d["items"], 150)

def look(r):
    name, lon, lat, y0, y1 = r[0], r[3], r[4], r[5], r[6] if r[6] is not None else 1911
    y = (y0 + y1) // 2
    url = "https://chgis.hudci.org/tgaz/placename?" + urllib.parse.urlencode({"fmt": "json", "n": name, "yr": y})
    t = time.time()
    try:
        body = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20).read()
        ms = (time.time() - t) * 1000
        res = json.loads(body).get("placenames", [])
    except Exception as e:
        return {"ms": (time.time() - t) * 1000, "err": type(e).__name__, "size": 0}
    def near(p):
        try: x, yy = [float(v) for v in p["xy coordinates"].split(",")]
        except Exception: return False
        return abs(x - lon) < 0.05 and abs(yy - lat) < 0.05
    hit = any(p.get("name") == name and near(p) for p in res)
    return {"ms": ms, "err": None, "n": len(res), "hit": hit, "size": len(body)}

def report(label, rs):
    ok = [r for r in rs if not r["err"]]
    ms = sorted(r["ms"] for r in ok)
    q = lambda p: round(ms[min(len(ms) - 1, int(p * len(ms)))]) if ms else None
    print(f"{label}: n={len(rs)} errors={len(rs)-len(ok)} p50={q(.5)}ms p90={q(.9)}ms p99={q(.99)}ms max={round(max(ms)) if ms else None}ms "
          f"match={sum(r['hit'] for r in ok)}/{len(ok)} avg_results={statistics.mean(r['n'] for r in ok) if ok else 0:.1f} avg_kb={statistics.mean(r['size'] for r in ok)/1024 if ok else 0:.1f}")
    errs = {}
    for r in rs:
        if r["err"]: errs[r["err"]] = errs.get(r["err"], 0) + 1
    if errs: print("  errors:", errs)

report("sequential", [look(r) for r in sample[:60]])
with cf.ThreadPoolExecutor(10) as ex: report("10 at once", list(ex.map(look, sample[60:])))
# A second round on the same names: does the server cache?
report("repeat", [look(r) for r in sample[:30]])
