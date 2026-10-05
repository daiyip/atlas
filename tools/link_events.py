"""Fill each event's `places` (city ids from data/places.json), `people` (person ids from data/layers) and `states`
(polity keys of its period, as in data/layers/<era>.json `polities`) so city and person cards can list their events
and the event list can be filtered by country.

Usage: python3 tools/link_events.py          fills events that have no `places` / `people` field yet
       python3 tools/link_events.py --all    recomputes every event (run after adding cities or people)
Fields you set by hand are kept unless you pass --all; to pin a hand-made list against --all, add `"linked": "hand"`.

A city id is a places.json id without its "-N" suffix (all names of one city share it). An event goes to the nearest
city within ~35 km, or within ~100 km to a city its place names. A person is linked when their Chinese name appears
in the event's title, summary or story cast (data/details) and the event falls between 10 years before their birth
and 50 years after their death, so namesakes in other periods are not picked up. A country is linked when the event lies inside its border on the
period's map at that year, or when its Chinese name appears in the title or summary (after common words such as
时代 or 清楚 are blanked out) while it has rulers."""
import glob, json, math, os, re, sys
from shapely.geometry import Point, shape

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
P = lambda *a: os.path.join(ROOT, *a)
ALL = "--all" in sys.argv

events = json.load(open(P("data/events.json")))
details = {}
for f in glob.glob(P("data/details/*.json")):
    details.update(json.load(open(f)))

cities = {}
for c in json.load(open(P("data/places.json"))):
    k = re.sub(r"-\d+$", "", c["id"])
    x = cities.setdefault(k, {"lon": c["lon"], "lat": c["lat"], "names": set()})
    x["names"].update(n for n in (c["name_zh"], c.get("modern_zh")) if n and len(n) > 1)

people = {}
for f in glob.glob(P("data/layers/*.json")):
    for p in json.load(open(f)).get("people", []):
        if p.get("died") is None: continue
        people[p["id"]] = (p["name_zh"], (p["born"] if p.get("born") is not None else p["died"] - 70) - 10, p["died"] + 50)

eras = json.load(open(P("data/eras.json")))["eras"]
def era_of(y):
    return next((e for e in eras if e["start"] <= y <= e["end"]), eras[-1] if y > 0 else eras[0])
_maps, _layers = {}, {}
def load_borders(path):
    """A border file, or one map of a bundle when the path ends in #<id> (see tools/carve_states.py)."""
    f, _, key = path.partition("#")
    d = json.load(open(P(f)))
    return d[key] if key else d
def borders(path):
    if path not in _maps:
        _maps[path] = [(f["properties"]["name"], shape(f["geometry"])) for f in load_borders(path)["features"] if f.get("geometry")]
    return _maps[path]
def layer(era):
    if era["id"] not in _layers: _layers[era["id"]] = json.load(open(P(f"data/layers/{era['id']}.json")))
    return _layers[era["id"]]
# Words that contain a one-character country name without meaning the country.
COMMON = re.compile("时代|取代|一代|代替|世代|代表|历代|后代|朝代|代价|代理|年代|交代|近代|古代|当代|现代|代之|周围|周边|周年|周密|周全|四周|一周|"
                    "晋升|晋见|清楚|苦楚|整齐|一齐|齐心|齐备|护卫|卫兵|侍卫|禁卫|卫士|卫所|保卫|守卫|越过|超越|越来越|逾越|越发|"
                    "汉人|汉字|汉族|汉化|汉语|汉文|汉地|胡汉|蕃汉|汉军|汉奸|汉学|鲁莽|燕京|燕云|吴语|新罗")
def states_of(ev):
    era = era_of(ev["year"]); L = layer(era); pol = L.get("polities", {})
    snap = [s for s in era.get("snapshots", []) if s["from"] <= ev["year"]] or era.get("snapshots", [])[:1]
    out = set()
    if snap:
        pt = Point(ev["lon"], ev["lat"])
        out.update(n for n, g in borders(snap[-1]["borders"]) if n in pol and g.contains(pt))
    text = COMMON.sub("　", ev.get("title_zh", "") + ev.get("summary_zh", ""))
    for k, v in pol.items():
        n = v.get("name_zh", "")
        rs = L.get("rulers", {}).get(k, [])
        alive = not rs or min(r["from"] for r in rs) - 5 <= ev["year"] <= max(r["to"] for r in rs) + 5
        # Long names like "安西 · 北庭都护府" match on any part.
        if alive and any(len(x) and x in text for x in re.split(r"\s*·\s*", n)): out.add(k)
    return sorted(out)

def city_of(ev):
    best, score = None, math.inf
    for k, c in cities.items():
        d = math.hypot((ev["lon"] - c["lon"]) * math.cos(math.radians(c["lat"])), ev["lat"] - c["lat"])
        named = d < 1 and any(n in (ev.get("place_zh") or "") for n in c["names"])
        s = d - (1 if named else 0)
        if (d < 0.35 or named) and s < score: best, score = k, s
    return [best] if best else []

def people_of(ev):
    text = ev.get("title_zh", "") + ev.get("summary_zh", "")
    cast = {x.get("name_zh") for x in details.get(ev["id"], {}).get("people", [])}
    return sorted(i for i, (n, a, b) in people.items() if a <= ev["year"] <= b and (n in text or n in cast))

n = 0
for ev in events:
    if ev.get("linked") == "hand": continue
    if ev.get("region", "china") != "china": continue  # cities, people and maps are China's only
    if ALL or "places" not in ev: ev["places"] = city_of(ev); n += 1
    if ALL or "people" not in ev: ev["people"] = people_of(ev)
    # After the last dynasty map (1912) the world maps hold China; tools/build_countries.py tags those events.
    if ev["year"] > eras[-1]["end"]: continue
    if ALL or "states" not in ev: ev["states"] = states_of(ev)
json.dump(events, open(P("data/events.json"), "w"), ensure_ascii=False, indent=1)
print(n, "events linked;", sum(bool(e["places"]) for e in events), "with a city,",
      sum(bool(e["people"]) for e in events), "with people,", sum(len(e["people"]) for e in events), "person links,",
      sum(len(e["states"]) > 1 for e in events), "with several countries")
