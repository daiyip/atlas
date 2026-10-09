"""Build data/borders/*.geojson from the historical-basemaps world snapshots.

Usage: python3 tools/build_borders.py [cache_dir]
Needs shapely. Downloads source files from github.com/aourednik/historical-basemaps into cache_dir.

Each snapshot below picks a source year, renames polities (the source has typos and some
anachronistic labels), marks the Chinese dynasties as `focus`, and can merge or split polygons.
Splits use hand-drawn approximate lines and are marked `approx: true` in the output.
"""
import json, os, re, sys, urllib.request
from shapely.geometry import shape, box, mapping, Polygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "borders")
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, ".cache")
CLIP = box(60, 5, 150, 58)
SRC = "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_{}.geojson"

# Chinese names for neighbours that show up often.
ZH = {
    "Ruanruan": "柔然", "Göktürks": "突厥", "Khitans": "契丹", "Kara Khitai Khaganate": "西辽",
    "Bactria": "大夏", "Mauryan Empire": "孔雀帝国", "Gupta Empire": "笈多王朝", "Kushan Principalities": "贵霜",
    "Scythians": "塞种", "Saka Kingdom": "塞种诸国", "Turcik tribes": "丁零", "Zhangzhung Kingdom": "象雄",
    "Funan": "扶南", "Chen-La": "真腊", "Khmer Empire": "真腊 (吴哥)", "Cambodia": "柬埔寨",
    "Pagan": "蒲甘", "Bagan": "蒲甘", "Kingdom of Pagan": "蒲甘", "Pyu state": "骠国", "Ava": "缅甸 (东吁)",
    "Burma": "缅甸 (贡榜)", "Burmese kingdoms": "缅甸诸国", "Lan Na": "八百媳妇 (兰纳)", "Laotian states": "南掌 (老挝)",
    "Laos": "南掌 (老挝)", "Shan states": "掸邦", "Annam": "安南", "Sukhothai": "素可泰 (暹)", "Ayutthaya": "暹罗",
    "Rattanakosin Kingdom": "暹罗", "Dvaravati": "堕罗钵底", "Haripunjaya": "哈里奔猜", "Harapunchai": "哈里奔猜",
    "Champa City States": "占城", "Kanauj": "戒日王朝", "Palas": "波罗王朝", "Kingdom of Kashmir": "迦湿弥罗",
    "Kashmir and Ladakh": "克什米尔 · 拉达克", "Nepal": "尼泊尔", "Bhutan": "不丹", "Sultanate of Delhi": "德里苏丹国",
    "Mughal Empire": "莫卧儿帝国", "British Raj": "英属印度", "French Indochina": "法属印度支那", "Philippines": "吕宋",
    "Afghanistan": "阿富汗", "Oirat Confederation": "瓦剌", "Timurid Emirates": "帖木儿", "White Horde": "白帐汗国",
    "Khanate of the Golden Horde": "金帐汗国", "Khanate of Sibir": "西伯利亚汗国", "Tsardom of Muscovy": "沙俄",
    "Quazaq Khanate": "哈萨克汗国", "Kimek-Kipchak khaganate": "基马克 · 钦察", "Oghuz Turks": "乌古斯",
    "Samanid Empire": "萨曼王朝", "Khwarazmian dynasty": "花剌子模", "Taiwanese Tribes": "台湾诸部",
    "Tokugawa shogunate": "日本 (德川)", "Imperial Japan (Fujiwara)": "日本", "Shogun Japan (Kamakura)": "日本 (镰仓)",
    "Imperial Japan": "日本", "Yueban": "悦般", "Northern Liang": "北凉", "Thai Kingdoms": "掸泰诸部",
    "Tungusic Tribes": "女真诸部", "Kurykans": "骨利干", "Mon state": "孟人诸国", "Mon States": "孟人诸国",
    "Xiongnu": "匈奴", "Southern Xiongnu": "南匈奴", "Xianbei": "鲜卑", "Yuezhi": "月氏",
    "Tibetan Empire": "吐蕃", "Tibet": "吐蕃", "Tufan Empire": "吐蕃", "Uyghurs": "回鹘",
    "Göktürks": "突厥", "Western Gokturk Khaganate": "西突厥", "Koguryo": "高句丽", "Paekche": "百济",
    "Silla": "新罗", "Balhae": "渤海", "Goryeo": "高丽", "Joseon": "朝鲜", "Korea": "朝鲜",
    "Japan": "日本", "Yamato": "倭", "Nan-Zhao": "南诏", "Dali": "大理", "Champa": "林邑",
    "Đại Việt": "大越", "Liao": "辽", "Xixia": "西夏", "Western Xia": "西夏", "Jin": "金",
    "Khitan": "契丹", "Mongols": "蒙古", "Mongol Empire": "蒙古", "Chagatai Khanate": "察合台汗国",
    "Karluks": "葛逻禄", "Abbasid Caliphate": "阿拔斯王朝", "Sasanian Empire": "萨珊", "Tungus": "靺鞨",
    "Rouran": "柔然", "Nan-Yue": "南越", "Min-Yue": "闽越", "Wusun": "乌孙", "Gojoseon": "古朝鲜",
    "Han Zhao": "汉赵", "Sixteen Kingdoms": "十六国", "Toba Wei": "北魏", "Tuyuhun": "吐谷浑",
    "Russian Empire": "俄罗斯帝国", "Kazakh Khanate": "哈萨克汗国", "Dzungar Khanate": "准噶尔",
}

