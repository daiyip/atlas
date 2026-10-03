#!/usr/bin/env python3
"""Build the Bible lands dataset in data/bible/ from Theographic Bible Metadata.

  tools/bible/fetch_sources.sh        # downloads the sources into tools/bible/src (not committed)
  python3 tools/bible/build_bible.py

Writes, in the same shapes as the China files one level up:
  data/bible/places.json   places with coordinates: id, name, name_zh, lon, lat, kind, precision, verses
  data/bible/events.json   events with a place: id, year, endYear, level, category, title(_zh), place(_zh),
                           lat, lon, summary(_zh) (the first verse, KJV and 和合本), refs, people, places
Hand-written files that this script leaves alone: data/bible/eras.json and data/bible/tours.json.
Chinese names of places and events come from tools/bible/zh.json (和合本 spellings).

Dates are Theographic's, which follow a traditional (Ussher-style) chronology, e.g. the Exodus in 1490 BC.
Theographic is CC BY-SA 4.0, so data/bible/ is shared under the same licence.
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
OUT = os.path.join(HERE, "..", "..", "data", "bible")

# Events shown at the first detail level (大事 / key events).
KEY = {
    "Creation of all things", "Abraham enters Canaan", "Abrahamic Covenant", "Joseph sold to Egypt",
    "Exodus from Egypt", "Crossing the Jordan into Canaan", "Reign of Saul", "Reign of Solomon",
    "Construction of Solomon's Temple", "Birth of Jesus", "Crucifixion and Burial", "Peter preaches at Pentecost",
    "Saul is converted", "First Missionary Journey", "Paul's Journey to Rome",
}
WAR = re.compile(r"\b(battle|war|defeat|siege|besieg|destroy|destruction|conquer|captur|attack|fight|slay|kill|massacre|fall of)", re.I)
POLITICS = re.compile(r"\b(reign|king|anoint|crown|judgeship|rule|throne|kingdom|governor|census|decree|council|trial|arrest)", re.I)
SOCIETY = re.compile(r"\b(birth|born|death|dies|marri|wedding|lifetime|burial|famine|sold|family)", re.I)


def load(name):
    return {r["id"]: r["fields"] for r in json.load(open(os.path.join(SRC, name), encoding="utf-8"))}


def year_of(s):
    m = re.match(r"^(-?)(\d+)", s)
    return int(m.group(2)) * (-1 if m.group(1) else 1)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def ranges(refs):
    """['Gen.12.4', 'Gen.12.5', 'Gen.12.6', 'Gen.13.1'] -> ['Gen.12.4-6', 'Gen.13.1']"""
    out = []
    for r in refs:
        b, c, v = r.split(".")
        if out and out[-1][:2] == [b, c] and out[-1][3] == int(v) - 1:
            out[-1][3] = int(v)
        else:
            out.append([b, c, int(v), int(v)])
    return [f"{b}.{c}.{v1}" + (f"-{v2}" if v2 != v1 else "") for b, c, v1, v2 in out]


def bible_text(name, simplify=False):
    """{'Gen.1.1': text} from a scrollmapper JSON Bible, books in canonical order."""
    books = json.load(open(os.path.join(SRC, "books.json"), encoding="utf-8"))
    osis = [b["fields"]["osisName"] for b in sorted(books, key=lambda b: b["fields"]["bookOrder"])]
    data = json.load(open(os.path.join(SRC, name), encoding="utf-8"))
    conv = None
    if simplify:
        import opencc  # pip install opencc-python-reimplemented
        conv = opencc.OpenCC("t2s")
    text = {}
    for bid, book in zip(osis, data["books"]):
        for c in book["chapters"]:
            for v in c["verses"]:
                t = v["text"].strip()
                if conv:
                    t = re.sub(r"\s+", "", conv.convert(t))
                text[f"{bid}.{c['chapter']}.{v['verse']}"] = t
    return text


def clip(t, n):
    return t if len(t) <= n else t[: n - 1].rstrip(" ,;:") + "…"


def main():
    zh = json.load(open(os.path.join(HERE, "zh.json"), encoding="utf-8"))
    places, events, people, verses = load("places.json"), load("events.json"), load("people.json"), load("verses.json")
    kjv, cuv = bible_text("KJV.json"), bible_text("ChiUn.json", simplify=True)

    def place_name(p):
        return p.get("displayTitle") or p["kjvName"]

    out_places = []
    for pid, p in places.items():
        if p.get("duplicate_of") or not p.get("latitude") or not p.get("longitude"):
            continue
        out_places.append({
            "id": p["placeLookup"], "name": place_name(p), "name_zh": zh["place_names"].get(place_name(p), ""),
            "lon": round(float(p["longitude"]), 4), "lat": round(float(p["latitude"]), 4),
            "kind": p.get("featureType", ""), "precision": p.get("precision", ""),
            "verses": p.get("verseCount", 0),
        })
    out_places.sort(key=lambda p: -p["verses"])

    out_events, seen = [], set()
    for e in sorted(events.values(), key=lambda e: e["sortKey"]):
        locs = [places[l] for l in e.get("locations", []) if l in places and places[l].get("latitude") and places[l].get("longitude")]
        if not locs:
            continue
        title = e["title"]
        eid = slug(title)
        if eid in seen:
            eid += f"-{e['eventID']}"
        seen.add(eid)
        refs = [r for _, r in sorted((int(verses[v]["verseID"]), verses[v]["osisRef"])
                                     for v in e.get("verses", []) if v in verses)]
        year = year_of(e["startDate"])
        ev = {"id": eid, "year": year}
        m = re.match(r"^(\d+)Y$", e.get("duration", ""))
        if m and int(m.group(1)) > 1:
            ev["endYear"] = year + int(m.group(1))
        loc = locs[0]
        ev.update({
            "level": 1 if title in KEY else 2 if "partOf" not in e else 3,
            "category": "war" if WAR.search(title) else "politics" if POLITICS.search(title)
                        else "society" if SOCIETY.search(title) else "culture",
            "title": title, "title_zh": zh["event_titles"].get(title, ""),
            "place": place_name(loc), "place_zh": zh["place_names"].get(place_name(loc), ""),
            "lat": round(float(loc["latitude"]), 4), "lon": round(float(loc["longitude"]), 4),
            "summary": clip(kjv.get(refs[0], ""), 240) if refs else "",
            "summary_zh": clip(cuv.get(refs[0], ""), 120) if refs else "",
            "refs": ranges(refs),
            "people": [people[p]["personLookup"] for p in e.get("participants", []) if p in people],
            "places": [l["placeLookup"] for l in locs],
            "states": [],
        })
        out_events.append(ev)

    os.makedirs(OUT, exist_ok=True)
    for name, data in [("places.json", out_places), ("events.json", out_events)]:
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"places: {len(out_places)}, events: {len(out_events)}"
          f" (level 1: {sum(e['level'] == 1 for e in out_events)}, missing zh titles: {sum(not e['title_zh'] for e in out_events)})")


if __name__ == "__main__":
    main()
