"""Check each period on the timeline against the country table (data/lineages.json `start`/`end`).

A period that is one country's time (唐, the Achaemenid Empire) should start and end with it. For every period of
data/eras.json (China) and data/regions.json whose main state (the one `focus` map feature, or the focus name whose
Chinese name the period shares) is dated in the table, it prints the period's years beside the country's when they
differ. Usage: python3 tools/check_eras.py [--apply]

Periods don't overlap, so one ends the year before the next starts: 唐 runs 618–906 on the timeline while the dynasty
ended in 907. With --apply, a period within a year of its country gets `since`/`until`, the years the era panel shows
(唐 618–907). A larger difference is usually right: the period (朝代) is part of a longer-lived state (实体), as 秦朝
前221 within 秦国 from 前770 or 民国 on the mainland until 1948. Those periods get `entity` (the lineage id) and the era
panel adds a line with the state's own years."""
import json, os, re, sys

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
        # Only a period named after its country (唐 and 唐; not 平安时代 and Japan) should share its years.
        same = lambda c: c["name_zh"] and e.get("name_zh") and (c["name_zh"] == e["name_zh"] or c["name_zh"].rstrip("王朝帝国") == e["name_zh"].rstrip("王朝帝国"))
        pick = [c for c in cs if same(c)]
        if len(pick) != 1: continue
        c = pick[0]
        end = c["end"] if c["end"] is not None else 2026
        if (c["start"], end) != (e["start"], e["end"]):
            out.append((reg, e.get("id"), e.get("name_zh"), e["start"], e["end"], c["id"], c["name_zh"], c["start"], end))
    fix = {}
    for row in out:
        reg, pid, _, a, b, _, _, ca, cb = row
        if abs(ca - a) <= 1 and abs(cb - b) <= 1:
            fix[(reg, pid)] = {**({"since": ca} if ca != a else {}), **({"until": cb} if cb != b else {})}
        else:
            # The period is part of a longer-lived state (秦朝 within 秦国): the era panel adds the state's years.
            fix[(reg, pid)] = {"entity": row[5]}
            print("%-20s %-24s %-10s %6d..%-6d  %-24s %-10s %6d..%d" % row)
    print(len(out), "periods differ from their country;", sum("entity" not in f for f in fix.values()), "by a year (shown with the country's years)")
    if "--apply" in sys.argv:
        text = open(P("data/eras.json")).read()
        for (reg, pid), f in fix.items():
            if reg != "china" or not pid: continue
            m = re.search(r'"id": "%s".*?"end": -?\d+' % re.escape(pid), text, re.S)
            if not m or not any(k not in text[m.start():m.end() + 80] for k in f): continue
            if re.match(r',\s*"(since|until|entity)"', text[m.end():]): continue
            text = text[:m.end()] + "".join(f',\n   "{k}": {json.dumps(v)}' for k, v in f.items()) + text[m.end():]
        open(P("data/eras.json"), "w").write(text)
        R = json.load(open(P("data/regions.json")))
        for r in R["regions"]:
            for e in r["periods"]:
                if (r["id"], e.get("id")) in fix and "start" in e: e.update(fix[(r["id"], e["id"])])
        json.dump(R, open(P("data/regions.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