# Rough line along the Qinling and Huai River: north of it went to Jin (1127-1234),
# then to the Mongols. Used to split the source's undivided Song polygon.
HUAI_NORTH = Polygon([(80, 33.6), (104, 33.6), (106.5, 34.0), (108, 33.9), (110, 33.4), (112, 33.0),
                      (114, 32.6), (115.5, 32.6), (117, 33.0), (118.5, 33.4), (119.5, 34.0), (126, 34.0),
                      (140, 34.0), (140, 56), (80, 56)])

# Rough Three Kingdoms divisions inside the Eastern Han polygon (c. 230).
SHU = Polygon([(95, 18), (95, 34.6), (104, 34.6), (106.5, 33.8), (108.5, 32.6), (110.2, 31.2),
               (110.2, 29), (109, 26.5), (106.5, 24.5), (105.5, 18)])
WU = Polygon([(110.2, 29), (110.2, 31.2), (112, 31.4), (114, 31.5), (116, 31.8), (118, 32.1),
              (119.5, 32.5), (122, 32.6), (130, 32.6), (130, 10), (105.5, 10), (105.5, 18),
              (106.5, 24.5), (109, 26.5)])

# Western Regions under Chinese protectorates (approximate). Han: Tarim Basin oases.
# Tang: Anxi (Tarim) and Beiting (Turpan, Dzungaria). Qing: Xinjiang incl. the Ili valley.
WR_HAN = Polygon([(73.5, 36.5), (73.5, 40.5), (76, 41.5), (80, 42.3), (84, 42.5), (88, 43.5), (91, 43.5),
                  (93, 42.5), (93, 40.5), (89, 39), (85, 37), (80, 36.3), (77, 36.3)])
WR_TANG = Polygon([(73.5, 36.5), (73.5, 40.5), (75.5, 41.5), (80, 43), (83, 45.5), (87, 47.5), (91, 46.5),
                   (95, 44), (95.5, 42), (93.5, 40.5), (89, 39), (85, 37), (80, 36.3), (77, 36.3)])
HEXI = Polygon([(93, 39.5), (93.5, 40.5), (95.5, 42), (98, 41), (100.5, 39.5), (103, 38.2), (104, 37),
               (103.5, 36), (102, 36.5), (99.5, 38), (97, 39), (95, 39.2)])
XINJIANG_QING = Polygon([(73.5, 36.5), (73.5, 40.5), (75, 41.2), (79, 42.5), (79.5, 46), (80, 47.5), (83, 49),
                         (87, 49.2), (91, 46.5), (96, 42.6), (95.5, 40.5), (93, 39.5), (90, 37.5), (85, 36.2),
                         (80, 35.5), (77, 35.6)])

# Xianbei confederation on the Mongolian steppe after the Northern Xiongnu left (c. 90-300).
XIANBEI = Polygon([(88, 45), (92, 49), (100, 51.5), (110, 51), (118, 50), (123, 47), (124.5, 44), (121, 42.6),
                   (116, 42), (112, 41.5), (107, 41.3), (103, 41.6), (97, 42.6), (92, 43.8)])
