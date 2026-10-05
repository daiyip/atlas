"""Countries: when each state on the maps exists, and which events and people belong to it.

The app lets a reader select one country (click it on the map, or pick it in the 世界 tab) and narrows the events,
rulers and people to it. This script prepares the data for that:

1. data/countries.json `spans`: for every polity name on the maps (China's dynasty maps inside 前2070–1912, the world
   maps elsewhere, as the app combines them), the runs of years it is on the map: [[from, to, name_zh, region], ...].
   A run is one country; the same name far apart in time (the Jin state of 春秋 and the Jin dynasty) or under another
   Chinese name (Jin 晋, Jin 金) is two.
   `lineages` is copied from data/lineages.json: countries that change name on the maps but are one country to a
   reader (Wessex → England → Great Britain → United Kingdom); each lists its names in order.
2. Events with no `states` (or states this script set, `statesBy: "geo"`) get the polity whose land holds the
   event's place in its year, plus polities of that year that the title or summary names. China's events keep the
   states tools/link_events.py gave them.
3. Every person gets `states`: the polity holding their home in their working years, plus the states of the events
   that list them.

Usage: python3 tools/build_countries.py   (needs shapely)"""
import glob, json, os, re
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
P = lambda *a: os.path.join(ROOT, *a)
END = 2026


def load(path):
    path, _, part = path.partition("#")
    d = json.load(open(P(path)))
    return d[part] if part else d


def in_poly(x, y, poly):
    inside, j = False, len(poly) - 1
    for i in range(len(poly)):
        (xi, yi), (xj, yj) = poly[i], poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: inside = not inside
        j = i
    return inside


