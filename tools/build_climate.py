#!/usr/bin/env python3
"""Build data/climate.json (气候与灾害 layer) from tools/climate/.

  curve.json        temperature sketch nodes [year, °C anomaly] + warm/cold periods (AI-placed after 竺可桢 1972, 葛全胜 2013)
  disasters-*.json  drafted disasters: id, kind, from, to, name(_zh), lon, lat, r_km, area(_zh), toll(_zh), summary(_zh), events, source

The curve is resampled every 10 years (linear between nodes, then a light 3-point smoothing). Event ids a disaster names
are checked against data/events.json; those events, and China events whose title names a disaster, gain "climate" in
their own `layers` list when they have one, so reading them switches the layer on. Run: python3 tools/build_climate.py
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "climate")
KINDS = {"drought", "flood", "locust", "famine", "quake", "plague", "cold", "river"}
# China events whose title names a disaster also switch the layer on (same words as the climate rule in app.js AUTO_RULES).
TITLE = re.compile(r"旱|蝗|饥荒|大饥|奇荒|水灾|大水|洪水|决口|决堤|改道|夺淮|地震|大疫|瘟疫|鼠疫|雪灾|寒冬|结冰")
KEYS = ["id", "kind", "from", "to", "circa", "name", "name_zh", "lon", "lat", "r_km", "area", "area_zh", "toll", "toll_zh",
        "summary", "summary_zh", "events", "source"]


def curve(nodes):
    nodes = sorted(nodes)
    def at(y):
        for (y0, a0), (y1, a1) in zip(nodes, nodes[1:]):
            if y0 <= y <= y1:
                return a0 + (y - y0) / (y1 - y0) * (a1 - a0)
        return nodes[-1][1] if y > nodes[-1][0] else nodes[0][1]
    ys = list(range(nodes[0][0], nodes[-1][0] + 1, 10))
    if ys[-1] != nodes[-1][0]:
        ys.append(nodes[-1][0])
    raw = [at(y) for y in ys]
    sm = [raw[0]] + [(raw[i - 1] + 2 * raw[i] + raw[i + 1]) / 4 for i in range(1, len(raw) - 1)] + [raw[-1]]
    return [[y, round(a, 2)] for y, a in zip(ys, sm)]


def main():
    base = json.load(open(os.path.join(SRC, "curve.json")))
    events = json.load(open(os.path.join(ROOT, "data", "events.json")))
    by_id = {e["id"]: e for e in events}
    dis, seen, bad = [], set(), []
    for f in sorted(glob.glob(os.path.join(SRC, "disasters-*.json"))):
        for d in json.load(open(f)):
            if d["id"] in seen:
                bad.append(f"duplicate id {d['id']}")
                continue
            seen.add(d["id"])
            if d["kind"] not in KINDS:
                bad.append(f"{d['id']}: kind {d['kind']}")
            if d["to"] < d["from"]:
                bad.append(f"{d['id']}: to < from")
            missing = [e for e in d.get("events", []) if e not in by_id]
            if missing:
                print(f"  {d['id']}: dropping unknown events {missing}", file=sys.stderr)
            d["events"] = [e for e in d.get("events", []) if e in by_id]
            dis.append({k: d[k] for k in KEYS if k in d and d[k] not in (None, "", [])} | {"events": d["events"]})
    if bad:
        sys.exit("\n".join(bad))
    dis.sort(key=lambda d: (d["from"], d["id"]))
    touched = 0
    want = {eid for d in dis for eid in d["events"]}
    want |= {e["id"] for e in events if not e.get("region") and TITLE.search(e.get("title_zh", ""))}
    for eid in sorted(want):
        ls = by_id[eid].get("layers")
        if isinstance(ls, list) and "climate" not in ls:
            ls.append("climate")
            touched += 1
    out = {"note": base["note"], "note_zh": base["note_zh"], "refs": base["refs"], "curve": curve(base["nodes"]),
           "periods": base["periods"], "disasters": dis}
    with open(os.path.join(ROOT, "data", "climate.json"), "w") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    if touched:
        with open(os.path.join(ROOT, "data", "events.json"), "w") as fh:
            json.dump(events, fh, ensure_ascii=False, indent=1)
    kinds = {}
    for d in dis:
        kinds[d["kind"]] = kinds.get(d["kind"], 0) + 1
    print(f"climate.json: {len(out['curve'])} curve points, {len(out['periods'])} periods, {len(dis)} disasters {kinds}; "
          f"{touched} event layer lists gained climate")


if __name__ == "__main__":
    main()