# Nurhaci's Later Jin: Jianzhou and Haixi Jurchen lands (1616), plus Liaodong from 1621.
LATER_JIN = Polygon([(122.6, 41.6), (124, 40.7), (125.5, 40.6), (128, 41.8), (130.5, 42.6), (131, 45),
                     (128, 47), (124.5, 46.2), (123.5, 43.5), (123, 42.5)])
LIAODONG = Polygon([(121.8, 40.8), (121.2, 39.0), (122.3, 39.0), (124.3, 39.9), (124, 40.7), (122.6, 41.6),
                    (122.8, 42.3)])
MONGOLIA_EAST = box(96, 40.5, 130, 56)

# Qin's own extent after Tan Qixiang's Qin map (c. 210 BCE), where the c. 200 BCE source differs: Longxi up the Tao
# River to Lintao, where the Qin wall began; Liaodong out to the Yalu; Guilin and Xiang commanderies (Guangxi, where
# the Lingqu canal was dug in 214 BCE). Hainan was not taken until 110 BCE.
QIN_LONGXI = Polygon([(103.3, 34.2), (103.4, 35.0), (103.7, 35.6), (104.3, 35.9), (105.2, 36.2), (106.2, 36.6),
                      (106.3, 35.5), (105.0, 34.2)])
QIN_LIAODONG = Polygon([(122.8, 42.4), (124.3, 42.2), (125.4, 41.2), (124.4, 39.9), (123.5, 39.6), (122.3, 39.0),
                        (121.2, 39.0)])
QIN_LINGNAN = Polygon([(104.5, 23.0), (105.5, 24.6), (107.5, 25.3), (109.0, 26.2), (110.6, 26.3), (111.6, 25.0),
                       (111.5, 23.0), (110.0, 21.5), (108.0, 21.5), (106.5, 22.0)])
HAINAN = box(108.4, 18.0, 111.3, 20.15)

# Shang core (no Shang polygon in the source): middle and lower Yellow River plain.
SHANG = Polygon([(110.2, 33.0), (110.4, 36.4), (112.5, 37.8), (115, 38.6), (117.3, 37.6), (119, 36.4),
                 (118.4, 34.6), (116.8, 33.6), (114.5, 32.6), (112, 32.4)])

MING_NAMES = {"Ming Chinese Empire": ("Ming", "明", True), "Tibet": ("Ü-Tsang (Tibet)", "乌思藏", False),
              "Korea": ("Joseon", "朝鲜", False), "Japan": ("Japan", "日本", False), "Đại Việt": ("Đại Việt", "安南 (大越)", False)}

