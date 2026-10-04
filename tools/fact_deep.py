"""Second pass of the fact check, for items the first pass (tools/fact_fetch.py) could not confirm: run by
.github/workflows/facts.yml with `deep`, since Wikipedia is reachable from GitHub's runners but not from the build machine.

For every event, person and ruler that has no `check` yet, it reads the whole English article (the item's source, a
ruler's title) and the whole Chinese article (source_zh, or the page named by name_zh / title_zh), and keeps the
passages where the item's years appear, plus each article's opening lines (for checking summaries).

With a second argument `events`, it does this for every event instead (for checking summaries) and writes
<out>/deep-events.json.

Writes <out>/deep.json: {key: {"en": title, "zh": title, "hits": {year: [passage, ...]}, "intro": text, "intro_zh": text}}.
tools/fact_check.py <facts.json> <report.json> <deep.json> uses it."""
import glob, json, os, re, sys, time, urllib.parse, urllib.request

UA = {"User-Agent": "Atlas/1.0 (https://github.com/daiyip/atlas; educational history map; fact check)"}
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(OUT, exist_ok=True)
EVENTS = len(sys.argv) > 2 and sys.argv[2] == "events"
EN, ZH = "https://en.wikipedia.org/wiki/", "https://zh.wikipedia.org/wiki/"
API = {"en": "https://en.wikipedia.org/w/api.php", "zh": "https://zh.wikipedia.org/w/api.php"}


def api(lang, **q):
    q.update(format="json", formatversion=2)
    url = API[lang] + "?" + urllib.parse.urlencode(q)
    for i in range(5):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
        except Exception as e:
            print("retry", e, file=sys.stderr); time.sleep(4 * (i + 1))
    return {}


def title_of(url, prefix):
    return urllib.parse.unquote(url[len(prefix):].split("#")[0]).replace("_", " ") if str(url or "").startswith(prefix) else None


text_cache = {}


def article(lang, title):
    """Whole plain text of an article (following redirects; zh converted to simplified), or ("", None)."""
    if not title: return "", None
    k = (lang, title)
    if k not in text_cache:
        q = dict(action="query", titles=title, redirects=1, prop="extracts|pageprops", explaintext=1)
        if lang == "zh": q["variant"] = "zh-cn"
        pg = (api(lang, **q).get("query", {}).get("pages") or [{}])[0]
        ok = pg.get("extract") and not pg.get("missing") and "disambiguation" not in pg.get("pageprops", {})
        text_cache[k] = (pg["extract"], pg["title"]) if ok else ("", None)
        time.sleep(0.05)
    return text_cache[k]


def year_re(y, lang):
    if lang == "zh":
        return rf"(?:前|公元前){-y}年" if y < 0 else rf"(?<![\d前]){y}年"
    if y < 0:
        return rf"(?<![\d,]){-y}(?:\s|&nbsp;)?(?:–\s*\d+\s*)?(?:BC|BCE|B\.C\.)|(?<![\d,]){-y}\s*[–-]\s*\d+\s*(?:BC|BCE)"
    return rf"(?<![\d,.]){y}(?![\d,])"


def passages(text, y, lang):
    out = []
    for m in re.finditer(year_re(y, lang), text):
        a, b = max(0, m.start() - 160), min(len(text), m.end() + 160)
        out.append(text[a:b].replace("\n", " "))
        if len(out) == 4: break
    return out


items = []  # (key, years, en title, zh title)
for e in json.load(open(os.path.join(ROOT, "data/events.json"))):
    if "check" in e and not EVENTS: continue
    ys = [e["year"]] + ([e["endYear"]] if e.get("endYear") not in (None, e["year"]) else [])
    items.append((e["id"], ys, title_of(e.get("source"), EN), title_of(e.get("source_zh"), ZH)))
seen = set()
for f in ([] if EVENTS else sorted(glob.glob(os.path.join(ROOT, "data/layers/*.json")))):
    D = json.load(open(f))
    for L in (D.values() if os.path.basename(f).startswith("world-") else [D]):
        for p in L.get("people", []):
            key = "|".join(map(str, ("p", p["name"], p.get("born"), p.get("died"))))
            if "check" in p or key in seen: continue
            seen.add(key)
            ys = [y for y in (p.get("born"), p.get("died")) if y is not None]
            items.append((key, ys, title_of(p.get("source"), EN) or p["name"], title_of(p.get("source_zh"), ZH) or p.get("name_zh")))
        for polity, rs in (L.get("rulers") or {}).items():
            for r in rs:
                key = f"{polity}|{r['name']}|{r['from']}|{r['to']}"
                if "check" in r or key in seen: continue
                seen.add(key)
                en = r.get("title") if r.get("title") and r["title"] != r["name"] and not r.get("rank") else r["name"]
                zh = [r.get("title_zh"), r.get("name_zh")]
                items.append((key, [r["from"], r["to"]], [en, r["name"]], zh))
print(len(items), "items", flush=True)

deep = {}
for n, (key, ys, en, zh) in enumerate(items):
    rec = {"hits": {}}
    for lang, cands in (("en", en), ("zh", zh)):
        for t in (cands if isinstance(cands, list) else [cands]):
            text, title = article(lang, t)
            if not title: continue
            rec[lang] = title
            rec["intro" if lang == "en" else "intro_zh"] = text[:1200 if EVENTS else 700]
            for y in ys:
                ps = passages(text, y, lang)
                if ps: rec["hits"].setdefault(str(y), []).extend(f"[{lang}] {p}" for p in ps)
            break
    deep[key] = rec
    if n % 200 == 0: print("items", n, flush=True)

json.dump(deep, open(os.path.join(OUT, "deep-events.json" if EVENTS else "deep.json"), "w"), ensure_ascii=False)
print("done", len(deep), "items,", sum(1 for d in deep.values() if d["hits"]), "with passages")
