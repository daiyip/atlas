"""Build data/admin-areas.json, rough areas for the 政区 seats in data/admin.json (run tools/build_admin.py first).

    python3 tools/build_admin_areas.py

Each snapshot's seats split their dynasty's land between them by nearest seat (a Voronoi diagram), clipped to the
period's own border map at the snapshot year (to the seat's own state where the map draws several, as 魏/蜀/吴),
to land, and to at most RADIUS degrees from the seat so thinly held frontiers don't become huge cells. These are
sketches, not historical boundaries: real prefectures followed rivers, ridges and older county lines.
Needs shapely and scipy.
"""
import json, math, os
import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import shape, mapping, Polygon, Point, box
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RADIUS = 2.2      # degrees, cap around a seat
SIMPLIFY = 0.02   # degrees


def load(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return json.load(f)


def borders_at(era, year):
    snaps = [s for s in era.get("snapshots", []) if s["from"] <= year] or era.get("snapshots", [])[:1]
    ref = snaps[-1]["borders"]
    path, _, key = ref.partition("#")
    d = load(path)
    return d[key] if key else d


def main():
    admin = load("data/admin.json")
    F = {k: i for i, k in enumerate(admin["fields"])}
    eras = load("data/eras.json")
    eras = {e["id"]: e for e in (eras if isinstance(eras, list) else eras["eras"])}
    land = unary_union([shape(f["geometry"]).buffer(0) for f in load("data/geo/land.geojson")["features"]])
    groups = {}
    for i, x in enumerate(admin["items"]):
        groups.setdefault((x[F["era"]], x[F["snap"]]), []).append(i)
    out = []
    for (era_id, snap), idx in sorted(groups.items(), key=lambda g: g[0][1]):
        focus = [f for f in borders_at(eras[era_id], snap)["features"] if f["properties"].get("focus")]
        geoms = [(f["properties"].get("name_zh") or "", shape(f["geometry"]).buffer(0)) for f in focus]
        realm = unary_union([g for _, g in geoms])
        # only seats standing in the snapshot year share out the land; others get a plain circle-ish cap
        live = [i for i in idx if admin["items"][i][F["from"]] <= snap <= (admin["items"][i][F["to"]] if admin["items"][i][F["to"]] is not None else 9999)]
        k = math.cos(math.radians(32))
        pts = np.array([[admin["items"][i][F["lon"]] * k, admin["items"][i][F["lat"]]] for i in live])
        # far-away dummy points close every cell
        pts_all = np.vstack([pts, [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]]])
        vor = Voronoi(pts_all)
        for n, i in enumerate(live):
            x = admin["items"][i]
            reg = vor.regions[vor.point_region[n]]
            if -1 in reg or not reg:
                continue
            cell = Polygon([(vor.vertices[v][0] / k, vor.vertices[v][1]) for v in reg]).buffer(0)
            mask = realm
            st = x[F["state"]]
            if st:
                mine = [g for nm, g in geoms if nm.startswith(st)]
                if mine:
                    mask = unary_union(mine)
            seat = Point(x[F["lon"]], x[F["lat"]])
            cap = seat.buffer(RADIUS)
            a = cell.intersection(cap).intersection(land)
            clipped = a.intersection(mask)
            # a seat just outside the drawn border (rough maps) keeps its unclipped cell rather than vanishing
            a = clipped if clipped.area > 0.02 or not a.area else a
            if a.is_empty:
                continue
            a = a.simplify(SIMPLIFY, preserve_topology=True)
            if a.geom_type == "GeometryCollection":   # stray lines/points from clipping
                a = unary_union([p for p in a.geoms if p.geom_type in ("Polygon", "MultiPolygon")])
            if a.geom_type == "MultiPolygon":   # keep the piece holding the seat plus any big islands
                a = unary_union([p for p in a.geoms if p.distance(seat) < 0.05 or p.area > 0.3])
            if a.is_empty or a.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            g = mapping(a)
            r = lambda c: [round(c[0], 3), round(c[1], 3)]
            if g["type"] == "Polygon":
                g = {"type": "Polygon", "coordinates": [[r(c) for c in ring] for ring in g["coordinates"]]}
            else:
                g = {"type": "MultiPolygon", "coordinates": [[[r(c) for c in ring] for ring in poly] for poly in g["coordinates"]]}
            out.append({"type": "Feature", "properties": {"i": i}, "geometry": g})
    p = os.path.join(ROOT, "data/admin-areas.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "source": "Sketch: nearest-seat areas clipped to the period map; not historical boundaries.",
                   "features": out}, f, ensure_ascii=False, separators=(",", ":"))
    print(len(out), "areas", os.path.getsize(p) // 1024, "KB")


if __name__ == "__main__":
    main()
