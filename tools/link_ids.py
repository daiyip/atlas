"""Point events, people, reigns and capitals at countries by id (docs/places.md), not by the names on the maps.

Names on the border maps change whenever the maps are rebuilt; place graph ids don't. This script reads the graph
(data/graph.json, after tools/build_graph.py) and writes, next to the names, which stay for display and for older
readers:

  events     `polities`: the ids of their `states`, in the event's year
  people     `polities`: the ids of their `states`, in their working years (as build_countries.py dates them)
  reigns     `polities`: the id of the map name they are filed under, in their first year (or, when the name is
             not on the maps then, its nearest years)
  capitals   `polities`: the id of the polity holding the capital in its first year (capitals' `polity` is a short
             label, not a map name)

A name the graph cannot place in that year (not on the maps then) is left out. Rerun after build_graph.py.
Usage: python3 tools/link_ids.py"""
import glob, json, os
from shapely.geometry import Point
from build_countries import combined_maps, P
import placegraph


def main():
    G = placegraph.load(P("data/graph.json"))
    names = {}
    for e in G["edges"]:
        if e["rel"] == "name": names.setdefault(e["child"][4:], []).append(e)

    def pid(name, y):
        for e in names.get(name, []):
            if (e.get("from") is None or e["from"] <= y) and (e.get("to") is None or y <= e["to"]): return e["parent"]
        return None

    def near(name, y):
        """For a reign filed under a name: the polity of that name nearest in time when it is not on the maps then."""
        best = None
        for e in names.get(name, []):
            a = e["from"] if e.get("from") is not None else -1e9
            b = e["to"] if e.get("to") is not None else 1e9
            d = 0 if a <= y <= b else min(abs(y - a), abs(y - b))
            if best is None or d < best[0]: best = (d, e["parent"])
        return [best[1]] if best else []

    def ids(ns, y):
        out = []
        for n in ns or []:
            i = pid(n, y)
            if i and i not in out: out.append(i)
        return out

    def put(x, v):
        if v and x.get("polities") != v: x["polities"] = v; return 1
        if not v and "polities" in x: del x["polities"]; return 1
        return 0

    events = json.load(open(P("data/events.json")))
    n = sum(put(ev, ids(ev.get("states"), ev["year"])) for ev in events)
    json.dump(events, open(P("data/events.json"), "w"), ensure_ascii=False, indent=1)
    print("events changed:", n, "of", len(events), "| with polities:", sum(1 for ev in events if ev.get("polities")))

    maps, features = combined_maps()

    def holder(lon, lat, y):
        fs = None
        for a, b, key in maps:
            if a <= y <= b: fs, tree = features(key); break
        if fs is None: return None
        pt, best = Point(lon, lat), None
        for i in tree.query(pt):
            p, g = fs[i]
            if p.get("name") and g.contains(pt) and (best is None or g.area < best[1].area): best = (p["name"], g)
        return best and best[0]

    counts = {"people": 0, "reigns": 0, "capitals": 0}
    for f in sorted(glob.glob(P("data/layers/*.json"))):
        D = json.load(open(f))
        bundles = D.values() if os.path.basename(f).startswith("world-") else [D]
        ch = 0
        for L in bundles:
            for p in L.get("people") or []:
                b, d = p.get("born"), p.get("died")
                y = min(d, b + 40) if b is not None and d is not None else b + 30 if b is not None else d - 10 if d is not None else None
                if y is not None: c = put(p, ids(p.get("states"), y)); ch += c; counts["people"] += c
            for k, rs in (L.get("rulers") or {}).items():
                for r in rs: c = put(r, ids([k], r["from"]) or near(k, r["from"])); ch += c; counts["reigns"] += c
            for cap in L.get("capitals") or []:
                h = holder(cap["lon"], cap["lat"], cap["from"])
                c = put(cap, ids([h], cap["from"]) if h else []); ch += c; counts["capitals"] += c
        if ch:
            with open(f, "w", encoding="utf-8") as fh: json.dump(D, fh, ensure_ascii=False, separators=(",", ":"))
    print("changed:", counts)


if __name__ == "__main__":
    main()
