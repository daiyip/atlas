#!/usr/bin/env python3
"""Checks Atlas data against the data format (docs/custom-data.md, docs/plugins.md).

    python3 tools/validate.py                          # the atlas's own data/
    python3 tools/validate.py examples/demo-pack       # a data pack (its folder or its manifest.json)
    python3 tools/validate.py data examples/*-pack     # several at once

Errors are things the atlas would refuse or show wrongly (a missing id, a year that isn't a number, a pack in a
newer format than this atlas reads, a tour step pointing at an event that doesn't exist). Warnings are worth a look
but don't break anything. Exits 1 if there is any error. Needs only Python 3, no packages.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ID = re.compile(r"^[a-z0-9-]+$")
CATS = {"war", "politics", "reform", "rebellion", "diplomacy", "economy", "culture", "science", "society"}
AUTO_LAYERS = {"rulers", "people", "armies", "routes", "exchange", "spread", "passes", "roads", "walls", "clans", "admin",
               "capitals", "faith", "inventions"}
LAYER_TYPES = {"fill", "line", "circle"}


def app_format():
    """FORMAT in app.js: the newest data format this checkout of the atlas reads."""
    m = re.search(r"^const FORMAT = (\d+);", (ROOT / "app.js").read_text(encoding="utf-8"), re.M)
    return int(m.group(1)) if m else 1


FORMAT = app_format()


class Report:
    def __init__(self, name):
        self.name, self.errors, self.warnings = name, [], []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"{where}: {msg}")

    def print(self, limit=40):
        status = "ok" if not self.errors else f"{len(self.errors)} error(s)"
        print(f"{self.name}: {status}, {len(self.warnings)} warning(s)")
        for kind, items in (("error", self.errors), ("warning", self.warnings)):
            for line in items[:limit]:
                print(f"  {kind}: {line}")
            if len(items) > limit:
                print(f"  … {len(items) - limit} more {kind}s")


def load(path, rep, where):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        rep.err(where, f"file not found: {path}")
    except json.JSONDecodeError as e:
        rep.err(where, f"not valid JSON ({e})")
    return None


def is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def is_lonlat(p):
    return isinstance(p, list) and len(p) >= 2 and is_num(p[0]) and is_num(p[1]) and -180 <= p[0] <= 180 and -90 <= p[1] <= 90


def text(rep, where, obj, key, required=True):
    """A text pair: `key` (English) and `key_zh` (Chinese); the English one is the fallback."""
    v = obj.get(key)
    if v is None:
        if required:
            (rep.err if not obj.get(key + "_zh") else rep.warn)(where, f"no `{key}`")
    elif not isinstance(v, str):
        rep.err(where, f"`{key}` should be text")
    if key + "_zh" in obj and not isinstance(obj[key + "_zh"], str):
        rep.err(where, f"`{key}_zh` should be text")


def check_format(rep, where, obj):
    n = obj.get("atlas", 1)
    if not is_int(n) or n < 1:
        rep.err(where, f"`atlas` should be a whole number from 1, not {n!r}")
    elif n > FORMAT:
        rep.err(where, f"needs data format {n}, but this atlas reads up to {FORMAT}")


def check_ids(rep, where, items):
    seen = set()
    for i, x in enumerate(items):
        xid = x.get("id") if isinstance(x, dict) else None
        if not isinstance(xid, str) or not xid:
            rep.err(f"{where}[{i}]", "no `id`")
        elif xid in seen:
            rep.err(f"{where}[{i}]", f"id `{xid}` is used twice")
        else:
            seen.add(xid)
    return seen


def check_layer_keys(rep, where, x):
    if "layers" in x:
        L = x["layers"]
        if not isinstance(L, list):
            rep.err(where, "`layers` should be a list")
        else:
            for k in L:
                if k not in AUTO_LAYERS:
                    rep.warn(where, f"`layers` has unknown key {k!r}")


def check_periods(rep, where, eras, rng=None, contiguous=True, named=True):
    """Periods: id, name, start < end; in order and touching when `contiguous`."""
    ids = check_ids(rep, where, eras)
    prev = None
    for i, e in enumerate(eras):
        w = f"{where}[{i}] {e.get('id', '')}".strip()
        if named:
            text(rep, w, e, "name")
        s, t = e.get("start"), e.get("end")
        if not is_int(s) or not is_int(t):
            rep.err(w, "`start` and `end` should be whole years")
            prev = None
            continue
        if s >= t:
            rep.err(w, f"starts ({s}) at or after it ends ({t})")
        if rng and is_int(rng.get("start")) and is_int(rng.get("end")) and (s < rng["start"] or t > rng["end"]):
            rep.warn(w, f"{s}..{t} is outside the range {rng['start']}..{rng['end']}")
        # Years are inclusive: a period ending in 1911 is followed by one starting in 1912 (or, loosely, in 1911).
        if contiguous and prev is not None and s not in (prev, prev + 1):
            rep.err(w, f"starts in {s} but the period before ends in {prev}: periods must follow each other with no gap or overlap")
        if isinstance(e.get("glyph"), str) and len(e["glyph"]) > 2:
            rep.warn(w, f"glyph {e['glyph']!r} is longer than two characters")
        prev = t
    return ids


def check_eras_file(rep, where, d, contiguous=True):
    if not isinstance(d, dict) or not isinstance(d.get("eras"), list):
        rep.err(where, 'should be {"range": {...}, "eras": [...]}')
        return set(), None
    rng = d.get("range")
    if not (isinstance(rng, dict) and is_int(rng.get("start")) and is_int(rng.get("end")) and rng["start"] < rng["end"]):
        rep.err(where, "`range` should be {start, end} with start < end")
        rng = None
    if not d["eras"]:
        rep.err(where, "has no periods")
    return check_periods(rep, where, d["eras"], rng, contiguous), rng


def check_events(rep, where, events):
    if not isinstance(events, list):
        rep.err(where, "should be a list of events")
        return set()
    ids = check_ids(rep, where, events)
    for i, e in enumerate(events):
        if not isinstance(e, dict):
            continue
        w = f"{where} {e.get('id', f'[{i}]')}"
        y = e.get("year")
        if not is_int(y):
            rep.err(w, f"`year` should be a whole year, not {y!r}")
        elif "endYear" in e and (not is_int(e["endYear"]) or e["endYear"] < y):
            rep.err(w, f"`endYear` {e['endYear']!r} should be a year not before {y}")
        if not (is_num(e.get("lat")) and -90 <= e["lat"] <= 90 and is_num(e.get("lon")) and -180 <= e["lon"] <= 180):
            rep.err(w, "needs `lat` and `lon` on the globe")
        if e.get("level") not in (1, 2, 3):
            rep.err(w, f"`level` should be 1, 2 or 3, not {e.get('level')!r}")
        if e.get("category") not in CATS:
            rep.err(w, f"unknown `category` {e.get('category')!r}")
        text(rep, w, e, "title")
        text(rep, w, e, "summary", required=False)
        text(rep, w, e, "place", required=False)
        check_layer_keys(rep, w, e)
    return ids


def check_tours(rep, where, tours, era_ids, event_ids):
    if not isinstance(tours, list):
        rep.err(where, "should be a list of tours")
        return
    check_ids(rep, where, tours)
    for i, tr in enumerate(tours):
        if not isinstance(tr, dict):
            continue
        w = f"{where} {tr.get('id', f'[{i}]')}"
        text(rep, w, tr, "title")
        if tr.get("era") is not None and era_ids and tr["era"] not in era_ids:
            rep.err(w, f"`era` {tr['era']!r} is not a period")
        steps = tr.get("steps")
        if not isinstance(steps, list) or not steps:
            rep.err(w, "has no steps")
            continue
        for j, s in enumerate(steps):
            sw = f"{w} step {j + 1}"
            if not is_int(s.get("year")):
                rep.err(sw, f"`year` should be a whole year, not {s.get('year')!r}")
            if not is_lonlat(s.get("at")):
                rep.err(sw, "`at` should be [lon, lat]")
            text(rep, sw, s, "text")
            if s.get("event") and event_ids is not None and s["event"] not in event_ids:
                rep.err(sw, f"event {s['event']!r} does not exist")
            check_layer_keys(rep, sw, s)


MOODS = ("sorrow", "tension", "battle", "triumph", "journey", "serene", "solemn")


def check_geojson(rep, where, d):
    if not (isinstance(d, dict) and d.get("type") == "FeatureCollection" and isinstance(d.get("features"), list)):
        rep.err(where, "should be a GeoJSON FeatureCollection")
        return
    for i, f in enumerate(d["features"]):
        p = (f or {}).get("properties") or {}
        if not (f or {}).get("geometry"):
            rep.err(f"{where} feature {i}", "has no geometry")
        for k in ("from", "to"):
            if k in p and not is_int(p[k]):
                rep.err(f"{where} feature {i}", f"`{k}` should be a whole year")
        if is_int(p.get("from")) and is_int(p.get("to")) and p["from"] >= p["to"]:
            rep.err(f"{where} feature {i}", "`from` should be before `to`")


def check_pack(path):
    """A data pack: its folder or its manifest.json."""
    path = Path(path)
    man_path = path / "manifest.json" if path.is_dir() else path
    rep = Report(str(man_path.relative_to(ROOT) if man_path.resolve().is_relative_to(ROOT) else man_path))
    m = load(man_path, rep, "manifest")
    if not isinstance(m, dict):
        return rep
    base = man_path.parent
    check_format(rep, "manifest", m)
    if not ID.match(str(m.get("id", ""))):
        rep.err("manifest", "`id` should be lowercase letters, digits and -")
    text(rep, "manifest", m, "name")
    data = m.get("data") or {}
    for k in ("eras", "events"):
        if not data.get(k):
            rep.err("manifest", f"`data.{k}` is required")
    region = m.get("region") or {}
    if "polygon" in region and not (isinstance(region["polygon"], list) and len(region["polygon"]) >= 3 and all(map(is_lonlat, region["polygon"]))):
        rep.err("manifest", "`region.polygon` should be a list of [lon, lat] points")
    if "bounds" in region and not (isinstance(region["bounds"], list) and len(region["bounds"]) == 2 and all(map(is_lonlat, region["bounds"]))):
        rep.err("manifest", "`region.bounds` should be [[west, south], [east, north]]")
    if not m.get("basemap") and "polygon" not in region and "bounds" not in region:
        rep.warn("manifest", "no `region.polygon` or `region.bounds`: the timeline can only follow the pack when it is shown alone")
    rng = m.get("range")
    if not (isinstance(rng, dict) and is_int(rng.get("start")) and is_int(rng.get("end")) and rng["start"] < rng["end"]):
        rep.err("manifest", "`range` should be {start, end} with start < end")
    refs = m.get("refs")
    if refs is not None and "{ref}" not in str((refs or {}).get("url", "")):
        rep.warn("manifest", "`refs.url` has no {ref} placeholder")
    b = m.get("basemap")
    if b is not None and not isinstance(b, dict):
        rep.err("manifest", "`basemap` should be an object")

    era_ids, event_ids = set(), None
    if data.get("eras"):
        d = load(base / data["eras"], rep, data["eras"])
        if d is not None:
            era_ids, _ = check_eras_file(rep, data["eras"], d)
    if data.get("events"):
        d = load(base / data["events"], rep, data["events"])
        if d is not None:
            event_ids = check_events(rep, data["events"], d)
    if data.get("tours"):
        d = load(base / data["tours"], rep, data["tours"])
        if d is not None:
            check_tours(rep, data["tours"], d, era_ids, event_ids)

    layers = m.get("layers") or []
    if not isinstance(layers, list):
        rep.err("manifest", "`layers` should be a list")
        layers = []
    check_ids(rep, "manifest layers", layers)
    for L in layers:
        w = f"layer {L.get('id', '?')}"
        if not ID.match(str(L.get("id", ""))):
            rep.err(w, "`id` should be lowercase letters, digits and -")
        check_format(rep, w, L)
        if L.get("type") is not None and L["type"] not in LAYER_TYPES:
            rep.err(w, f"`type` should be fill, line or circle, not {L['type']!r}")
        yrs = L.get("years")
        if yrs is not None and not (isinstance(yrs, list) and len(yrs) == 2 and all(is_int(y) for y in yrs) and yrs[0] < yrs[1]):
            rep.err(w, "`years` should be [from, to) with from < to")
        if not L.get("data"):
            rep.err(w, "no `data`")
        elif isinstance(L["data"], str) and not re.match(r"^https?:", L["data"]):
            d = load(base / L["data"], rep, w)
            if d is not None:
                check_geojson(rep, f"{w} ({L['data']})", d)
    media = m.get("media")
    if media is not None:
        if not isinstance(media, dict) or not isinstance(media.get("base"), str):
            rep.err("manifest media", "should be {base, pictures?, narration?, music?} with `base` a URL")
        else:
            for k, v in media.items():
                if k == "base":
                    continue
                if k not in ("pictures", "narration", "music"):
                    rep.warn("manifest media", f"unknown key {k!r}")
                elif not re.match(r"^https?:", v):
                    d = load(base / v, rep, f"media {k}")
                    if d is not None and not isinstance(d, dict):
                        rep.err(f"media {k}", "should be an object")
                    elif k == "pictures" and d is not None and not ({"keys", "images"} <= set(d)):
                        rep.err("media pictures", "should have `keys` and `images`")
    for p in m.get("plugins") or []:
        entry = {"src": p} if isinstance(p, str) else p
        src = entry.get("src") if isinstance(entry, dict) else None
        w = f"plugin {src}"
        if not isinstance(src, str):
            rep.err("manifest plugins", f"entry {p!r} should be a path or {{src, atlas}}")
            continue
        check_format(rep, w, entry)
        if not re.match(r"^https?:", src) and not (base / src).is_file():
            rep.err(w, "file not found")
    return rep


def check_builtin():
    """The atlas's own data/: its manifest, periods (China and every region), events and tours."""
    rep = Report("data/")
    m = load(ROOT / "data/manifest.json", rep, "data/manifest.json")
    if isinstance(m, dict):
        check_format(rep, "data/manifest.json", m)
        if m.get("atlas", 1) != FORMAT:
            rep.warn("data/manifest.json", f"says format {m.get('atlas', 1)} but app.js FORMAT is {FORMAT}")
    era_ids = set()
    d = load(ROOT / "data/eras.json", rep, "data/eras.json")
    if d is not None:
        era_ids, _ = check_eras_file(rep, "data/eras.json", d)
    d = load(ROOT / "data/regions.json", rep, "data/regions.json")
    if isinstance(d, dict):
        region_ids = check_ids(rep, "data/regions.json regions", d.get("regions", []))
        for r in d.get("regions", []):
            w = f"data/regions.json {r.get('id')}"
            text(rep, w, r, "name")
            if r.get("periods"):
                # China's periods take their names from data/eras.json.
                era_ids |= check_periods(rep, f"{w} periods", r["periods"], named=r.get("id") != "china")
            elif r.get("id") != "china":
                rep.warn(w, "has no periods")
    events = load(ROOT / "data/events.json", rep, "data/events.json")
    event_ids = check_events(rep, "data/events.json", events) if events is not None else None
    if isinstance(events, list) and isinstance(d, dict):
        for e in events:
            for k in ("region",):
                if e.get(k) and e[k] not in region_ids:
                    rep.err(f"data/events.json {e.get('id')}", f"unknown region {e[k]!r}")
    tours = load(ROOT / "data/tours.json", rep, "data/tours.json")
    if tours is not None:
        check_tours(rep, "data/tours.json", tours, era_ids, event_ids)
    # data/moods.json: {"<tour id>/<step>": mood}, the mood track under that step (app.js musicWanted).
    moods = load(ROOT / "data/moods.json", rep, "data/moods.json")
    lives = load(ROOT / "data/lives.json", rep, "data/lives.json")
    if isinstance(moods, dict) and isinstance(tours, list):
        steps = {f"{tr.get('id')}/{i}" for tr in tours + (lives if isinstance(lives, list) else []) for i in range(len(tr.get("steps") or []))}
        for k, v in moods.items():
            if k not in steps:
                rep.err("data/moods.json", f"{k!r} is not a tour step")
            if v not in MOODS:
                rep.err("data/moods.json", f"{k}: mood {v!r} is not one of {', '.join(MOODS)}")
    return rep


def main(args):
    targets = args or ["data"]
    reports = []
    for t in targets:
        p = Path(t)
        if not p.is_absolute():
            p = Path.cwd() / p
        if p.resolve() == (ROOT / "data").resolve():
            reports.append(check_builtin())
        else:
            reports.append(check_pack(p))
    print(f"Atlas data format {FORMAT}")
    for r in reports:
        r.print()
    return 1 if any(r.errors for r in reports) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
