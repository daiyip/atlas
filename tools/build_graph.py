"""The place graph's built part: data/graph/maps.jsonl (format: docs/places.md).

data/graph.json includes the hand-written files, data/graph/<group>.jsonl: areas a reader can follow through time (Taiwan, Xinjiang, 吐鲁番盆地 …) with their
outlines, introductions and notes, where each sits (`in` edges), and claims on disputed ones. This script adds what
the atlas's other files and maps already know, so nothing is kept twice (maps.jsonl is the last file graph.json includes):

  group, region nodes and their `in` edges   from data/regions.json
  polity nodes                               from the country table, data/lineages.json (`start`/`end`), and one
                                             for every other run of a name on the maps (by: "maps"; ids kept
                                             from the last build), so every name in every year means a polity
  map nodes and `name` edges                 each name on the border maps a country goes by, and when
  city nodes                                 from data/places.json, one per city (`names` over time)
  `held` edges                               who holds each area with an outline, from the maps

`held`: the script samples points inside each outline and, at every year the combined map changes (China's dynasty
maps with the world map around them, as the app shows them; combined_maps in build_countries.py), counts which name
holds each point (the smallest polygon holding it). Shares under MIN_SHARE are dropped; consecutive maps with the same
holders make one stretch, one edge per holder: area → map:<name>, `share` in percent. A share missing from 100 is land
no state held on the map. `span` gives the years the maps cover. Holders are only as good as the maps: rerun after
border changes, and after editing graph.json or lineages.json.

Usage: python3 tools/build_graph.py   (needs shapely; then python3 tools/check_graph.py)"""
import json
from shapely.geometry import Point, Polygon
from build_countries import combined_maps, in_poly, P
import re, unicodedata
import placegraph

OUT = "graph/maps.jsonl"

MIN_SHARE = 10   # percent
GRID = 140       # about this many sample points per area
TODAY = 2026


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


def samples(poly):
    g = Polygon(poly)
    x0, y0, x1, y1 = g.bounds
    step = (g.area / GRID) ** 0.5
    pts, y = [], y0 + step / 2
    while y < y1:
        x = x0 + step / 2
        while x < x1:
            if g.contains(Point(x, y)): pts.append(Point(x, y))
            x += step
        y += step
    return pts or [g.representative_point()]


def held(poly, maps, features, lo=None, hi=None):
    """[[from, to, [[name, name_zh, percent, colour], …]], …] for one outline in years lo..hi (None = no limit);
    name None = no state there."""
    pts = samples(poly)
    runs = []
    for a, b, key in maps:
        if a > TODAY or (hi is not None and a > hi): break
        b = min(b, TODAY)   # the last world map may be dated after today
        if lo is not None:
            if b < lo: continue
            a = max(a, lo)
        if hi is not None: b = min(b, hi)
        fs, tree = features(key)
        count = {}
        for pt in pts:
            best = None
            for i in tree.query(pt):
                p, g = fs[i]
                if p.get("name") and g.contains(pt) and (best is None or g.area < best[1].area): best = (p, g)
            k = (best[0]["name"], best[0].get("name_zh") or "", best[0].get("color") or "") if best else (None, "", "")
            count[k] = count.get(k, 0) + 1
        hold = sorted(([n, z, round(100 * v / len(pts)), c] for (n, z, c), v in count.items()), key=lambda h: -h[2])
        hold = [h for h in hold if h[2] >= MIN_SHARE] or hold[:1]
        names = [h[0] for h in hold]
        if runs and [h[0] for h in runs[-1][2]] == names and runs[-1][1] == a - 1:
            # Same holders: one stretch; the shares are the longer-lasting map's.
            if b - a > runs[-1][3]: runs[-1][2], runs[-1][3] = hold, b - a
            runs[-1][1] = b
        else:
            runs.append([a, b, hold, b - a])
    return [r[:3] for r in runs]


