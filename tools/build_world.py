"""Build the world border maps (data/world/*.json).

States come from Cliopatria (Seshat Global History Databank, CC BY 4.0, https://github.com/Seshat-Global-History-
Databank/cliopatria), which gives each polity's territory for every year from 3400 BC; a map is drawn at each year
the polities change, at most one every 100 years before 1000 BC, 50 before AD 1, 25 before 1500, 20 before 1800
and 10 after. Land that no Cliopatria polity holds is filled from the nearest historical-basemaps snapshot
(aourednik/historical-basemaps), which also names peoples and cultures without a state.
A Cliopatria polity that matches a historical-basemaps feature (mostly the same land, or a good part of it when the
app refers to that name) takes that feature's name, so the names used by regions.json `focus`, the rulers in
data/layers/world-*.json and the Chinese names (data/world/names_zh.json) stay stable.

Each snapshot becomes data/world/<year>.json (the whole world). Snapshots that fall inside the Chinese dynasties
(2070 BC to 1912) also get data/world/<year>-outer.json: the same map with the East Asia window that the dynasty
maps cover (tools/build_borders.py CLIP) cut out, drawn around those maps.
Usage: python3 tools/build_world.py   (downloads into tools/.cache on first run)"""
import colorsys, glob, hashlib, json, os, re, urllib.request, zipfile
import shapely
from shapely.geometry import box, mapping, shape
from shapely.strtree import STRtree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
P = lambda *a: os.path.join(ROOT, *a)
HB = "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_{}.geojson"
CLIO = "https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/main/cliopatria.geojson.zip"
KEYS = ["bc3000", "bc2000", "bc1500", "bc1000", "bc700", "bc500", "bc400", "bc323", "bc300", "bc200", "bc100", "bc1",
        "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000", "1100", "1200", "1279", "1300", "1400",
        "1492", "1500", "1530", "1600", "1650", "1700", "1715", "1783", "1800", "1815", "1880", "1900", "1914", "1920",
        "1930", "1938", "1945", "1960", "1994", "2000", "2010"]
EXTRA = [-323, 1492, 1914, 1945]   # years worth a map of their own
# Cliopatria names spelled differently from the ones the app's data uses.
ALIASES = {"Khwarezmid Dynasty": "Khwarazmian dynasty", "Emirate of Bukhara": "Bokhara Khanate",
           "Kingdom of Pergamon": "Pergamon", "Kingdom of the Franks": "Franks", "French Algeria": "Algeria (FR)",
           "Grand Principality of Moscow": "Grand Duchy of Moscow", "British Cape Colony": "Cape Colony",
           "Zanzibar": "Sultanate of Zanzibar", "Tunis": "Tunisia", "United States": "United States of America",
           "New France": "Quebec"}
CLIP = box(60, 5, 150, 58)          # same window as tools/build_borders.py
TOL = 0.03                          # degrees
MIN_AREA = 0.02                     # square degrees


def year(k): return -int(k[2:]) if k.startswith("bc") else int(k)


def gap(y): return 100 if y < -1000 else 50 if y < 0 else 25 if y < 1500 else 20 if y < 1800 else 10


def fetch_hb(k):
    f = P("tools/.cache/hb", f"world_{k}.geojson")
    if not os.path.exists(f):
        os.makedirs(os.path.dirname(f), exist_ok=True)
        urllib.request.urlretrieve(HB.format(k), f)
    return json.load(open(f))


def fetch_clio():
    d = P("tools/.cache/clio")
    os.makedirs(d, exist_ok=True)
    found = glob.glob(os.path.join(d, "*.geojson"))
    if not found:
        z = os.path.join(d, "cliopatria.geojson.zip")
        if not os.path.exists(z): urllib.request.urlretrieve(CLIO, z)
        zipfile.ZipFile(z).extractall(d)
        found = glob.glob(os.path.join(d, "*.geojson"))
    return json.load(open(sorted(found)[-1]))


def colour(name):
    h = int(hashlib.md5(name.encode()).hexdigest()[:6], 16)
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, 0.42 + (h >> 9) % 12 / 100, 0.25 + (h >> 5) % 15 / 100)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


def known_zh():
    zh = {}
    for f in glob.glob(P("data/borders/*.geojson")) + glob.glob(P("data/borders/*.json")):
        d = json.load(open(f))
        for fc in ([d] if "features" in d else d.values()):
            for ft in fc.get("features", []):
                p = ft["properties"]
                if p.get("name") and p.get("name_zh"): zh.setdefault(p["name"], p["name_zh"])
    extra = P("data/world/names_zh.json")
    if os.path.exists(extra): zh.update(json.load(open(extra)))
    return zh


def dump(obj):
    return re.sub(r"(\d+\.\d{2})\d+", r"\1", json.dumps(obj, separators=(",", ":"), ensure_ascii=False))


def clean(geom):
    g = shape(geom).buffer(0).simplify(TOL, preserve_topology=True)
    return g if not g.is_empty and g.area >= MIN_AREA else None


