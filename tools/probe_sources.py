"""Temporary probe: how much Wikidata knows about historical Chinese prefectures, and whether Harvard's
Temporal Gazetteer (TGAZ) can serve seats by year from a browser."""
import json, sys, time, urllib.parse, urllib.request
UA = {"User-Agent": "Atlas/1.0 (https://github.com/daiyip/atlas; educational history map)"}

def get(url, headers=False):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={**UA, "Origin": "https://atlas.daiyip.com"}), timeout=60)
        body = r.read()
        return (dict(r.headers), body) if headers else body
    except Exception as e:
        return ({"error": str(e)}, b"") if headers else str(e).encode()

def sparql(q):
    b = get("https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q, "format": "json"}))
    try: return json.loads(b)["results"]["bindings"]
    except Exception: print("SPARQL FAIL", b[:300]); return []

print("== Wikidata classes")
cands = {}
for term in ["commandery", "commandery of China", "prefecture of China", "zhou (country subdivision)", "fu (country subdivision)",
             "circuit (administrative division)", "jun (country subdivision)", "military prefecture", "superior prefecture",
             "independent department", "lu (administrative division)", "county of imperial China", "historical prefecture of China"]:
    r = json.loads(get("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({"action": "wbsearchentities", "search": term, "language": "en", "format": "json", "limit": 5})))
    for x in r.get("search", []):
        cands[x["id"]] = f'{x.get("label")} — {x.get("description", "")}'
for k, v in cands.items(): print(k, v)

ids = " ".join("wd:" + k for k in cands)
rows = sparql(f"""SELECT ?cls (COUNT(DISTINCT ?i) AS ?n) (COUNT(DISTINCT ?c) AS ?coord) (COUNT(DISTINCT ?s) AS ?start) (COUNT(DISTINCT ?e) AS ?end) WHERE {{
  VALUES ?cls {{ {ids} }} ?i wdt:P31 ?cls .
  OPTIONAL {{ ?i wdt:P625 ?co . BIND(?i AS ?c) }} OPTIONAL {{ ?i wdt:P571 ?x . BIND(?i AS ?s) }} OPTIONAL {{ ?i wdt:P576 ?y . BIND(?i AS ?e) }}
}} GROUP BY ?cls ORDER BY DESC(?n)""")
print("== counts per class: items, with coords, with inception, with dissolved")
for r in rows: print(r["cls"]["value"].split("/")[-1], cands.get(r["cls"]["value"].split("/")[-1], ""), r["n"]["value"], r["coord"]["value"], r["start"]["value"], r["end"]["value"])

# Items whose class has a Chinese label ending in 郡/州/府 and that have both coordinates and inception.
rows = sparql("""SELECT ?clsl (COUNT(DISTINCT ?i) AS ?n) (SUM(IF(BOUND(?co) && BOUND(?st), 1, 0)) AS ?full) WHERE {
  ?i wdt:P31 ?cls . ?cls rdfs:label ?clsl . FILTER(LANG(?clsl) = "zh" && REGEX(?clsl, "^(郡|州|府|路|军|直隶州|直隶厅|厅)$|郡$|^州 \\\\(|^府 \\\\(|朝.*(郡|州|府)$"))
  OPTIONAL { ?i wdt:P625 ?co } OPTIONAL { ?i wdt:P571 ?st }
} GROUP BY ?clsl ORDER BY DESC(?n) LIMIT 40""")
print("== by zh class label: items, with coords+inception")
for r in rows: print(r["clsl"]["value"], r["n"]["value"], r["full"]["value"])

print("== sample: 汉 commanderies with zh label")
rows = sparql("""SELECT ?i ?l ?co ?st ?en WHERE { ?i rdfs:label ?l . FILTER(LANG(?l)="zh") FILTER(?l IN ("长沙郡"@zh, "潭州"@zh, "长沙府"@zh, "京兆尹"@zh, "蜀郡"@zh, "益州"@zh, "成都府"@zh, "保德州"@zh, "火山军"@zh, "临安府"@zh))
  OPTIONAL { ?i wdt:P625 ?co } OPTIONAL { ?i wdt:P571 ?st } OPTIONAL { ?i wdt:P576 ?en } }""")
for r in rows: print(r["l"]["value"], r["i"]["value"].split("/")[-1], r.get("co", {}).get("value"), r.get("st", {}).get("value"), r.get("en", {}).get("value"))

print("== TGAZ")
for u in ["https://chgis.hudci.org/tgaz/placename?fmt=json&n=%E9%95%BF%E6%B2%99",
          "https://chgis.hudci.org/tgaz/placename?fmt=json&n=%E9%95%BF%E6%B2%99&yr=742",
          "https://chgis.hudci.org/tgaz/placename?fmt=json&yr=742&ftyp=jun",
          "https://chgis.hudci.org/tgaz/placename?fmt=json&yr=742",
          "https://maps.cga.harvard.edu/tgaz/placename?fmt=json&n=%E9%95%BF%E6%B2%99",
          "https://chgis.hudci.org/tgaz/"]:
    h, b = get(u, headers=True)
    print("--", u); print({k: v for k, v in h.items() if k.lower() in ("error", "content-type", "access-control-allow-origin")}); print(b[:1500].decode("utf8", "replace"))
