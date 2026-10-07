"""Give every reign and capital in data/layers/*.json a stable `id`, so links, saved views and other data can name
it (docs/internals.md). The id comes from the name and the first year, so rerunning after a layer rebuild
(merge_layers.py, apply_layers.py …) gives the same ids back:

  rulers    ruler:<name>-<from>     ruler:li-shimin-626 (one reign; the same reign filed under two map names, Kublai
                                    under Mongol Empire and Yuan, gets one id)
  capitals  capital:<name>-<from>   capital:chang-an-618

Ids already present are kept. Two different reigns that would get the same id: the second gets -2, -3 ….
Usage: python3 tools/add_ids.py"""
import glob, json, os, re, unicodedata

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


def main():
    taken = {}   # id -> what it names (name, from, to)
    files = sorted(glob.glob(os.path.join(ROOT, "data/layers/*.json")))
    data = {f: json.load(open(f, encoding="utf-8")) for f in files}

    def give(kind, x, ident):
        if x.get("id"):
            taken.setdefault(x["id"], ident)
            return 0
        base = f"{kind}:{slug(x.get('name') or x.get('name_zh') or '')}-{x['from']}"
        i, n = base, 2
        while i in taken and taken[i] != ident:
            i, n = f"{base}-{n}", n + 1
        taken[i] = ident
        x["id"] = i
        return 1

    added = 0
    # Existing ids first, so new ones never take them.
    for f, d in data.items():
        for b in (d.values() if os.path.basename(f).startswith("world-") else [d]):
            for rs in (b.get("rulers") or {}).values():
                for r in rs:
                    if r.get("id"): taken.setdefault(r["id"], (r.get("name"), r["from"], r.get("to")))
    for f, d in data.items():
        for b in (d.values() if os.path.basename(f).startswith("world-") else [d]):
            for rs in (b.get("rulers") or {}).values():
                for r in rs: added += give("ruler", r, (r.get("name"), r["from"], r.get("to")))
            for c in b.get("capitals") or []: added += give("capital", c, (c.get("name"), c["from"], c.get("polity")))
        with open(f, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{added} ids added, {len(taken)} in all")


if __name__ == "__main__":
    main()