def main():
    os.makedirs(P("data/world"), exist_ok=True)
    zh = known_zh()
    # Cliopatria polities (not groupings like "(Holy Roman Empire)" or alliances), as year ranges.
    clio = [f for f in fetch_clio()["features"]
            if f["properties"]["Type"] == "POLITY" and not f["properties"]["Name"].startswith("(") and f.get("geometry")]
    years = []
    for y in sorted({f["properties"]["FromYear"] for f in clio} | set(EXTRA)):
        if y < -3000: continue
        if not years or y - years[-1] >= gap(y) or y in EXTRA: years.append(y)
    # Names the app refers to (period focus lists, rulers and polity notes): keep them when the land matches.
    wanted = set()
    for r in json.load(open(P("data/regions.json")))["regions"]:
        for per in r.get("periods", []): wanted.update(per.get("focus") or [])
    for f in glob.glob(P("data/layers/world-*.json")):
        for L in json.load(open(f)).values():
            wanted.update((L.get("rulers") or {}).keys()); wanted.update((L.get("polities") or {}).keys())
    hb_years = [(year(k), k) for k in KEYS]
    hb_cache = {}

    def hb_at(y):
        k = max((hk for hy, hk in hb_years if hy <= y), key=year, default=KEYS[0])
        if k not in hb_cache:
            feats = []
            for ft in fetch_hb(k)["features"]:
                name = (ft["properties"].get("NAME") or "").strip()
                g = clean(ft["geometry"]) if ft.get("geometry") and name else None
                if g: feats.append((name, g))
            hb_cache[k] = feats
        return hb_cache[k]

    names, index, sources = {}, [], {}
    for y in years:
        hb = hb_at(y)
        tree = STRtree([g for _, g in hb])
        feats = []   # (name, geometry, wikipedia)
        for f in clio:
            p = f["properties"]
            if not (p["FromYear"] <= y <= p["ToYear"]) or p["Name"].strip() in ("", "?"): continue
            if "_g" not in f: f["_g"] = clean(f["geometry"])
            g = f["_g"]
            if not g: continue
            # Same land as a historical-basemaps feature: use its name (unless the app already uses this one).
            name = ALIASES.get(p["Name"], p["Name"])
            if name in wanted or p["Name"] in ALIASES:
                feats.append((name, g, p.get("Wikipedia") or "")); continue
            best, score = None, 0
            for i in tree.query(g):
                hname, hg = hb[i]
                inter = g.intersection(hg).area
                s = min(inter / g.area, inter / hg.area)
                if s > score: best, score = hname, s
            if best and (score >= 0.45 or score >= 0.25 and best in wanted): name = best
            feats.append((name, g, p.get("Wikipedia") or ""))
        # Land outside every Cliopatria polity keeps historical-basemaps' peoples and states.
        held = shapely.union_all([g for _, g, _ in feats]) if feats else None
        for hname, hg in hb:
            g = hg.difference(held) if held is not None else hg
            if g.is_empty or g.area < 0.3: continue
            feats.append((hname, g.simplify(TOL, preserve_topology=True), ""))
        # One feature per name.
        merged = {}
        for name, g, wiki in feats:
            m = merged.setdefault(name, [[], wiki])
            m[0].append(g)
        out = {False: [], True: []}
        for name, (gs, wiki) in merged.items():
            g0 = shapely.union_all(gs) if len(gs) > 1 else gs[0]
            names[name] = names.get(name, 0) + 1
            if wiki: sources.setdefault(name, wiki)
            for cut in (False, True):
                g = g0.difference(CLIP) if cut else g0
                if g.is_empty or g.area < MIN_AREA: continue
                g = shapely.set_precision(g, 0.001)
                if g.is_empty: continue
                c = g.representative_point()
                out[cut].append({"type": "Feature", "geometry": mapping(g), "properties": {
                    "name": name, "name_zh": zh.get(name, ""), "focus": False, "color": colour(name),
                    "area": round(g.area, 1), "label": [round(c.x, 2), round(c.y, 2)]}})
        open(P("data/world", f"{y}.json"), "w").write(dump({"type": "FeatureCollection", "features": out[False]}))
        outer = -2070 <= y <= 1912
        if outer: open(P("data/world", f"{y}-outer.json"), "w").write(dump({"type": "FeatureCollection", "features": out[True]}))
        index.append({"from": y, "full": f"data/world/{y}.json", **({"outer": f"data/world/{y}-outer.json"} if outer else {})})
        print(y, len(out[False]), flush=True)
    # Drop maps from an earlier build that are no longer listed.
    keep = {os.path.basename(x[k]) for x in index for k in ("full", "outer") if k in x}
    for f in glob.glob(P("data/world", "-*.json")) + glob.glob(P("data/world", "[0-9]*.json")):
        if os.path.basename(f) not in keep: os.remove(f)
    json.dump(index, open(P("data/world/index.json"), "w"), indent=1)
    json.dump({n: zh.get(n, "") for n in sorted(names)}, open(P("tools/.cache/world_names.json"), "w"), ensure_ascii=False, indent=1)
    json.dump(sources, open(P("tools/.cache/world_sources.json"), "w"), ensure_ascii=False, indent=1)
    print("maps", len(index), "names", len(names), "translated", sum(1 for n in names if zh.get(n)))


if __name__ == "__main__":
    main()