def main():
    G = placegraph.load(P("data/graph.json"), skip=(OUT,))
    R = json.load(open(P("data/regions.json")))
    lineages = json.load(open(P("data/lineages.json")))
    spans = json.load(open(P("data/countries.json")))["spans"]
    nodes, edges, maps_ = [], [], {}

    def map_node(name, zh="", color=""):
        n = maps_.setdefault(name, {"id": "map:" + name, "kind": "map", "name": name})
        zh = zh or next((s[2] for s in spans.get(name, []) if s[2]), "")
        if zh and not n.get("name_zh"): n["name_zh"] = zh
        if color and not n.get("color"): n["color"] = color
        return n["id"]

    for g in R.get("groups", []):
        nodes.append({"id": "group:" + g["id"], "kind": "group", "name": g["name"], "name_zh": g["name_zh"]})
    for r in R["regions"]:
        nodes.append({"id": "region:" + r["id"], "kind": "region", "name": r.get("short") or r["name"], "name_zh": r.get("short_zh") or r["name_zh"],
                      "geo": {"src": "regions.json#" + r["id"]}})
        g = next((g for g in R.get("groups", []) if r["id"] in g["regions"]), None)
        if g: edges.append({"child": "region:" + r["id"], "parent": "group:" + g["id"], "rel": "in", "by": "maps"})
    for L in lineages:
        nodes.append({"id": "polity:" + L["id"], "kind": "polity", "name": L["name"], "name_zh": L["name_zh"], "from": L.get("start"), "to": L.get("end")})
        for n in L["names"]:
            name, a, b = (n, L.get("start"), L.get("end")) if isinstance(n, str) else n
            if L.get("end") is None and b is not None and b >= TODAY: b = None
            edges.append({"child": map_node(name), "parent": "polity:" + L["id"], "rel": "name", "from": a, "to": b, "by": "maps"})

    # Every other run of a name on the maps is a country of its own (countries.json spans: one run, one country), so
    # any name in any year resolves to a polity id. Ids are kept from the last build: a run keeps the id of the old
    # run of the same name it overlaps most, so they stay put when maps shift a few years.
    old = {}
    try:
        for n in placegraph.load(P("data", OUT))["nodes"]:
            if n["kind"] == "polity" and n.get("by") == "maps": old.setdefault(n["name"], []).append(n)
    except (OSError, placegraph.GraphError, ValueError):
        pass
    covered = {}
    for e in edges:
        if e["rel"] == "name": covered.setdefault(e["child"][4:], []).append((e["from"] if e["from"] is not None else -1e9, e["to"] if e["to"] is not None else 1e9))
    ids = {n["id"] for n in nodes}
    yr = lambda y: f"bc{-y}" if y < 0 else str(y)
    auto = 0
    for name, runs in sorted(spans.items()):
        for a, b, zh, region in runs:
            b = min(b, TODAY)
            if a > TODAY: continue
            # The years of this run no country-table name covers.
            pieces = [(a, b)]
            for x, z in covered.get(name, []):
                pieces = [q for (c, d) in pieces for q in ([(c, d)] if z < c or x > d else [(c, x - 1)] * (c < x) + [(z + 1, d)] * (z < d))]
            for c, d in pieces:
                if c > d: continue
                prev = max((o for o in old.get(name, []) if o["id"] not in ids and o["from"] <= d and (o["to"] if o["to"] is not None else TODAY) >= c),
                           key=lambda o: min(d, o["to"] if o["to"] is not None else TODAY) - max(c, o["from"]), default=None)
                pid = prev["id"] if prev else f"polity:{slug(name)}-{yr(c)}"
                k = 2
                while pid in ids: pid, k = f"polity:{slug(name)}-{yr(c)}-{k}", k + 1
                ids.add(pid)
                nodes.append({"id": pid, "kind": "polity", "name": name, **({"name_zh": zh} if zh else {}), "from": c, "to": None if d >= TODAY else d, "by": "maps"})
                edges.append({"child": map_node(name), "parent": pid, "rel": "name", "from": c, "to": None if d >= TODAY else d, "by": "maps"})
                auto += 1
    print(auto, "polities from map names with no entry in the country table")

    maps, features = combined_maps()
    span = [maps[0][0], TODAY]
    for A in G["nodes"]:
        geo = A.get("geo") or {}
        # One outline, or one per span of years (geo.shapes) for an area whose extent changed.
        shapes = [{"poly": geo["poly"]}] if geo.get("poly") else [x for x in geo.get("shapes", []) if x.get("poly")]
        if A["kind"] != "area" or A.get("replacedBy") or not shapes: continue
        runs = [r for x in shapes for r in held(x["poly"], maps, features, x.get("from"), x.get("to"))]
        for a, b, hold in runs:
            for n, z, pct, c in hold:
                if n: edges.append({"child": A["id"], "parent": map_node(n, z, c), "rel": "held", "from": a, "to": b, "share": pct, "by": "maps"})
        print(f"{A['id']:24} {len(runs):4} stretches")

    # Cities (data/places.json, one entry per span of a city's history, ids <key>-<n>): one node per key, its names
    # over time in `names`, placed in the smallest area holding it, else its region. Events' `places` are these keys.
    areas = [A for A in G["nodes"] if A["kind"] == "area" and (A.get("geo") or {}).get("poly")]
    depth = {}
    up = {e["child"]: e["parent"] for e in G["edges"] if e["rel"] == "in"}
    for A in areas:
        d, x = 0, A["id"]
        while up.get(x, "").startswith("area:"): d, x = d + 1, up[x]
        depth[A["id"]] = d
    cities = {}
    for c in json.load(open(P("data/places.json"))):
        cities.setdefault(re.sub(r"-\d+$", "", c["id"]), []).append(c)
    for key, cs in sorted(cities.items()):
        cs.sort(key=lambda c: c["from"])
        last = cs[-1]
        # No from/to: a city outlives the spans the atlas tells (Xi'an after 1912); `names` carry the years.
        nodes.append({"id": "city:" + key, "kind": "city", "name": last.get("modern") or last["name"], "name_zh": last.get("modern_zh") or last["name_zh"],
                      "geo": {"point": [last["lon"], last["lat"]]},
                      "names": [{"from": c["from"], "to": c["to"], "name": c["name"], "name_zh": c["name_zh"], "rank": c.get("rank")} for c in cs]})
        inside = sorted((A for A in areas if in_poly(last["lon"], last["lat"], A["geo"]["poly"])), key=lambda A: -depth[A["id"]])
        par = inside[0]["id"] if inside else next(("region:" + r["id"] for r in R["regions"] if len(r.get("polygon") or []) > 2 and in_poly(last["lon"], last["lat"], r["polygon"])), None)
        if par: edges.append({"child": "city:" + key, "parent": par, "rel": "in", "by": "maps"})

    nodes += sorted(maps_.values(), key=lambda n: n["id"])
    note = "Built by tools/build_graph.py from data/regions.json, data/lineages.json, the border maps and the hand-written graph files; do not edit. Format: docs/places.md."
    placegraph.write_jsonl(P("data", OUT), nodes + edges, {"atlas": 2, "note": note, "span": span})
    print(len(nodes), "nodes,", len(edges), "edges")


if __name__ == "__main__":
    main()
