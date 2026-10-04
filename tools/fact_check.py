"""Compare events, people and rulers with the facts tools/fact_fetch.py saved:
python3 tools/fact_check.py <facts.json> <report.json> [deep.json]

Each item is `ok` (its years agree with Wikidata or with the article's opening paragraph), `mismatch` (Wikidata
gives a clearly different year, or the place is far off) or `none` (nothing to check against). The report lists
every item with its evidence, so mismatches can be reviewed by hand; tools/apply_facts.py writes the verdicts back.
With deep.json (tools/fact_deep.py), an item left at `none` is `ok` when its years appear in the whole English or
Chinese article (an event's passage must also share a word with its title); otherwise its passages are kept for review."""
import glob, json, math, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
F = json.load(open(sys.argv[1]))
pages, src, rhits = F["pages"], F["src"], F["rulers"]
PREC_TOL = {9: 1, 8: 10, 7: 100, 6: 1000}


def tol(prec, circa, y):
    t = PREC_TOL.get(prec, 1 if prec > 9 else 1000)
    if circa: t = max(t, 10 if y > 0 else 50 if y > -1500 else 150)
    return t


def near(y, vals, circa):
    return any(v and abs(v[0] - y) <= tol(v[1], circa, y) for v in vals)


def in_text(y, text):
    if not text: return False
    if y < 0:
        return bool(re.search(rf"(?<![\d,]){-y}(\s|&nbsp;)?(BC|BCE|B\.C\.)", text) or re.search(rf"(?<![\d,]){-y}\s*[–-]\s*\d+\s*(BC|BCE)", text))
    return bool(re.search(rf"(?<![\d,.]){y}(?![\d,])", text))


def dist(a, b):
    (x1, y1), (x2, y2) = a, b
    dx = math.radians(x2 - x1) * math.cos(math.radians((y1 + y2) / 2))
    return 6371 * math.hypot(dx, math.radians(y2 - y1))


report = []

# ---- events
for e in json.load(open(os.path.join(ROOT, "data/events.json"))):
    pg = pages.get(src.get(e.get("source")), {})
    wd, text = pg.get("wd", {}), pg.get("extract", "")
    circa = bool(e.get("circa"))
    own = {k: wd[k] for k in ("P585", "P580") if k in wd}  # dates of the event itself
    ends = wd.get("P582", []) + wd.get("P576", [])
    # A source is often the article on a state or place: its founding and end years can confirm a year, never contradict it.
    if not own and near(e["year"], wd.get("P571", []) + ends, circa): own = {"P571": wd["P571"]} if "P571" in wd else {"P576": ends}
    r = {"kind": "event", "key": e["id"], "id": e["id"], "year": e["year"], "end": e.get("endYear"), "title": e["title"],
         "page": src.get(e.get("source")), "wd": {k: v for k, v in wd.items() if k in ("P585", "P580", "P582", "P571", "P576")}}
    if own:
        vals = sum(own.values(), [])
        ok = near(e["year"], vals, circa) or near(e["year"], ends, circa)
        r["status"] = "ok" if ok else "mismatch"
        r["why"] = "wikidata" if ok else "year differs from Wikidata"
    elif in_text(e["year"], text):
        r["status"], r["why"] = "ok", "intro"
    else:
        r["status"], r["why"] = "none", ""
    if "coord" in wd and ("P585" in wd or "P580" in wd) and dist(wd["coord"], [e["lon"], e["lat"]]) > 600:
        r["far"] = round(dist(wd["coord"], [e["lon"], e["lat"]])); r["coord"] = wd["coord"]
        if r["status"] == "ok": r["status"], r["why"] = "mismatch", f"place {r['far']} km from Wikidata"
    if r["status"] != "ok": r["extract"] = text[:900]
    report.append(r)

