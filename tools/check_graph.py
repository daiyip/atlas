"""Check the place graph (data/graph.json and what it includes; format: docs/places.md).

Errors (exit 1): a file that doesn't load (bad JSON, an include loop, an id defined twice); an id whose prefix isn't
a known kind; an unknown relation; an edge to a node that doesn't exist or between kinds the relation doesn't join; `from`
after `to`, or a `date_from`/`date_to` in another year; a node `in` two places in the same year, `in` edges that
loop, or `geo.shapes` whose years overlap; an edge id used twice; a `held`, `claim` or `part` edge outside the years
its nodes existed; `held` shares of one area adding up to more than 100 in some year (give or take rounding); an outline with under three
points, or a `geo.src` / `dispute` / `replacedBy` that points nowhere.
Warnings: a dispute in data/disputes.json that no `claim` edge names.

A pack's graph (manifest data.graph) is checked the same way by tools/validate.py, against the atlas's own: its ids
start with "<pack id>:", its edges start from its own places, and its region is region:<pack id>.

Usage: python3 tools/check_graph.py [data/graph.json]"""
import json, os, re, sys
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


DATE = re.compile(r"^(-?\d{1,4})(-\d\d(-\d\d)?)?$")


def date_ok(r, k, w, errs):
    """date_from / date_to: an exact date ("1949-10-01", "1949-10") whose year is `from` / `to`."""
    d = r.get("date_" + k)
    if d is None: return
    m = DATE.match(str(d))
    if not m: errs.append(f"{w}: date_{k} {d!r} is not YYYY, YYYY-MM or YYYY-MM-DD")
    elif r.get(k) != int(m.group(1)): errs.append(f"{w}: date_{k} {d} is not in year {k} = {r.get(k)}")


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
        else:
            # The prefix is the kind the node had when its id was made; a later kind, or a finer `type`, keeps it.
            rest = nid[len(ns) + 1:] if ns and nid.startswith(ns + ":") else None if ns else nid
            if rest is None: errs.append(f"{where(n)}: {nid}: a pack's ids start with '{ns}:'")
            elif rest.split(":")[0] not in KINDS or ":" not in rest: errs.append(f"{where(n)}: {nid}: an id starts with a kind, like '{(ns + ':') if ns else ''}{kind}:'")
        if "type" in n and not isinstance(n["type"], str): errs.append(f"{where(n)}: {nid}: `type` is a word")
        for k in ("from", "to"): date_ok(n, k, where(n) + ": " + nid, errs)
        if n.get("from") is not None and n.get("to") is not None and n["from"] > n["to"]: errs.append(f"{where(n)}: {nid}: from after to")
        geo = n.get("geo") or {}
        for x in [geo] + list(geo.get("shapes") or []):
            if "poly" in x and len(x["poly"]) < 3: errs.append(f"{where(n)}: {nid}: an outline needs three points")
            if "src" in x:
                f, _, i = x["src"].partition("#")
                try:
                    if i not in src_ids(f): errs.append(f"{where(n)}: {nid}: {x['src']} not found")
                except OSError: errs.append(f"{where(n)}: {nid}: no file {f}")
        sh = sorted(geo.get("shapes") or [], key=lambda x: x.get("from") if x.get("from") is not None else -1e9)
        for x, z in zip(sh, sh[1:]):
            if x.get("to") is None or (z.get("from") is not None and z["from"] <= x["to"]): errs.append(f"{where(n)}: {nid}: geo.shapes overlap in years")
        if n.get("replacedBy") and n["replacedBy"] not in nodes: errs.append(f"{where(n)}: {nid}: replacedBy {n['replacedBy']} not found")

    eids = {}
    for e in G["edges"]:
        if "id" in e:
            if e["id"] in eids or e["id"] in nodes: errs.append(f"{where(e)}: edge id {e['id']} is already used")
            eids[e["id"]] = 1
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
        date_ok(e, "from", where(e), errs); date_ok(e, "to", where(e), errs)
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

    # One `in` parent in any year (a parent may change with time: a county moving to another prefecture).
    lo = lambda e: e.get("from") if e.get("from") is not None else -1e9
    hi = lambda e: e.get("to") if e.get("to") is not None else 1e9
    for c, ps in parents.items():
        for i, (p, e) in enumerate(ps):
            for q, f in ps[i + 1:]:
                if lo(e) <= hi(f) and lo(f) <= hi(e): errs.append(f"{where(f)}: {c} is `in` both {p} and {q} in the same years")
    def loops(c, seen):
        for p, _ in parents.get(c, []):
            if p in seen: return seen + [p]
            r = loops(p, seen + [p])
            if r: return r
    for c in parents:
        r = loops(c, [c])
        if r: errs.append(f"{c}: `in` edges loop: {' › '.join(r)}")
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
