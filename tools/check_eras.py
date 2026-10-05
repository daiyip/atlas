"""Check each period on the timeline against the country table (data/lineages.json `start`/`end`).

A period that is one country's time (唐, the Achaemenid Empire) should start and end with it. For every period of
data/eras.json (China) and data/regions.json whose main state (the one `focus` map feature, or the focus name whose
Chinese name the period shares) is dated in the table, it prints the period's years beside the country's when they
differ. Usage: python3 tools/check_eras.py"""
import json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
P = lambda *a: os.path.join(ROOT, *a)


def load(path):
    path, _, part = path.partition("#")
    d = json.load(open(P(path)))
    return d[part] if part else d


def main():
    table = json.load(open(P("data/lineages.json")))

    def country(name, year):
        for L in table:
            for x in L["names"]:
                n, a, b = (x + [None, None])[:3] if isinstance(x, list) else (x, None, None)
                a = a if a is not None else L.get("from", -10 ** 9)
                b = b if b is not None else L.get("to", 10 ** 9)
                if n == name and (a is None or year >= a) and (b is None or year <= b): return L
        return None

    periods = []
    for e in json.load(open(P("data/eras.json")))["eras"]:
        names = set()
        for s in e["snapshots"]:
            names.update(f["properties"]["name"] for f in load(s["borders"])["features"] if f["properties"].get("focus"))
        periods.append(("china", e, sorted(names)))
    for r in json.load(open(P("data/regions.json")))["regions"]:
        for e in r["periods"]:
            if "start" in e: periods.append((r["id"], e, e.get("focus") or []))
    out = []
    for reg, e, names in periods:
        mid = (e["start"] + e["end"]) // 2
        cs = {id(c): c for c in (country(n, mid) for n in names) if c and c.get("start") is not None}
        cs = list(cs.values())
        # One main state, or the one whose Chinese name the period carries.
        pick = cs if len(cs) == 1 else [c for c in cs if c["name_zh"] and (c["name_zh"] in e.get("name_zh", "") or e.get("name_zh", "") in c["name_zh"])]
        if len(pick) != 1: continue
        c = pick[0]
        end = c["end"] if c["end"] is not None else 2026
        if (c["start"], end) != (e["start"], e["end"]):
            out.append((reg, e.get("id"), e.get("name_zh"), e["start"], e["end"], c["id"], c["name_zh"], c["start"], end))
    for row in out:
        print("%-20s %-24s %-10s %6d..%-6d  %-24s %-10s %6d..%d" % row)
    print(len(out), "periods differ from their country")


if __name__ == "__main__":
    main()