# ---- people and rulers
seen = set()
for f in sorted(glob.glob(os.path.join(ROOT, "data/layers/*.json"))):
    L = json.load(open(f))
    world = os.path.basename(f).startswith("world-")
    for era, L in (L.items() if world else [(os.path.basename(f)[:-5], L)]):
        for p in L.get("people", []):
            key = ("p", p["name"], p.get("born"), p.get("died"))
            if key in seen: continue
            seen.add(key)
            pg = pages.get(src.get(p.get("source")), {})
            wd, text = pg.get("wd", {}), pg.get("extract", "")
            circa = bool(p.get("circa"))
            r = {"kind": "person", "key": "|".join(map(str, key)), "file": os.path.basename(f), "era": era, "name": p["name"], "name_zh": p.get("name_zh"),
                 "born": p.get("born"), "died": p.get("died"), "page": src.get(p.get("source")),
                 "wd": {k: v for k, v in wd.items() if k in ("P569", "P570", "zh")}}
            checks = []
            for fld, prop in (("born", "P569"), ("died", "P570")):
                y = p.get(fld)
                if y is None: continue
                if wd.get(prop): checks.append("ok" if near(y, wd[prop], circa) else "bad")
                elif in_text(y, text): checks.append("ok")
                else: checks.append("none")
            r["status"] = "mismatch" if "bad" in checks else "ok" if checks and "none" not in checks else "none"
            r["why"] = "dates differ from Wikidata" if r["status"] == "mismatch" else ""
            if r["status"] != "ok": r["extract"] = text[:900]
            report.append(r)
        for polity, rs in (L.get("rulers") or {}).items():
            for x in rs:
                key = f"{polity}|{x['name']}|{x['from']}|{x['to']}"
                if key in seen: continue
                seen.add(key)
                circa = bool(x.get("circa"))
                r = {"kind": "ruler", "key": key, "file": os.path.basename(f), "era": era, "polity": polity, "name": x["name"],
                     "name_zh": x.get("name_zh"), "title": x.get("title") or x.get("rank"), "from": x["from"], "to": x["to"]}
                best = None
                tokens = [t for t in re.split(r"[\s,()]+", x["name"]) if len(t) > 2 and t not in ("the", "of", "King", "Emperor")]
                for t in rhits.get(key, []):
                    pg = pages.get(t, {})
                    text = pg.get("extract", "")
                    if not tokens or not any(tok.lower() in (t + " " + text[:300]).lower() for tok in tokens): continue
                    held = [h for h in pg.get("wd", {}).get("held", [])]
                    a = in_text(x["from"], text) or any(h[0] and abs(h[0][0] - x["from"]) <= tol(h[0][1], circa, x["from"]) for h in held)
                    b = in_text(x["to"], text) or any(h[1] and abs(h[1][0] - x["to"]) <= tol(h[1][1], circa, x["to"]) for h in held)
                    if a and b: best = (t, "ok"); break
                    if best is None: best = (t, "partial" if a or b else "none")
                r["page"] = best[0] if best else None
                r["status"] = "ok" if best and best[1] == "ok" else "none"
                r["partial"] = bool(best and best[1] == "partial")
                if r["status"] != "ok" and best: r["extract"] = pages.get(best[0], {}).get("extract", "")[:900]
                report.append(r)

# ---- second pass: whole articles
if len(sys.argv) > 3:
    deep = json.load(open(sys.argv[3]))
    events = {e["id"]: e for e in json.load(open(os.path.join(ROOT, "data/events.json")))}
    STOP = {"the", "and", "of", "in", "at", "to", "a", "an", "his", "her", "its", "with", "from", "for", "on", "by", "into", "begins", "ends"}

    def linked(e, ps):
        words = {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'-]{3,}", e["title"])} - STOP
        zh = e.get("title_zh", "")
        grams = {zh[i:i + 2] for i in range(len(zh) - 1)}
        return any(any(w in p.lower() for w in words) or any(g in p for g in grams) for p in ps)

    for r in report:
        d = deep.get(r["key"])
        if r["status"] != "none" or not d: continue
        hits = d["hits"]
        if r["kind"] == "event":
            ys = [r["year"]]
            ok = str(r["year"]) in hits and linked(events[r["key"]], hits[str(r["year"])])
        elif r["kind"] == "person":
            ys = [y for y in (r["born"], r["died"]) if y is not None]
            ok = bool(ys) and all(str(y) in hits for y in ys)
        else:
            ys = [r["from"], r["to"]]
            ok = all(str(y) in hits for y in ys)
        if ok: r["status"], r["why"] = "ok", "article"
        r["deep"] = {"en": d.get("en"), "zh": d.get("zh"), "hits": hits, "intro": d.get("intro", "")[:400], "intro_zh": d.get("intro_zh", "")[:300]}

json.dump(report, open(sys.argv[2], "w"), ensure_ascii=False, indent=0)
from collections import Counter
print(Counter((r["kind"], r["status"]) for r in report))
print("far places", sum(1 for r in report if r.get("far")))