SNAPSHOTS = [
    # id, source year, {source name: (name, zh, focus)}, extra ops
    ("xia", "bc2000", {"Xia": ("Xia", "夏", True), "Thai": None}, {}),  # source "Thai" here is an anachronism
    ("shang", "bc1500", {"Zhoa": ("Zhou (vassal west)", "周方", False), "Sinic": None, "Wu": None},
     {"add": [("Shang", "商", True, SHANG)]}),
    ("western-zhou", "bc1000", {"Zhoa": ("Western Zhou realm", "西周", True), "Sinic": None,
                                "Wu": ("Wu", "吴", False)}, {}),
    ("qin", "bc200", {"Han Empire": ("Qin", "秦", True), "Min-Yue": ("Qin", "秦", True),
                      "Nan-Yue": ("Qin", "秦", True), "Thai": ("Qiang and southwestern peoples", "羌 · 西南夷", False)},
     {"claim": [("Qin", "秦", QIN_LONGXI), ("Qin", "秦", QIN_LIAODONG), ("Qin", "秦", QIN_LINGNAN)],
      "secede": [("Luoyue (Hainan)", "骆越", HAINAN)]}),
    ("western-han-early", "bc200", {"Han Empire": ("Han", "西汉", True),
                                    "Thai": ("Qiang and southwestern peoples", "羌 · 西南夷", False)}, {}),
    ("western-han", "bc1", {"Han": ("Han", "西汉", True)}, {"claim": [("Han", "西汉", HEXI)]}),
    ("western-han-wr", "bc1", {"Han": ("Han", "西汉", True)}, {"claim": [("Han", "西汉", HEXI), ("Protectorate of the Western Regions", "西域都护府", WR_HAN)]}),
    ("xin", "bc1", {"Han": ("Xin", "新", True)}, {"claim": [("Xin", "新", HEXI)]}),
    ("eastern-han", "200", {"Han": ("Han", "东汉", True)}, {"claim": [("Han", "东汉", HEXI)],
                                                             "neighbour": [("Xianbei", "鲜卑", XIANBEI)]}),
    ("eastern-han-wr", "200", {"Han": ("Han", "东汉", True)}, {"claim": [("Han", "东汉", HEXI), ("Protectorate of the Western Regions", "西域都护府", WR_HAN)],
                                                                "neighbour": [("Xianbei", "鲜卑", XIANBEI)]}),
    ("three-kingdoms", "200", {"Han": ("Wei", "魏", True)},
     {"split": [("Wei", SHU, "Shu Han", "蜀汉"), ("Wei", WU, "Wu", "吴")]}),
    ("western-jin", "300", {"Jin": ("Jin", "西晋", True)}, {"neighbour": [("Xianbei", "鲜卑", XIANBEI)]}),
    ("eastern-jin", "400", {"Jin": ("Eastern Jin", "东晋", True), "Sixteen Kingdoms": ("Sixteen Kingdoms", "十六国", False)}, {}),
    ("north-south", "500", {"Jin Empire": ("Southern Dynasties", "南朝", True),
                            "Toba Wei": ("Northern Wei", "北魏", True)}, {}),
    ("sui", "600", {"Sui Empire": ("Sui Empire", "隋", True)}, {}),
    ("tang-618", "700", {"Sui Empire": ("Tang Empire", "唐", True), "Paekche": ("Silla", "新罗", False),
                         "Koguryo": ("Balhae", "渤海", False), "Tufan Empire": ("Tibetan Empire", "吐蕃", False),
                         "Uyghurs": ("Western Turkic oasis states", "西域诸国", False)},
     {"claim": [("Tang Empire", "唐", HEXI)]}),
    ("tang-700", "700", {"Sui Empire": ("Tang Empire", "唐", True), "Göktürks": ("Second Turkic Khaganate", "后突厥", False), "Paekche": ("Silla", "新罗", False),
                         "Koguryo": ("Balhae", "渤海", False), "Tufan Empire": ("Tibetan Empire", "吐蕃", False),
                         "Uyghurs": None}, {"claim": [("Tang Empire", "唐", HEXI), ("Anxi and Beiting Protectorates", "安西 · 北庭都护府", WR_TANG)]}),
    ("tang-756", "800", {"Champa": ("Champa", "占城", False), "Tang Empire": ("Tang Empire", "唐", True), "Silia": ("Silla", "新罗", False),
                         "Nan Chao": ("Nan-Zhao", "南诏", False), "Parhae": ("Balhae", "渤海", False)},
     {"claim": [("Anxi and Beiting Protectorates", "安西 · 北庭都护府", WR_TANG)]}),
    ("tang-800", "800", {"Tang Empire": ("Tang Empire", "唐", True), "Silia": ("Silla", "新罗", False),
                         "Nan Chao": ("Nan-Zhao", "南诏", False), "Parhae": ("Balhae", "渤海", False)}, {}),
    ("five-dynasties", "900", {"Champa": ("Champa", "占城", False), "Tang Empire": ("Five Dynasties and Ten Kingdoms", "五代十国", True),
                               "Nan Chao": ("Nan-Zhao", "南诏", False)}, {}),
    ("northern-song", "1000", {"Song Empire": ("Song", "北宋", True), "Korea": ("Goryeo", "高丽", False),
                               "Annam": ("Jiaozhi (Đại Cồ Việt)", "交趾", False), "Champa": ("Champa", "占城", False), "Nan Chao": ("Dali", "大理", False),
                               "Tibet": ("Tibetan tribes", "吐蕃诸部", False)}, {}),
    ("southern-song-jin", "1200", {"Song Empire": ("Southern Song", "南宋", True), "Nan Chao": ("Dali", "大理", False),
                                   "Liao": ("Jin", "金", True), "Tibet": ("Tibetan tribes", "吐蕃诸部", False)},
     {"split": [("Southern Song", HUAI_NORTH, "Jin", "金")]}),
    ("southern-song-mongol", "1200", {"Song Empire": ("Southern Song", "南宋", True), "Nan Chao": ("Dali", "大理", False),
                                      "Liao": ("Mongol Empire", "蒙古", False), "Xixia": ("Mongol Empire", "蒙古", False),
                                      "Tibet": ("Tibetan tribes", "吐蕃诸部", False)},
     {"split": [("Southern Song", HUAI_NORTH, "Mongol Empire", "蒙古")]}),
    ("yuan-1271", "1200", {"Song Empire": ("Southern Song", "南宋", True), "Nan Chao": ("Yuan", "元", True),
                           "Liao": ("Yuan", "元", True), "Xixia": ("Yuan", "元", True),
                           "Tibet": ("Yuan", "元", True)},
     {"split": [("Southern Song", HUAI_NORTH, "Yuan", "元")]}),
    ("yuan", "1300", {"Great Khanate": ("Yuan", "元", True), "Champa": ("Champa", "占城", False), "Tibet": ("Yuan", "元", True)}, {}),  # Tibet under the Xuanzheng Yuan
    ("ming", "1500", MING_NAMES, {"split": [("Chagatai Khanate", MONGOLIA_EAST, "Mongols (Northern Yuan)", "北元 · 鞑靼")]}),
    ("ming-1616", "1500", MING_NAMES, {"split": [("Chagatai Khanate", MONGOLIA_EAST, "Mongols (Northern Yuan)", "北元 · 鞑靼")],
                                       "cede": [("Later Jin", "后金", LATER_JIN)]}),
    ("ming-1621", "1500", MING_NAMES, {"split": [("Chagatai Khanate", MONGOLIA_EAST, "Mongols (Northern Yuan)", "北元 · 鞑靼")],
                                       "cede": [("Later Jin", "后金", LATER_JIN.union(LIAODONG))]}),
    ("ming-1636", "1500", MING_NAMES, {"split": [("Chagatai Khanate", MONGOLIA_EAST, "Mongols (Northern Yuan)", "北元 · 鞑靼")],
                                       "cede": [("Qing (Later Jin)", "大清 (后金)", LATER_JIN.union(LIAODONG))]}),
    ("qing-1650", "1650", {"Manchu Empire": ("Qing", "清", True), "Tibet": ("Tibet", "西藏", False),
                           "central Asian khanates": ("Dzungar Khanate", "准噶尔汗国", False),
                           "Post-Ming Warlords": ("Southern Ming and Three Feudatories", "南明 · 三藩", False)}, {"split": [("Dzungar Khanate", MONGOLIA_EAST, "Khalkha Mongols", "喀尔喀")]}),
    ("qing-1683", "1715", {"Manchu Empire": ("Qing", "清", True), "Tibet": ("Tibet", "西藏", False),
                           "central Asian khanates": ("Dzungar Khanate", "准噶尔汗国", False)}, {}),
    ("qing-1720", "1715", {"Manchu Empire": ("Qing", "清", True), "Tibet": ("Qing", "清", True),
                           "central Asian khanates": ("Dzungar Khanate", "准噶尔汗国", False)}, {}),
    ("qing-1800", "1800", {"Qing Empire": ("Qing", "清", True), "central Asian khanates": ("Kazakh and Kokand khanates", "哈萨克 · 浩罕", False)},
     {"claim": [("Qing", "清", XINJIANG_QING)]}),
    ("qing-1900", "1900", {"Manchu Empire": ("Qing", "清", True)}, {}),
]

