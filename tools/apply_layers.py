"""Write per-item auto layers into events, tours and lives.

  python3 tools/apply_layers.py choices.json [more.json ...]

Each choices file maps an event id, or "<tour id>#<step index>", to the list of layer keys the Auto layers switch turns
on for it (see docs/custom-data.md). Items not named keep what they have; without `layers` the app falls back to its
keyword rules (AUTO_RULES in app.js).
"""
import json
import sys

KEYS = {"rulers", "people", "armies", "routes", "exchange", "spread", "passes", "roads", "walls", "clans", "capitals", "faith", "inventions"}
choice = {}
for f in sys.argv[1:]:
    choice.update(json.load(open(f)))
bad = {k: v for k, v in choice.items() if not set(v) <= KEYS}
if bad:
    sys.exit(f"unknown layer keys: {list(bad.items())[:5]}")

n = 0
events = json.load(open("data/events.json"))
for e in events:
    if e["id"] in choice:
        e["layers"] = choice[e["id"]]; n += 1
json.dump(events, open("data/events.json", "w"), ensure_ascii=False, indent=1)
for path, indent in (("data/tours.json", 1), ("data/lives.json", None)):
    tours = json.load(open(path))
    for t in tours:
        for i, s in enumerate(t["steps"]):
            k = f"{t['id']}#{i}"
            if k in choice:
                s["layers"] = choice[k]; n += 1
    json.dump(tours, open(path, "w"), ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))
print(f"{n} items given layers")
