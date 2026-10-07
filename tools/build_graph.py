"""The place graph's built part: data/graph/maps.jsonl (format: docs/places.md).

data/graph.json includes the hand-written files, data/graph/<group>.jsonl: areas a reader can follow through time (Taiwan, Xinjiang, 吐鲁番盆地 …) with their
outlines, introductions and notes, where each sits (`in` edges), and claims on disputed ones. This script adds what
the atlas's other files and maps already know, so nothing is kept twice (maps.jsonl is the last file graph.json includes):

  group, region nodes and their `in` edges   from data/regions.json
  polity nodes                               from the country table, data/lineages.json (`start`/`end`)
  map nodes and `name` edges                 each name on the border maps a country goes by, and when
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
from build_countries import combined_maps, P
import placegraph

OUT = "graph/maps.jsonl"

MIN_SHARE = 10   # percent
GRID = 140       # about this many sample points per area
TODAY = 2026


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


def held(area, maps, features):
    """[[from, to, [[name, name_zh, percent, colour], …]], …] for one outline; name None = no state there."""
    pts = samples(area["geo"]["poly"])
    runs = []
    for a, b, key in maps:
        if a > TODAY: break
        b = min(b, TODAY)   # the last world map may be dated after today
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

    maps, features = combined_maps()
    span = [maps[0][0], TODAY]
    for A in G["nodes"]:
        if A["kind"] != "area" or "poly" not in A.get("geo", {}): continue
        runs = held(A, maps, features)
        for a, b, hold in runs:
            for n, z, pct, c in hold:
                if n: edges.append({"child": A["id"], "parent": map_node(n, z, c), "rel": "held", "from": a, "to": b, "share": pct, "by": "maps"})
        print(f"{A['id']:24} {len(runs):4} stretches")

    nodes += sorted(maps_.values(), key=lambda n: n["id"])
    note = "Built by tools/build_graph.py from data/regions.json, data/lineages.json, the border maps and the hand-written graph files; do not edit. Format: docs/places.md."
    placegraph.write_jsonl(P("data", OUT), nodes + edges, {"atlas": 2, "note": note, "span": span})
    print(len(nodes), "nodes,", len(edges), "edges")


if __name__ == "__main__":
    main()