PALETTE = ["#8a6f9e", "#5f87a3", "#a07d5a", "#6f9460", "#a3727a", "#4f8f86", "#9a8a4a", "#7272a8", "#b0805f", "#7d6b5a"]
SKIP_LABEL = re.compile(r"hunter|marine|Finno|Paleo", re.I)


def load(year):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, f"world_{year}.geojson")
    if not os.path.exists(p):
        urllib.request.urlretrieve(SRC.format(year), p)
    return json.load(open(p))


def build(sid, year, renames, ops):
    groups = {}  # name -> {zh, focus, geoms, approx}
    for f in load(year)["features"]:
        n, g = f["properties"].get("NAME"), f["geometry"]
        if not n or not g:
            continue
        try:
            s = shape(g).buffer(0)
        except Exception:
            continue
        if not s.intersects(CLIP):
            continue
        s = s.intersection(CLIP)
        if s.is_empty or s.area < 0.05:
            continue
        if n in renames:
            if renames[n] is None:
                continue
            name, zh, focus = renames[n]
        else:
            name, zh, focus = n, ZH.get(n, ""), False
        grp = groups.setdefault(name, {"zh": zh, "focus": focus, "geoms": [], "approx": False})
        grp["geoms"].append(s)
    for name, zh, focus, poly in ops.get("add", []):
        groups[name] = {"zh": zh, "focus": focus, "geoms": [poly], "approx": True}
        for other in groups.values():  # carve the new polygon out of what it overlaps
            if other is not groups[name]:
                other["geoms"] = [g.difference(poly) for g in other["geoms"]]
    for src, cut, name, zh in ops.get("split", []):
        if src not in groups:
            continue
        whole = unary_union(groups[src]["geoms"])
        part = whole.intersection(cut)
        groups[src]["geoms"] = [whole.difference(cut)]
        groups[src]["approx"] = True
        tgt = groups.setdefault(name, {"zh": zh, "focus": groups[src]["focus"], "geoms": [], "approx": True})
        tgt["geoms"].append(part)
        tgt["approx"] = True
    # "neighbour": a non-dynasty polity drawn by hand; it never takes land from the dynasty.
    # "cede": a polity that takes land from anyone, including the dynasty (e.g. Later Jin from Ming).
    focus_union = unary_union([g for grp in groups.values() if grp["focus"] for g in grp["geoms"]] or [Polygon()])
    for name, zh, poly in ops.get("neighbour", []):
        poly = poly.difference(focus_union)
        for other in groups.values():
            if not other["focus"]:
                other["geoms"] = [g.difference(poly) for g in other["geoms"]]
        groups.setdefault(name, {"zh": zh, "focus": False, "geoms": [], "approx": True})["geoms"].append(poly)
    for name, zh, poly in ops.get("cede", []):
        for other in groups.values():
            other["geoms"] = [g.difference(poly) for g in other["geoms"]]
        groups.setdefault(name, {"zh": zh, "focus": False, "geoms": [], "approx": True})["geoms"].append(poly)
    # "secede": land a source polity holds but should not, given to a new polity; unlike "cede" it adds no land
    # beyond what the source features cover, so a box drawn over the sea keeps the coast.
    for name, zh, poly in ops.get("secede", []):
        part = unary_union([g for grp in groups.values() for g in grp["geoms"]] or [Polygon()]).intersection(poly)
        for other in groups.values():
            other["geoms"] = [g.difference(poly) for g in other["geoms"]]
        groups.setdefault(name, {"zh": zh, "focus": False, "geoms": [], "approx": True})["geoms"].append(part)
    for name, zh, poly in ops.get("claim", []):
        for other in groups.values():
            other["geoms"] = [g.difference(poly) for g in other["geoms"]]
        grp = groups.setdefault(name, {"zh": zh, "focus": True, "geoms": [], "approx": True})
        grp["geoms"].append(poly)
        grp["approx"] = True
    feats = []
    for name, grp in groups.items():
        u = unary_union(grp["geoms"]).simplify(0.03, preserve_topology=True)
        if u.is_empty or u.area < 0.05:
            continue
        big = max(u.geoms, key=lambda g: g.area) if hasattr(u, "geoms") else u
        pt = big.representative_point()
        props = {"name": name, "name_zh": grp["zh"], "focus": grp["focus"],
                 "label": [round(pt.x, 2), round(pt.y, 2)], "area": round(u.area, 1)}
        if grp["approx"]:
            props["approx"] = True
        if not grp["focus"]:
            props["color"] = PALETTE[sum(map(ord, name)) % len(PALETTE)]
        if "Protectorate" in name:
            props["color"] = "#6fae9c"  # lighter jade: ruled through a protectorate
        if SKIP_LABEL.search(name):
            props["nolabel"] = True
        feats.append({"type": "Feature", "properties": props, "geometry": mapping(u)})
    feats.sort(key=lambda f: f["properties"]["focus"])
    out = json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":"), ensure_ascii=False)
    out = re.sub(r"(\d+\.\d{3})\d+", r"\1", out)
    open(os.path.join(OUT, f"{sid}.geojson"), "w").write(out)
    focus = [f["properties"]["name_zh"] for f in feats if f["properties"]["focus"]]
    print(f"{sid:22s} {year:7s} {len(feats):3d} features, focus {focus}, {len(out)//1024} KB")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for sid, year, renames, ops in SNAPSHOTS:
        build(sid, year, renames, ops)
