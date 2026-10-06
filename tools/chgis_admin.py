"""Turn CHGIS V6 time-series prefecture points (v6_time_pref_pts_utf_wgs84, from .github/workflows/chgis.yml) into
tools/.cache/chgis-admin.json, for checking our own drafted seats (tools/check_admin.py). Never commit or publish
the output: the CHGIS EULA forbids redistributing its layers.

    python3 tools/chgis_admin.py <folder with v6_time_pref_pts_utf_wgs84.shp>

Needs pyshp. Each record is one seat under one name and type for a span of years; renames and moves start a
new record (CHGIS's own change types are kept, so a card can say why). Records at one site are chained later in
the app (same place, one ends the year before the next starts).

Source: "CHGIS, Version 6." (c) Fairbank Center for Chinese Studies of Harvard University and the Center for
Historical Geographical Studies at Fudan University, 2016. Free for non-commercial academic and educational use;
the EULA forbids redistributing whole layers without the CHGIS Management Committee's written permission."""
import json, os, sys
import shapefile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
src = os.path.join(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools/.cache/chgis/pts"), "v6_time_pref_pts_utf_wgs84")

# Unit types: Chinese name, English name and level (1 province/circuit, 2 prefecture, 3 military/frontier office).
TYPES = {
    "郡": ("commandery", 2), "州": ("prefecture", 2), "府": ("superior prefecture", 2), "路": ("route", 2),
    "军": ("military prefecture", 2), "监": ("industrial prefecture", 2), "直隶州": ("independent department", 2),
    "直隶厅": ("independent sub-prefecture", 2), "厅": ("sub-prefecture", 2), "国": ("princely state", 2),
    "侯国": ("marquisate", 2), "王国": ("kingdom", 2), "尹": ("capital district", 2), "卫": ("guard", 3),
    "所": ("battalion", 3), "宣慰司": ("pacification commission", 3), "宣抚司": ("pacification office", 3),
    "安抚司": ("pacification office", 3), "招讨司": ("punitive office", 3), "长官司": ("chieftaincy", 3),
    "万户": ("myriarchy", 3), "万户府": ("myriarchy", 3), "镇": ("garrison", 3), "节度": ("military governor", 3),
    "都督": ("area command", 3), "都督府": ("area command", 3), "总管府": ("area command", 3), "指挥司": ("command", 3),
    "千户所": ("battalion", 3), "都监": ("inspectorate", 3), "章京辖区": ("jangin district", 3), "典农校尉": ("military farm", 3),
    "南部都尉": ("frontier commandant", 3), "属国都尉": ("dependent-state commandant", 3), "属国": ("dependent state", 2),
    "侨郡": ("émigré commandery", 2), "军民府": ("military-civil prefecture", 2), "道": ("circuit", 1), "省": ("province", 1),
    "县": ("county", 2), "直隶县": ("independent county", 2), "城": ("city", 2), "邑": ("town", 2), "卿": ("district", 2),
    # Nanzhao and Dali (南诏/大理) units keep their own words.
    "诏": ("zhao (Nanzhao principality)", 3), "苴": ("ju (Nanzhao district)", 3), "施": ("shi (Nanzhao district)", 3),
    "连": ("lian (Nanzhao district)", 3), "川": ("chuan (district)", 3), "逻": ("luo (district)", 3), "军民指挥使": ("military-civil command", 3), "将军辖区": ("general's district", 3),
}
CHANGE = {"新建": "new", "更名": "renamed", "撤销": "abolished", "治所迁移": "moved", "迁移治所": "moved",
          "更名和治所迁移": "renamed and moved", "更名和迁移治所": "renamed and moved", "辖区缩小": "area reduced",
          "辖区扩大": "area enlarged", "治所迁移且辖区扩大": "moved, area enlarged", "治所迁移且辖区缩小": "moved, area reduced",
          "更名且辖区扩大": "renamed, area enlarged", "数据下限": "", "数据下限暂作": "", "暂无": ""}

types, items = [], []
for r in shapefile.Reader(src, encoding="utf-8").records():
    r = r.as_dict()
    tz = (r["TYPE_CH"] or "").strip()
    # A few records carry pinyin, traditional characters or a stray code in the type.
    tz = {"Fu": "府", "軍民指揮使": "军民指挥使", "jp": "郡"}.get(tz, tz)
    if not tz or not r["X_COOR"] or r["BEG_YR"] is None or r["END_YR"] is None: continue
    if tz not in types: types.append(tz)
    beg, end = (r["BEG_CHG_TY"] or "").strip(), (r["END_CHG_TY"] or "").strip()
    # The data stops at 1911; a unit still there then runs on to the end of the Qing.
    to = None if end.startswith("数据下限") else int(r["END_YR"])
    items.append([r["NAME_CH"].strip(), r["NAME_PY"].strip(), types.index(tz), round(r["X_COOR"], 3), round(r["Y_COOR"], 3),
                  int(r["BEG_YR"]), to, (r["PRES_LOC"] or "").strip(), beg if CHANGE.get(beg) else "", end if CHANGE.get(end) else ""])
items.sort(key=lambda x: (x[5], x[3], x[4]))
out = {
    "source": "CHGIS, Version 6. (c) Fairbank Center for Chinese Studies of Harvard University and the Center for Historical Geographical Studies at Fudan University, 2016.",
    "fields": ["name_zh", "name", "type", "lon", "lat", "from", "to", "modern_zh", "begin", "end"],
    "types": [[tz, *TYPES.get(tz, (tz, 2))] for tz in types],
    "changes": {k: v for k, v in CHANGE.items() if v},
    "items": items,
}
path = os.path.join(ROOT, "tools/.cache/chgis-admin.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump(out, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
print(len(items), "seats", len(types), "types", os.path.getsize(path) // 1024, "KB")
