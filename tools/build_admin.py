"""Build data/admin.json, the administrative seats layer (政区: 郡/州/府/路/军… 治所), from the drafted snapshots in
tools/admin/<era id>_<year>.json: one main year per dynasty (秦 前210, 西汉 2, 唐 742, 清 1820 …), each listing the
period's prefecture-level units with their seats.

    python3 tools/build_admin.py

The snapshots are AI-drafted from general knowledge (not copied from any dataset) and were spot-checked against
CHGIS V6 privately (tools/check_admin.py); positions and years are approximate. Cards can look a seat up live in
CHGIS's Temporal Gazetteer (TGAZ), which is how the CHGIS data itself reaches the reader."""
import glob, json, os, re
from pypinyin import lazy_pinyin

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TYPES = {
    "郡": ("commandery", 2), "州": ("prefecture", 2), "府": ("superior prefecture", 2), "路": ("route", 2),
    "军": ("military prefecture", 2), "监": ("industrial prefecture", 2), "直隶州": ("independent department", 2),
    "直隶厅": ("independent sub-prefecture", 2), "国": ("princely state", 2), "王国": ("kingdom", 2),
    "尹": ("capital district", 2), "内史": ("capital district", 2), "属国": ("dependent state", 2), "宣慰司": ("pacification commission", 3),
}
PY_TYPE = {"郡": "Jun", "州": "Zhou", "府": "Fu", "路": "Lu", "军": "Jun", "监": "Jian", "直隶州": "Zhou",
           "直隶厅": "Ting", "国": "Guo", "王国": "Guo", "尹": "Yin", "内史": "Neishi", "属国": "Shuguo", "宣慰司": "Xuanweisi"}
CONF = {"high": 2, "medium": 1, "low": 0}


def pinyin(name, tz):
    """长沙郡 → Changsha Jun (the type word apart, as CHGIS and most atlases write it)."""
    base = name[:-len(tz)] if tz and name.endswith(tz) and len(name) > len(tz) else name
    if tz == "直隶州" and name.endswith("州"): base = name[:-1]
    if tz == "直隶厅" and name.endswith("厅"): base = name[:-1]
    s = "".join(lazy_pinyin(base)).capitalize()
    suffix = PY_TYPE.get(tz, "") if base != name else ""
    return f"{s} {suffix}".strip()


types, items = [], []
for path in sorted(glob.glob(os.path.join(ROOT, "tools/admin/*.json"))):
    era, snap = re.match(r"(.+)_(-?\d+)\.json$", os.path.basename(path)).groups()
    for x in json.load(open(path)):
        tz = x.get("type") or ""
        if tz not in types: types.append(tz)
        to = x.get("to")
        items.append([x["name_zh"], x.get("name") or pinyin(x["name_zh"], tz), types.index(tz), round(x["lon"], 3), round(x["lat"], 3),
                      int(x["from"]), None if to is None else int(to), x.get("modern_zh", ""), x.get("seat_zh", ""),
                      era, int(snap), CONF.get(x.get("confidence"), 1), x.get("state", "")])
items.sort(key=lambda r: (r[10], r[3], r[4]))
out = {
    "source": "AI-drafted from general knowledge, one main year per dynasty; spot-checked against CHGIS V6. Approximate.",
    "fields": ["name_zh", "name", "type", "lon", "lat", "from", "to", "modern_zh", "seat_zh", "era", "snap", "conf", "state"],
    "types": [[tz, *TYPES.get(tz, (tz, 2))] for tz in types],
    "items": items,
}
json.dump(out, open(os.path.join(ROOT, "data/admin.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print(len(items), "seats", os.path.getsize(os.path.join(ROOT, "data/admin.json")) // 1024, "KB")
