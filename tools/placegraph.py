"""Read and write the place graph (format: docs/places.md).

A graph file is either JSON, an object {"atlas", "note", "include", "nodes", "edges"} (all optional), or JSONL, one
record per line: an edge (it has `child`, and may have an `id` too), a node (it has `id` and no `child`), an include ({"include": "path" or [paths]}) or a
header ({"atlas": 2, "note": …}). Include paths are relative to the including file; includes may nest but not loop.
An id may be defined once only."""
import json, os


class GraphError(Exception):
    pass


def load(path, skip=(), _seen=None, _out=None):
    """`skip`: file names (as included) to leave out. {"nodes": [...], "edges": [...], "files": [...]}; each record gets "_file" (path relative to the first file's folder)."""
    path = os.path.normpath(path)
    top = _out is None
    out = _out or {"nodes": [], "edges": [], "files": [], "root": os.path.dirname(path)}
    seen = _seen or []
    if path in seen: raise GraphError("include loop: " + " → ".join(seen + [path]))
    seen = seen + [path]
    rel = os.path.relpath(path, out["root"])
    out["files"].append(rel)
    recs = []
    with open(path, encoding="utf-8") as f:
        if path.endswith(".jsonl"):
            for i, line in enumerate(f, 1):
                if not line.strip(): continue
                try: recs.append((i, json.loads(line)))
                except ValueError as e: raise GraphError(f"{rel}:{i}: {e}")
        else:
            d = json.load(f)
            recs = [(0, {"include": d["include"]})] if d.get("include") else []
            recs += [(0, n) for n in d.get("nodes", [])] + [(0, e) for e in d.get("edges", [])]
    for i, r in recs:
        if "include" in r:
            for p in [r["include"]] if isinstance(r["include"], str) else r["include"]:
                if p not in skip: load(os.path.join(os.path.dirname(path), p), skip, seen, out)
        elif "child" in r: out["edges"].append({**r, "_file": rel, "_line": i})   # an edge may have an id of its own
        elif "id" in r: out["nodes"].append({**r, "_file": rel, "_line": i})
        elif not ({"atlas", "note", "span"} & r.keys()): raise GraphError(f"{rel}:{i}: neither a node, an edge nor an include")
    if top:
        ids = {}
        for n in out["nodes"]:
            if n["id"] in ids: raise GraphError(f"{n['_file']}:{n['_line']}: {n['id']} is already defined in {ids[n['id']]}")
            ids[n["id"]] = f"{n['_file']}:{n['_line']}"
    return out


def clean(r):
    return {k: v for k, v in r.items() if not k.startswith("_")}


def write_jsonl(path, records, header=None):
    with open(path, "w", encoding="utf-8") as f:
        for r in ([header] if header else []) + list(records):
            f.write(json.dumps(clean(r), ensure_ascii=False, separators=(",", ":")) + "\n")
