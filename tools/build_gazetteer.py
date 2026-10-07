"""Build data/gazetteer.json, the 地名古今 table: for every city and every 政区 seat, what the place was called and
who held it in each China period, down to its modern name.

    python3 tools/build_gazetteer.py        (after build_cities.py, build_admin.py and build_admin_areas.py)

A site is one city (all places sharing a city id, xian-0…6) with the seats within SEAT_NEAR of it, or a group of
seats within ADMIN_NEAR of each other that no city claims. For each period a row gives
  - the names in use there: the city's names whose years overlap the period, and the seats placed there;
  - the holder at each of the period's border maps (the smallest polygon holding the point), repeats dropped;
  - the 郡/州/府 it belonged to when it was not a seat itself (the admin-areas sketch holding the point).
Row: [period index, year to jump to, city name ids, seat name ids, [[year, holder name id]…], unit name ids?],
names are [zh, en] pairs in `names`. Everything is derived from the atlas's own drafted data, so it is as approximate as the maps and seats.
Needs shapely.
"""
import json, os
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEAT_NEAR = 0.12    # degrees: a seat this close to a city is the city
ADMIN_NEAR = 0.08   # degrees: seats this close to each other are one site


def load(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return json.load(f)


def short(s):
    # "定难军 (党项)" -> "定难军"
    return s.split(" (")[0].split("（")[0].strip()


def main():
    eras = load("data/eras.json")["eras"]
    places = load("data/places.json")
    admin = load("data/admin.json")
    F = admin["fields"]
    seats = [dict(zip(F, r), i=i) for i, r in enumerate(admin["items"])]
    areas = {f["properties"]["i"]: shape(f["geometry"]) for f in load("data/admin-areas.json")["features"]}

    names, name_ix = [], {}

    def nm(zh, en):
        k = zh or en
        if k not in name_ix:
            name_ix[k] = len(names)
            names.append([k, en or zh])
        return name_ix[k]

    # ---- sites ----
    cities = {}
    for p in places:
        cities.setdefault(p["id"].rsplit("-", 1)[0], []).append(p)
    sites = [{"city": cid, "segs": sorted(ps, key=lambda p: p["from"]), "seats": []} for cid, ps in cities.items()]
    loose = []
    for s in seats:
        best, bd = None, SEAT_NEAR
        for site in sites:
            for p in site["segs"]:
                d = max(abs(p["lon"] - s["lon"]), abs(p["lat"] - s["lat"]))
                if d < bd:
                    best, bd = site, d
        if best:
            best["seats"].append(s)
        else:
            loose.append(s)
    # union-find over the remaining seats
    parent = list(range(len(loose)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    order = sorted(range(len(loose)), key=lambda k: loose[k]["lon"])
    for n, a in enumerate(order):
        for b in order[n + 1:]:
            if loose[b]["lon"] - loose[a]["lon"] > ADMIN_NEAR:
                break
            if abs(loose[b]["lat"] - loose[a]["lat"]) < ADMIN_NEAR:
                parent[find(a)] = find(b)
    groups = {}
    for k in range(len(loose)):
        groups.setdefault(find(k), []).append(loose[k])
    for g in groups.values():
        sites.append({"city": None, "segs": [], "seats": sorted(g, key=lambda s: s["snap"])})

    # ---- border maps, cached ----
    cache = {}

    def borders(ref):
        if ref not in cache:
            path, _, key = ref.partition("#")
            d = load(path)
            d = d[key] if key else d
            feats = [(f["properties"], shape(f["geometry"]).buffer(0)) for f in d["features"]]
            cache[ref] = (STRtree([g for _, g in feats]), feats)
        return cache[ref]

    def holder(ref, pt):
        tree, feats = borders(ref)
        hits = [feats[i] for i in tree.query(pt) if feats[i][1].contains(pt)]
        if not hits:
            return None
        pr = min(hits, key=lambda h: h[1].area)[0]
        return nm(short(pr.get("name_zh") or pr.get("name") or ""), short(pr.get("name") or ""))

    era_areas = {}
    for s in seats:
        if s["i"] in areas and s["from"] <= s["snap"] <= (s["to"] if s["to"] is not None else 9999):
            era_areas.setdefault(s["era"], []).append((s, areas[s["i"]]))
    era_areas = {k: (STRtree([g for _, g in v]), v) for k, v in era_areas.items()}

    out = []
    for site in sites:
        segs, ss = site["segs"], site["seats"]
        base = segs[0] if segs else ss[0]
        rows = []
        for ei, e in enumerate(eras):
            lo, hi = e["start"], e["end"]
            cseg = [p for p in segs if p["from"] <= hi and p["to"] >= lo]
            sseg = sorted([s for s in ss if s["era"] == e["id"]], key=lambda s: s["snap"])
            ref_pt = cseg[0] if cseg else sseg[0] if sseg else base
            pt = Point(ref_pt["lon"], ref_pt["lat"])
            here = list(dict.fromkeys(nm(p["name_zh"], p["name"]) for p in cseg))
            seated = list(dict.fromkeys(nm(s["name_zh"], s["name"]) for s in sseg))
            hold = []
            for snap in e["snapshots"]:
                y = max(snap["from"], lo)
                if y > hi:
                    continue
                h = holder(snap["borders"], pt)
                if h is not None and (not hold or hold[-1][1] != h):
                    hold.append([y, h])
            # the 郡/州 it belonged to, from the seat areas of this period's snapshots
            seat_snaps = {s["snap"] for s in sseg}
            units = []
            if e["id"] in era_areas:
                tree, lst = era_areas[e["id"]]
                for k in tree.query(pt):
                    s, g = lst[k]
                    if s["snap"] not in seat_snaps and g.contains(pt):
                        units.append((s["snap"], nm(s["name_zh"], s["name"])))
            units = list(dict.fromkeys(u for _, u in sorted(units)))
            if not (here or seated or hold or units):
                continue
            year = min([p["from"] for p in cseg if p["from"] >= lo] + [s["snap"] for s in sseg] + [hi]) if (cseg or sseg) else lo
            year = max(lo, min(hi, year if (cseg or sseg) else lo))
            row = [ei, year, here, seated, hold]
            if units:
                row.append(units)
            rows.append(row)
        # a place only ever outside every border map (far west before the Han…) and never named isn't worth a site
        if not any(r[2] or r[3] for r in rows):
            continue
        modern = [(p.get("modern_zh"), p.get("modern")) for p in segs] + [(s.get("modern_zh"), None) for s in ss]
        mz = next((m for m, _ in modern[::-1] if m), "")
        me = next((m for _, m in modern[::-1] if m), "")
        o = {"lon": round(base["lon"], 3), "lat": round(base["lat"], 3), "now": [mz.removeprefix("今"), me], "rows": rows}
        if site["city"]:
            o["city"] = site["city"]
        if ss:
            o["adm"] = [s["i"] for s in ss]
        out.append(o)
    doc = {"source": "Derived from the atlas's own places, 政区 seats and border maps (all AI-drafted); approximate.",
           "eras": [e["id"] for e in eras], "names": names, "sites": out}
    p = os.path.join(ROOT, "data/gazetteer.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(len(out), "sites,", len(names), "names,", os.path.getsize(p) // 1024, "KB")


if __name__ == "__main__":
    main()
