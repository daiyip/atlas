"""Check the place graph (data/graph.json and what it includes; format: docs/places.md).

Errors (exit 1): a file that doesn't load (bad JSON, an include loop, an id defined twice); an id whose prefix isn't
its kind; an unknown relation; an edge to a node that doesn't exist or between kinds the relation doesn't join; `from`
after `to`; a node with two `in` parents, or `in` edges that loop; a `held`, `claim` or `part` edge outside the years
its nodes existed; `held` shares of one area adding up to more than 100 in some year (give or take rounding); an outline with under three
points, or a `geo.src` / `dispute` / `replacedBy` that points nowhere.
Warnings: a dispute in data/disputes.json that no `claim` edge names.

A pack's graph (manifest data.graph) is checked the same way by tools/validate.py, against the atlas's own: its ids
start with "<pack id>:", its edges start from its own places, and its region is region:<pack id>.

Usage: python3 tools/check_graph.py [data/graph.json]"""
import json, os, sys
from collections import defaultdict
import placegraph

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
KINDS = {"group", "region", "area", "polity", "admin", "city", "map"}
# relation: (child kinds, parent kinds)
RELS = {
    "in": ({"region", "area", "admin", "city"}, {"group", "region", "area", "admin"}),
    "held": ({"area", "admin", "city"}, {"polity", "map"}),
    "claim": ({"area", "admin", "city"}, {"polity"}),
    "part": ({"polity"}, {"polity"}),
    "name": ({"map"}, {"polity"}),
}


def check(path, ns=None, base=None):
    """(errors, warnings, graph). ns: a pack's id; base: the atlas's own graph its edges may point into."""
    errs, warns = [], []
    try: G = placegraph.load(path)
    except (placegraph.GraphError, OSError, ValueError) as e: return [str(e)], [], None
    where = lambda r: f"{r['_file']}:{r['_line']}" if r.get("_line") else r["_file"]
    nodes = {n["id"]: n for n in (base or {}).get("nodes", [])}
    if ns: nodes["region:" + ns] = {"id": "region:" + ns, "kind": "region"}
    own = {n["id"] for n in G["nodes"]}
    nodes.update({n["id"]: n for n in G["nodes"]})
    data = os.path.join(ROOT, "data")
    srcs = {}
    def src_ids(f):
        if f not in srcs:
            d = json.load(open(os.path.join(data, f)))
            items = d.get("features") and [x["properties"] for x in d["features"]] or d.get("regions") or []
            srcs[f] = {x.get("id") for x in items}
        return srcs[f]

    for n in G["nodes"]:
        kind, nid = n.get("kind"), n["id"]
        if kind not in KINDS: errs.append(f"{where(n)}: {nid}: unknown kind {kind!r}")
        elif not nid.startswith((ns + ":" if ns else "") + kind + ":"): errs.append(f"{where(n)}: {nid}: an id of kind {kind} starts with '{(ns + ':') if ns else ''}{kind}:'")
        if n.get("from") is not None and n.get("to") is not None and n["from"] > n["to"]: errs.append(f"{where(n)}: {nid}: from after to")
        geo = n.get("geo") or {}
        if "poly" in geo and len(geo["poly"]) < 3: errs.append(f"{where(n)}: {nid}: an outline needs three points")
        if "src" in geo:
            f, _, i = geo["src"].partition("#")
            try:
                if i not in src_ids(f): errs.append(f"{where(n)}: {nid}: {geo['src']} not found")
            except OSError: errs.append(f"{where(n)}: {nid}: no file {f}")
        if n.get("replacedBy") and n["replacedBy"] not in nodes: errs.append(f"{where(n)}: {nid}: replacedBy {n['replacedBy']} not found")

    parents = defaultdict(list)
    shares = defaultdict(list)
    claimed = set()
    for e in G["edges"]:
        c, p, rel = e.get("child"), e.get("parent"), e.get("rel")
        if rel not in RELS: errs.append(f"{where(e)}: unknown relation {rel!r}"); continue
        if ns and c not in own: errs.append(f"{where(e)}: {c} {rel} {p}: a pack's edges start from its own places"); continue
        if c not in nodes or p not in nodes:
            errs.append(f"{where(e)}: {c} {rel} {p}: {c if c not in nodes else p} not found"); continue
        ck, pk = RELS[rel]
        if nodes[c]["kind"] not in ck or nodes[p]["kind"] not in pk:
            errs.append(f"{where(e)}: {c} {rel} {p}: '{rel}' joins {'/'.join(sorted(ck))} to {'/'.join(sorted(pk))}")
        a, b = e.get("from"), e.get("to")
        if a is not None and b is not None and a > b: errs.append(f"{where(e)}: {c} {rel} {p}: from after to")
        if rel == "in": parents[c].append((p, e))
        if rel in ("held", "claim", "part"):
            for nid in (c, p):
                n = nodes[nid]
                if (n.get("from") is not None and a is not None and a < n["from"]) or (n.get("to") is not None and (b is None or b > n["to"])):
                    errs.append(f"{where(e)}: {c} {rel} {p} {a}–{b}: outside {nid}'s years {n.get('from')}–{n.get('to')}")
        if rel == "held": shares[c].append(e)
        if rel == "claim" and e.get("dispute"):
            claimed.add(e["dispute"])
            if e["dispute"] not in src_ids("disputes.json"): errs.append(f"{where(e)}: dispute {e['dispute']} not in disputes.json")

    for c, ps in parents.items():
        if len(ps) > 1: errs.append(f"{where(ps[1][1])}: {c} is `in` both {ps[0][0]} and {ps[1][0]}")
    for c in parents:
        seen, x = [c], parents[c][0][0]
        while x in parents:
            if x in seen: errs.append(f"{c}: `in` edges loop: {' › '.join(seen + [x])}"); break
            seen.append(x); x = parents[x][0][0]
    for c, es in shares.items():
        for y in {e["from"] for e in es if e.get("from") is not None}:
            on = [e for e in es if (e.get("from") is None or e["from"] <= y) and (e.get("to") is None or y <= e["to"])]
            s = sum(e.get("share", 100) for e in on)
            if s > 100 + len(on) - 1:   # rounded shares may add up to a little over 100
                errs.append(f"{c}: held shares add up to {s} in {y}"); break
    if not ns:
        try:
            for d in sorted(src_ids("disputes.json") - claimed): warns.append(f"dispute {d} has no claim edge")
        except OSError: pass
    return errs, warns, G


def main(path):
    errs, warns, G = check(path)
    if G is None: print("ERROR", errs[0]); return 1
    for w in warns: print("warning:", w)
    for e in errs: print("ERROR", e)
    kinds = defaultdict(int)
    for n in G["nodes"]: kinds[n["kind"]] += 1
    rels = defaultdict(int)
    for e in G["edges"]: rels[e.get("rel")] += 1
    print(f"{len(G['files'])} files; nodes: {dict(kinds)}; edges: {dict(rels)}; {len(errs)} errors, {len(warns)} warnings")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data/graph.json")))
