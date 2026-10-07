"""地区史: who held an area through time, from the atlas's own maps.

data/areas.json lists areas a reader can follow through history (Taiwan, Xinjiang, Alsace …): an outline, a short
introduction and notes for years when its status is contested (AI-drafted). This script samples points inside each
outline and, at every year the combined map changes (China's dynasty maps with the world map around them, as the app
shows them; see combined_maps in build_countries.py), counts which polity holds each point (the smallest polygon
holding it). Shares under MIN_SHARE are dropped; consecutive maps with the same holders make one run.

Written back into data/areas.json for each area:
  region   the region whose outline holds the area's centre (the timeline the app follows); a child area (`parent`,
           another area's id: 吐鲁番盆地 in 新疆) takes its parent's
  runs     [[from, to, [[name, name_zh, percent, colour], …]], …]; name null = no polity on the map there.
The holders are only as good as the maps: rerun after border changes.

Usage: python3 tools/build_areas.py   (needs shapely)"""
import json, os
from shapely.geometry import Point, Polygon
from build_countries import combined_maps, in_poly, P

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


def main():
    path = P("data/areas.json")
    D = json.load(open(path))
    regions = json.load(open(P("data/regions.json")))["regions"]
    maps, features = combined_maps()
    for A in D["areas"]:
        pts = samples(A["poly"])
        c = Polygon(A["poly"]).centroid
        # A child area (`parent`, another area's id) follows its parent's region.
        par = next((x for x in D["areas"] if x["id"] == A.get("parent")), None)
        A["region"] = par["region"] if par and par.get("region") else next((r["id"] for r in regions if len(r.get("polygon") or []) > 2 and in_poly(c.x, c.y, r["polygon"])), "china")
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
                # Same holders: one run; the shares are the longer-lasting map's.
                if b - a > runs[-1][3]: runs[-1][2], runs[-1][3] = hold, b - a
                runs[-1][1] = b
            else:
                runs.append([a, b, hold, b - a])
        # A run with no polity at all at the very start is kept (the island before 1624), as are the others.
        A["runs"] = [r[:3] for r in runs]
        print(f"{A['id']:16} {A['region']:20} {len(pts):4} points {len(A['runs']):4} runs")
    with open(path, "w", encoding="utf-8") as f:
        f.write('{"source":' + json.dumps(D["source"], ensure_ascii=False) + ',\n"areas":[\n')
        f.write(",\n".join(json.dumps(A, ensure_ascii=False, separators=(",", ":")) for A in D["areas"]))
        f.write("\n]}\n")


if __name__ == "__main__":
    main()