def main():
    eras = json.load(open(P("data/eras.json")))["eras"]
    world = json.load(open(P("data/world/index.json")))
    regions = json.load(open(P("data/regions.json")))["regions"]
    china = [e for e in eras if not e.get("worldMaps")]
    cstart, cend = min(e["start"] for e in china), max(e["end"] for e in china)

    # The years at which the combined map changes, and what it is made of then (as bordersKey in app.js).
    def china_at(y):
        for e in china:
            if e["start"] <= y <= e["end"]:
                snap = e["snapshots"][0]
                for s in e["snapshots"]:
                    if y >= s["from"]: snap = s
                return snap["borders"]
        return None

    def world_at(y):
        w = world[0]
        for x in world:
            if y >= x["from"]: w = x
        return w

    cuts = sorted({world[0]["from"], END + 1} | {x["from"] for x in world} | {s["from"] for e in china for s in e["snapshots"]} |
                  {e["start"] for e in china} | {e["end"] + 1 for e in china})
    cuts = [c for c in cuts if c >= world[0]["from"]]
    maps, cache = [], {}
    for a, b in zip(cuts, cuts[1:]):
        c = china_at(a)
        w = world_at(a)
        key = (c, w.get("outer") if c else w["full"])
        if maps and maps[-1][2] == key: maps[-1][1] = b - 1; continue
        maps.append([a, b - 1, key])

    def features(key):
        if key not in cache:
            fs = []
            for path in key:
                if not path: continue
                for f in load(path)["features"]:
                    if f.get("geometry"): fs.append((f["properties"], shape(f["geometry"]).buffer(0)))
            cache[key] = (fs, STRtree([g for _, g in fs]))
        return cache[key]

    def region_of(pt):
        if not pt: return ""
        x = ((pt[0] + 180) % 360) - 180
        for r in regions:
            if len(r.get("polygon") or []) > 2 and in_poly(x, pt[1], r["polygon"]): return r["id"]
        return ""

    # 1. Spans.
    spans = {}
    for a, b, key in maps:
        fs, _ = features(key)
        done = set()
        for p, g in fs:
            n = p.get("name")
            # A name can be on both the dynasty map and the world map around it: one run.
            if not n or n in done: continue
            done.add(n)
            runs = spans.setdefault(n, [])
            # A run continues while the name stays on the map under the same Chinese name (Jin 晋 and Jin 金 differ).
            if runs and runs[-1][1] == a - 1 and (not runs[-1][2] or not p.get("name_zh") or runs[-1][2] == p["name_zh"]):
                runs[-1][1] = b
                runs[-1][2] = runs[-1][2] or p.get("name_zh") or ""
            else:
                runs.append([a, b, p.get("name_zh") or "", region_of(p.get("label"))])
    lineages = json.load(open(P("data/lineages.json"))) if os.path.exists(P("data/lineages.json")) else []
    for L in lineages:
        # A name is "Name", or ["Name", from, to] when only some of its years belong to this country.
        miss = [n for n in (x[0] if isinstance(x, list) else x for x in L["names"]) if n not in spans]
        if miss: print("lineage", L["id"], "names not on any map:", miss)
    json.dump({"spans": spans, "lineages": lineages}, open(P("data/countries.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    print("countries:", len(spans), "names,", sum(len(r) for r in spans.values()), "runs")

    def map_at(y):
        for a, b, key in maps:
            if a <= y <= b: return features(key)
        return features(maps[0][2] if y < maps[0][0] else maps[-1][2])

    def holder(lon, lat, y):
        fs, tree = map_at(y)
        pt = Point(lon, lat)
        best = None
        for i in tree.query(pt.buffer(0.6)):
            p, g = fs[i]
            if not p.get("name"): continue
            d = g.distance(pt)
            if d == 0 and (best is None or best[0] > 0 or g.area < best[2]): best = (0, p["name"], g.area)
            elif d > 0 and d < 0.6 and (best is None or d < best[0]): best = (d, p["name"], g.area)
        return best[1] if best else None

    # 2. Events.
    events = json.load(open(P("data/events.json")))
    word = {}
    n_ev = 0
    for ev in events:
        if ev.get("states") and ev.get("statesBy") != "geo": continue
        y = ev["year"]
        found = []
        h = holder(ev["lon"], ev["lat"], y)
        if h: found.append(h)
        fs, _ = map_at(y)
        text = f"{ev.get('title', '')} {ev.get('summary', '')}"
        text_zh = f"{ev.get('title_zh', '')} {ev.get('summary_zh', '')}"
        for p, _ in fs:
            n = p.get("name")
            if not n or n in found or len(n) < 4: continue
            if n not in word: word[n] = re.compile(r"(?<![\w-])" + re.escape(n) + r"(?![\w-])")
            zh = p.get("name_zh") or ""
            if word[n].search(text) or (len(zh) >= 2 and zh in text_zh): found.append(n)
        if found:
            ev["states"], ev["statesBy"] = found[:4], "geo"
            n_ev += 1
    json.dump(events, open(P("data/events.json"), "w"), ensure_ascii=False, indent=1)
    print("events linked:", n_ev)

    # 3. People.
    by_person = {}
    for ev in events:
        for pid in ev.get("people") or []:
            by_person.setdefault(pid, []).extend(ev.get("states") or [])
    n_p = 0
    for f in sorted(glob.glob(P("data/layers/*.json"))):
        D = json.load(open(f))
        bundles = D.values() if os.path.basename(f).startswith("world-") else [D]
        changed = False
        for L in bundles:
            for p in L.get("people") or []:
                if p.get("lat") is None: continue
                b, d = p.get("born"), p.get("died")
                y = min(d, b + 40) if b is not None and d is not None else b + 30 if b is not None else d - 10 if d is not None else None
                if y is None: continue
                st = []
                h = holder(p["lon"], p["lat"], y)
                if h: st.append(h)
                for s in by_person.get(p.get("id"), []):
                    if s not in st: st.append(s)
                if st != p.get("states"):
                    p["states"] = st[:6]
                    changed = True
                n_p += 1
        if changed:
            json.dump(D, open(f, "w"), ensure_ascii=False, separators=(",", ":"))
    print("people linked:", n_p)


if __name__ == "__main__":
    main()
