// Atlas: a data-driven 3D history map.
// Everything historical lives in data/: eras.json (time ranges + border snapshots per era),
// events.json (dated, located events), places.json (cities with the years they matter) and
// details/<era>.json (the longer story behind each event, loaded when the era is opened) and
// layers/<era>.json (map overlays for one era: rulers by polity, the armies of each battle, routes, people and
// capitals) and overlays.json (overlays that build up over time: population, religion & thought, inventions).
// Adding an era or an event means editing those files, not this code.
// Years are integers; negative years are BCE. Text fields come in pairs: `x` (English) and `x_zh`.

const BASE = document.baseURI.replace(/[^/]*([?#].*)?$/, "");
// Large generated assets (terrain and imagery packs, AI pictures) live in a Cloudflare R2 bucket, not in git
// (tools/upload_assets.py). Their names carry a content hash; data/tiles.json and data/ai-illustrations.json name them.
// For local work a mirror can stand in: localStorage["atlas-data-url"] = "http://localhost:8766".
const DATA_URL = (() => { try { return localStorage.getItem("atlas-data-url"); } catch { return null; } })() || "https://data.atlas.daiyip.com";
// Atlas's own files on R2 sit under atlas/; plugin apps keep theirs under apps/<id>/ (docs/data-updates.md#layout-on-r2).
const R2 = DATA_URL + "/atlas";
const BASE_PATH = new URL(BASE).pathname;
// Data packs: another site's history (eras, events, tours) shown on this engine's world map, opened with
// ?pack=<manifest URL>. Pack text ends up in the page, so packs load only from these sites (and a local
// server while developing). See docs/custom-data.md.
const PACK_ORIGINS = ["https://atlas.daiyip.com", "https://bible.daiyip.com", "https://gallery.daiyip.com", "https://daiyip.github.io"];
const PACK_URL = new URLSearchParams(location.search).get("pack");
// ?packonly=1 shows the pack alone; by default it is added to the atlas's own data.
const PACK_ONLY = PACK_URL && ["1", "true"].includes(new URLSearchParams(location.search).get("packonly"));
// ?embed=1: inside another site's page (an iframe) the atlas shows only the map and a small era label; the host page
// shows the story and drives the atlas through a pack plugin (docs/plugins.md, "Embedding").
const EMBED = new URLSearchParams(location.search).get("embed") === "1";
if (EMBED) document.documentElement.classList.add("embed");
// Overview elevation tiles are bundled with the page (it works offline and in sandboxed previews): zoom 2-6 as PNG files,
// zoom 7 (whole map) and 8 (China proper) packed into archives in tiles/pack/ and served through the
// "atlas" protocol below. Satellite imagery (Sentinel-2, 2020) is packed the same way in tiles/sat/, every zoom.
// Past the bundled zooms, tiles come from the original sources when the page can reach them (on atlas.daiyip.com it
// can): elevation from AWS Terrain Tiles (SRTM and others, about 30 m), imagery from EOX Sentinel-2 cloudless 2016
// (10 m, CC BY 4.0). Offline, or with ?offline=1, the bundled tiles are enlarged instead.
const LIVE = new URLSearchParams(location.search).get("offline") === "1" ? null : {
  dem: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  sat: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg",
};
const TILE_URL = "atlas://{z}/{x}/{y}";
const SAT_URL = "atlas://sat/{z}/{x}/{y}";
const SLIDER_MAX = 1000;

// Timeline zoom: the whole span (nonlinear, one band per dynasty), one dynasty, or a few decades.
// Each level also reveals finer events: an event's `level` is the zoom at which it first appears.
const ZOOMS = ["all", "era", "decades"];

const state = {
  eras: [], events: [], places: [],
  mode: "china",        // the region whose periods the timeline shows, or "world" for plain calendar years
  home: "china",        // the region the data belongs to: "china", or the open pack's id
  pack: null,           // the open data pack: { url, manifest, only }
  chinaEras: [], regions: [], regionById: {}, worldEras: [], worldIndex: [], raw: {},
  detail: 2, cats: [],   // event detail level shown (1 大事, 2 要事, 3 细目) and category tags (empty: all)
  range: { start: -2070, end: 1912 },
  year: -770,
  era: null,
  snapshot: null,       // borders path currently shown
  selected: "an-lushan",
  reading: false,       // story view open in the ledger
  tab: "events",        // ledger tab: "events" or "rulers"
  speed: 1,             // playback speed (SPEEDS)
  eraMin: false,        // era panel minimised
  railMin: false,       // timeline folded down to its play button
  narration: false,     // tour narration (off until switched on; remembered)
  voice: "Charon",      // narration voice: Charon (male) or Kore (female), Gemini TTS
  music: false,         // background music during tours and timeline playback (off until switched on; remembered)
  rulerPolity: null,    // country shown in the ruler list
  countries: null,      // data/countries.json: when each polity is on the map, and lineages joining renamed ones
  sel: null,            // the selected country: { id, names: Set, name, name_zh, spans, from, to } (selectCountry)
  scope: null,          // the reign the timeline is narrowed to: { polity, i, label }
  borders: {},          // borders path -> GeoJSON
  bundles: {},          // border bundle file -> promise of {map id: GeoJSON}
  details: {},          // era id -> promise of { event id -> detail }
  scale: [],            // [{era, p0, p1}] slider positions per era (zoom "all")
  zoom: 0,
  closedArmies: new Set(),
  win: null,            // [start, end] years shown on the rail when zoomed in
  lang: "zh",
  show3d: true, look: "satellite", flat3d: false, showNeighbours: true, showPlaces: true, showGeo: true, showAI: true,
  geo: [],              // labels for rivers, lakes, mountains, plains, seas
  layers: {},           // era id -> promise of { rulers, armies, routes }
  exchange: { routes: [], topics: {}, spread: [] }, // cross-civilisation routes and spreads (data/exchange.json)
  layerData: null,      // the current era's overlays once loaded
  auto: {},             // layers on only for the current story or tour step (syncAuto)
  autoOff: {}, autoCtx: "",
  autoLayers: true,
  show: { rulers: true, armies: true, routes: true, people: true, capitals: false, faith: false, inventions: false, passes: true, roads: true, clans: true, walls: true, exchange: true, spread: true, admin: false, climate: false },
  overlays: { population: [], faith: [], inventions: [] },
  passes: [],           // famous passes (关隘), data/passes.json
  roads: [],            // major official roads (官道), data/roads.json
  clans: [],            // local elite groups (豪族/士人集团), data/clans.json
  walls: [],            // Great Walls (长城) by period, data/walls.json
  climate: null,        // temperature sketch, warm/cold phases and disasters (气候与灾害), data/climate.json
  admin: null,          // administrative seats (郡/州/府… 治所), data/admin.json, loaded when first shown
  adminAreas: null,     // their sketch areas, data/admin-areas.json (Map by seat index), loaded with them
  playing: null,
};

const $ = (id) => document.getElementById(id);

/* ---------- language ---------- */

const UI = {
  zh: {
    title: "Atlas · 地图上的故事", events: "事件", hide: "收起", show: "展开", install: { title: "安装到主屏幕", why: "像 App 一样全屏打开，看过的地图离线也能用。", step1: (ipad, icon, other) => other ? `点地址栏里的分享按钮 ${icon}` : `点 Safari ${ipad ? "地址栏右侧" : "底部"}的分享按钮 ${icon}`, step2: "在菜单里选「添加到主屏幕」", go: "安装", ok: "知道了", never: "不再显示" }, minimise: "收起面板", restore: "展开面板", railHide: "收起时间轴", railShow: "展开时间轴", speed: "播放速度", fullscreen: "全屏", t3d: "3D 地形", sat: "卫星影像", neighbours: "周边政权", cities: "城市", geo: "山川", aiPics: "插图", music: "背景音乐", slimOn: "换成精简时间轴（只显示年份）", slimOff: "换成完整时间轴（显示朝代）",
    other: "English", map: "地图：", count: (n, era) => `${era} · ${n} 件`, countWin: (n) => `本时段 · ${n} 件`,
    fc: { ok: "已与维基百科/维基数据核对年份", fixed: "已更正", doubt: "存疑", none: "AI 撰写，尚未核对" },
    sm: { ok: "简介已与维基百科对照（AI 审读）", fixed: "简介已更正", doubt: "简介存疑" }, back: "返回列表", prev: "上一件", next: "下一件", why: "历史意义", people: "相关人物", aiIllu: "AI 生成的示意图，非史料", closePic: "关闭图片", wiki: "维基百科", wikiOther: "English Wikipedia",
    more: "阅读详情 →", loading: "正在载入…", noStory: "这件事的详细介绍还在编写中。",
    notePack: "疆域为近似示意，取自开源 Cliopatria（Seshat）与 historical-basemaps 数据集。地形、海岸线和河流均为现代地理。",
    note: "疆域为近似示意：取自开源 historical-basemaps 数据集，并参照谭其骧《中国历史地图集》人工修订。地形、海岸线和河流均为现代地理。",
    zooms: ["全部", "朝代", "数十年"], country: "国家", reignLen: (n) => `${n}年`, rulerCount: (n) => `${n} 位`, noRulers: "本时期暂无君主资料", worldMap: (y) => `${y}前后的世界`, worldName: "世界 · 公元纪年", noRegionEvents: "这个地区的事件还在整理中，下一步加入。现在可以看各时期的疆域。", noPeople: "本时期暂无人物资料", peopleHint: "点击人物，地图飞到其居所并显示生平", pgroups: { all: "全部", mil: "军事", pol: "政治", cul: "思想文学", art: "艺术", sci: "科技" }, scopeHint: "点击君主，时间轴缩放到其在位期间", zoomIn: "放大时间轴", zoomOut: "缩小时间轴", earlier: "向前", later: "向后",
    hint: ["点击朝代跳转 · 按 + 放大时间轴", (era) => `${era} · 每一段是一幅地图`, (era) => `${era} · 数十年视图`],
    play: "播放", pause: "暂停", year: "年份", loadError: "地图数据无法载入。",
    detail: "详略", levels: ["大事", "要事", "细目"], allCats: "全部", cat: { war: "战争", politics: "政治", reform: "改革", rebellion: "起义", culture: "文化", economy: "经济", diplomacy: "外交", science: "科技", society: "社会" },
    layers: "图层", settings: "设置", stStyle: "面板风格", stLook: "外观", stPanel: "面板颜色", stMapStyle: "地图样式", stRail: "时间轴", stRailStyle: "样式", stLayout: "布局", stAutoLayout: "自动布局", stAutoLayoutHint: "导览时转为导览布局，读故事时转为阅读布局，播放时转为一览，之后回到所选布局", stPins: "研究布局：固定两侧面板", stPinsHint: "取消固定后，面板收成屏幕边上的标签", pin: "固定面板", unpin: "取消固定", exLayers: "图层", stFull: "完整", stSlim: "精简", stDial: "拨盘", stDialLook: "拨盘样式", dialTap: "年 · 轻点播放", dialTapStop: "年 · 轻点暂停", dialLabel: "年份拨盘：按住转动，外圈换朝代，内圈换年份，轻点中心播放", stContent: "内容", stAI: "AI 插图", stNarr: "导览旁白", stOff: "关", stLang: "语言", stLocal: "设置只保存在这台设备上", stReset: "恢复默认", g_ai: "AI", g_map: "地图", g_look: "底图", g_pol: "政治", g_war: "军事", g_move: "交通", g_cul: "人文", g_pack: "专题", g_panel: "面板", panelOp: "不透明度", panelCustom: "自定义…", rulers: "君主", armies: "军队", routes: "路线", forces: "参战双方", ruler: "在位：",
    reign: (a, b) => `${a}–${b}年在位`, troops: "兵力", unknown: "不详", losses: "伤亡",
    result: { won: "胜", lost: "败", draw: "平" },
    units: { infantry: "步兵", cavalry: "骑兵", chariots: "战车", archers: "弓兵", crossbows: "弩兵", navy: "水军", siege: "攻城", firearms: "火器", artillery: "火炮", elephants: "象兵" },
    kinds: { campaign: "进军", journey: "行程", trade: "商路", canal: "运河", wall: "长城" }, exchange: "交流", spread: "传播", spreadGroups: { faith: "宗教传播", tech: "技术传播", crop: "作物传播" }, arrived: (y) => `${y}传到`, set_out: (y) => `${y}起`, world_t: "世界", worldHead: "同一年的世界", goRegion: "切换地区", allWorld: "全球", worldHint: "点击地区，地图和时间轴切换过去；点击事件阅读详情", noWorldEv: "前后几十年没有收录的大事", elsewhere: "同时期的世界", wsHead: (x) => `同时期的${x}`, wsNearShort: "邻国", wsWorld: "世界", wsNear: (n) => `${n}的邻国`, wsNone: "前后几年没有收录的大事", hideStrip: "隐藏", showStrip: "在时间轴上方显示同时期的世界",
    sel: { hint: "点击地图上的国家即可选中，地图和各栏只显示与它相关的内容；再点一次取消", off: "这一年不在地图上", offMap: "这一年的地图没有单独画出它", before: "这一年尚未建立", after: "这一年已不存在", jump: (y) => `跳到${y}`, events: (n) => `事件 ${n}`, people: (n) => `本时期人物 ${n}`, cities: "城市", clear: "取消选中", circa: "约", away: "已移出视野，时间轴仍跟随它", back: (n) => `回到${n}`, story: "播放它的故事", now: "今", more: (n) => `另 ${n} 国`, less: "收起" },
    people_l: "人物", climate: "气候灾害", climHead: "气候 · 华东气温", climNow: (a, p) => `较 1961–90 ${a >= 0 ? "暖" : "冷"} ${Math.abs(a).toFixed(1)}°C${p ? " · " + p : ""}`, climKinds: { drought: "旱灾", flood: "水灾", locust: "蝗灾", famine: "饥荒", quake: "地震", plague: "疫病", cold: "寒冬", river: "黄河决徙" }, climKey: { reb: "起义", cap: "迁都", dis: "灾害" }, climToll: "伤亡", climArea: "范围", climLinked: "相关事件 · 点击跳转", climAfter: "前后的起义与迁都", climPhase: "当时气候", climNote: "灾害与冷暖期为 AI 整理，未经核对；气温曲线为示意", climCurve: "气温曲线依竺可桢（1972）与葛全胜等（2013）的冷暖分期手绘示意，不是原始数据", climElse: "气候曲线只画中国东部", cmp: { one: "对比", open: "两地对比", sync: "同步视角", openTime: "两时对比", place: "两地", time: "两时", period: "时期", year: "年份", close: "关闭对比", pick: "对比地区", rulers: "君主", events: "前后大事", none: "前后几十年没有收录的大事" }, lasted: (n) => `共${n}年`, packs: "专题", rpMore: "这一年的君主、大事与国家", asState: "作为国家：", close: "关闭", search: "搜索", share: "分享这个视图", tours: "导览", toursHead: "导览 · 跟着地图读历史", tourStory: "读这段故事", tourMusic: " 音乐", tourNarr: " 旁白", tourNarrHint: "朗读每一站的解说（AI 语音，中文）", voices: { Charon: "男声", Kore: "女声" }, tourMusicHint: "导览和时间轴播放时的背景音乐（AI 生成）", tourImmersive: "沉浸", tourImmersiveHint: "放大图片，收起其它面板（Esc 退出）", tourBack: "返回导览", tourPrev: "上一步", tourNext: "下一步", tourPlay: "自动播放", tourPause: "暂停", tourEnd: "结束导览", tourDone: "导览结束", tourSteps: (n) => `${n} 站`, tourCount: (n) => `${n} 条导览`, followLife: "跟随一生", trail: "足迹", trailShow: "足迹", trailHint: "在地图上画出一生足迹，随时间轴移动", trailPrev: "上一站", trailNext: "下一站", trailBefore: (y) => `还没有出生。足迹从${y}开始，点“下一站”或拖动时间轴。`, trailAfter: "一生行迹到此为止。", livesHere: "本时期人物的一生", livesAll: "人物一生", tourAt: (n) => `第${n}站`, toursHere: "本时期导览", toursOther: "其他时期", noTours: "本时期还没有导览", tourHint: "点击一条导览，地图会跟着故事移动", linkCopied: "链接已复制，可以发给别人", linkCopy: "复制这个链接：", searchPh: "搜索导览、事件、人物、君主、城市或年份（如 755、前221）", autoLayers: "自动图层", autoHint: "打开事件或导览时，自动显示相关图层，自动打开的图层标为虚线", autoOn: "已自动显示", autoAlso: "相关图层", tipOn: "已打开", stLayBtn: "图层按钮", stLayPos: "图层排列", layBtns: { text: "文字", icon: "图标", both: "图标+文字" }, layPos: { group: "分组", nowrap: "一行·滑动", wrap: "一行·换行" }, tipOff: "已关闭", tipAuto: "自动显示", sgroups: { time: "时间", era: "朝代", tour: "导览", event: "事件", person: "人物", ruler: "君主", city: "城市", place: "地名" }, noResults: "没有找到相关内容", jumpYear: "跳到这一年", capitals: "都城·人口", faith: "宗教思想", inventions: "发明", passes: "关隘", admin: "政区", adminSeat: "治所", adminWas: "汉时旧名", adminSite: "此地历代 · 点击跳转", adminNow: "今", adminSnap: (y) => `以${y}为准 · AI 整理，已与 CHGIS 抽查比对`, adminUnsure: "位置待核", adminChgis: "查 CHGIS 记录", adminChgisWait: "正在查询 CHGIS…", adminChgisDown: "暂时连不上 CHGIS，稍后再试", adminChgisNone: "CHGIS 在这一年没有同名记录", adminChgisSrc: "来自 CHGIS 时空地名库（哈佛、复旦），实时查询", adminChgisMoved: "治所位置与本图略有不同", roads: "官道", walls: "长城", wallBy: "修筑", wallLen: (n) => `约${n.toLocaleString()}公里`, ruin: "已废弃，现为遗迹", clans: "豪族", ckinds: { gentry: "门阀士族", bloc: "地域集团", military: "军事集团", faction: "朋党", merchant: "商帮" }, seats: "郡望/根据地", families: "代表家族", members: "代表人物", drafted: "AI 整理，未经核对", cityEvents: (n) => `城中大事（${n}）· 点击跳转`, cityHere: (n, m) => n === m ? `城中大事 ${n} 件` : `这一段大事 ${n} 件 · 全城 ${m} 件`, cityNone: (m) => `这一段没有收录大事 · 点上方色条看其他时期（共 ${m} 件）`, cityTop: "要事", cityAll: "全部", gazHead: "地名古今 · 点击跳转", gazHeld: "属", gazIn: "约在", gazKind: "地名古今", gazNote: "由本图的城市、政区和疆域推算 · AI 整理，未经核对",  personEvents: (n) => `相关事件（${n}）· 点击跳转`, pranks: { capital: "都城", secondary: "陪都", major: "重要城市", port: "港口", frontier: "军事重镇" }, rkinds: { imperial: "驰道", post: "驿道", trade: "商道" }, via: "途经", inUse: "使用年代",
    fields: { general: "军事家", statesman: "政治家", thinker: "思想家", poet: "诗人", writer: "文学家", historian: "史学家", scientist: "科学家", physician: "医学家", engineer: "工程师", artist: "艺术家", religious: "宗教人物", explorer: "旅行家", scholar: "学者" },
    faiths: { buddhist: "佛教", daoist: "道教", confucian: "儒家", islam: "伊斯兰教", christian: "基督教", thought: "思想", other: "其他" },
    ifields: { craft: "工艺", writing: "文字", printing: "印刷", metallurgy: "冶金", military: "军事", astronomy: "天文", math: "数学", medicine: "医学", agriculture: "农业", navigation: "航海", engineering: "工程", money: "货币" },
    pop: "人口", popOf: (m, y, k) => { const w = Math.round(m * 100); return `${k === "estimate" ? "估计约" : "约"}${w >= 10000 ? (w / 10000).toFixed(1).replace(/\.0$/, "") + "亿" : w + "万"}（${y}）`; },
    capital: "都城", works: "代表作", life: (a, b) => `${a} – ${b}`, inventor: "发明者", pkinds: { pass: "山隘", wall: "长城关口", gate: "关口" }, guards: "扼守", battles: "关前史事", built: (y) => `${y}建`,
  },
  en: {
    title: "Atlas: Map with Stories", events: "Events", hide: "Hide", show: "Show", install: { title: "Add to Home Screen", why: "Opens full screen like an app, and maps you have seen work offline.", step1: (ipad, icon, other) => other ? `Tap the Share button ${icon} in the address bar` : `Tap Safari's Share button ${icon} ${ipad ? "next to the address bar" : "at the bottom"}`, step2: "Choose “Add to Home Screen”", go: "Install", ok: "Got it", never: "Don't show again" }, minimise: "Minimise panel", restore: "Restore panel", railHide: "Fold the timeline away", railShow: "Show the timeline", speed: "Playback speed", fullscreen: "Full screen", t3d: "3D terrain", sat: "Satellite", neighbours: "Neighbours", cities: "Cities", geo: "Landscape", aiPics: "Pictures", music: "Music", slimOn: "Switch to the slim timeline (years only)", slimOff: "Switch to the full timeline (with periods)",
    other: "中文", map: "Map: ", count: (n, era) => `${n} in ${era}`, countWin: (n) => `${n} in view`,
    fc: { ok: "Years checked against Wikipedia/Wikidata", fixed: "Corrected", doubt: "Doubtful", none: "AI-drafted, not yet checked" },
    sm: { ok: "Summary compared with Wikipedia (AI review)", fixed: "Summary corrected", doubt: "Summary doubtful" }, back: "All events", prev: "Previous", next: "Next", why: "Why it matters", people: "People", aiIllu: "AI-generated illustration, not a historical source", closePic: "Close picture", wiki: "Wikipedia", wikiOther: "中文维基百科",
    more: "Read the story →", loading: "Loading…", noStory: "The full story for this event is still being written.",
    notePack: "Borders are approximate, from the open Cliopatria (Seshat) and historical-basemaps datasets. Terrain, coastlines and rivers are modern.",
    note: "Borders are approximate: from the open historical-basemaps dataset, revised by hand after Tan Qixiang's Historical Atlas of China. Terrain, coastlines and rivers are modern.",
    zooms: ["All", "Dynasty", "Decades"], country: "Country", reignLen: (n) => `${n} yr${n > 1 ? "s" : ""}`, rulerCount: (n) => `${n} rulers`, noPeople: "No famous people listed for this period", peopleHint: "Click a person to fly to where they lived and read about them", pgroups: { all: "All", mil: "Military", pol: "Politics", cul: "Thought & letters", art: "Arts", sci: "Science" }, noRulers: "No rulers recorded for this period", worldMap: (y) => `the world around ${y}`, worldName: "World · calendar years", noRegionEvents: "Events for this region are still being written. For now you can follow its borders through the periods.", scopeHint: "Pick a ruler to narrow the timeline to their reign", zoomIn: "Zoom in", zoomOut: "Zoom out", earlier: "Earlier", later: "Later",
    hint: ["Click a dynasty to jump · + to zoom in", (era) => `${era} · each segment is one map`, (era) => `${era} · decades view`],
    play: "Play timeline", pause: "Pause timeline", year: "Year", loadError: "The map data could not be loaded. ",
    detail: "Detail", levels: ["Key", "Major", "All"], allCats: "All", cat: { war: "War", politics: "Politics", reform: "Reform", rebellion: "Uprising", culture: "Culture", economy: "Economy", diplomacy: "Diplomacy", science: "Science", society: "Society" },
    layers: "Layers", settings: "Settings", stStyle: "Panel style", stLook: "Appearance", stPanel: "Panel colour", stMapStyle: "Map style", stRail: "Timeline", stRailStyle: "Style", stLayout: "Layout", stAutoLayout: "Auto layout", stAutoLayoutHint: "A tour switches to Cinema, a story to Reader, playback to Glance, then back to your layout", stPins: "Explorer: pin both side panels", stPinsHint: "Unpinned panels fold to tabs on the screen edge", pin: "Pin panel", unpin: "Unpin panel", exLayers: "Layers", stFull: "Full", stSlim: "Slim", stDial: "Dial", stDialLook: "Dial look", dialTap: "tap to play", dialTapStop: "tap to pause", dialLabel: "Year dial: press and turn; the outer ring changes period, the inner ring the year; tap the centre to play", stContent: "Content", stAI: "AI pictures", stNarr: "Tour narration", stOff: "Off", stLang: "Language", stLocal: "Settings are kept on this device only", stReset: "Reset", g_ai: "AI", g_map: "Map", g_look: "Style", g_pol: "Power", g_war: "War", g_move: "Travel", g_cul: "Culture", g_pack: "Pack", g_panel: "Panels", panelOp: "Opacity", panelCustom: "Custom…", rulers: "Rulers", armies: "Armies", routes: "Routes", forces: "Forces", ruler: "Ruler: ",
    reign: (a, b) => `r. ${a}–${b}`, troops: "Troops", unknown: "unknown", losses: "Losses",
    result: { won: "Won", lost: "Lost", draw: "Draw" },
    units: { infantry: "Infantry", cavalry: "Cavalry", chariots: "Chariots", archers: "Archers", crossbows: "Crossbows", navy: "Navy", siege: "Siege", firearms: "Firearms", artillery: "Artillery", elephants: "Elephants" },
    kinds: { campaign: "Campaign", journey: "Journey", trade: "Trade route", canal: "Canal", wall: "Wall" }, exchange: "Exchange", spread: "Spread", spreadGroups: { faith: "Faith spreads", tech: "Technique spreads", crop: "Crop spreads" }, arrived: (y) => `arrived ${y}`, set_out: (y) => `from ${y}`, world_t: "World", worldHead: "The world this year", goRegion: "Go to region", allWorld: "Whole world", worldHint: "Click a region to move the map and timeline there; click an event to read it", noWorldEv: "No major events recorded within a few decades", elsewhere: "Elsewhere", wsHead: (x) => `Meanwhile · ${x}`, wsNearShort: "Neighbours", wsWorld: "World", wsNear: (n) => `Around ${n}`, wsNone: "No recorded events in these years", hideStrip: "Hide", showStrip: "Show other regions above the timeline",
    sel: { hint: "Click a country on the map to select it: the map and panels then show only what concerns it. Click it again to clear", off: "Not on the map in this year", offMap: "The map for this year doesn't draw it separately", before: "Not yet founded in this year", after: "No longer exists in this year", jump: (y) => `Go to ${y}`, events: (n) => `${n} events`, people: (n) => `${n} people this period`, cities: "Cities", clear: "Clear selection", circa: "c. ", away: "Out of view; the timeline still follows it", back: (n) => `Back to ${n}`, story: "Play its story", now: "today", more: (n) => `${n} more`, less: "Fewer" },
    people_l: "People", climate: "Climate & disasters", climHead: "Climate · E. China", climNow: (a, p) => `${Math.abs(a).toFixed(1)}°C ${a >= 0 ? "warmer" : "colder"} than 1961–90${p ? " · " + p : ""}`, climKinds: { drought: "Drought", flood: "Flood", locust: "Locusts", famine: "Famine", quake: "Earthquake", plague: "Epidemic", cold: "Severe cold", river: "Yellow River breach" }, climKey: { reb: "revolts", cap: "capital moves", dis: "disasters" }, climToll: "Toll", climArea: "Area", climLinked: "Related events · click to jump", climAfter: "Revolts and capital moves around it", climPhase: "Climate then", climNote: "Disasters and warm/cold phases AI-drafted, not source-checked; the temperature line is a sketch", climCurve: "The temperature line is hand-drawn after the warm and cold phases of Zhu Kezhen (1972) and Ge et al. (2013); not the published data", climElse: "The climate line covers eastern China only", cmp: { one: "Compare", open: "Compare regions", sync: "Sync view", openTime: "Compare times", place: "Two places", time: "Two times", period: "Period", year: "Year", close: "Close compare", pick: "Compare with", rulers: "Rulers", events: "Around this year", none: "No major events recorded within a few decades" }, lasted: (n) => `${n} years`, packs: "Packs", rpMore: "Rulers, events and countries this year", asState: "As a state: ", close: "Close", search: "Search", share: "Share this view", tours: "Tours", toursHead: "Guided tours", tourStory: "Read the story", tourMusic: " Music", tourNarr: " Narration", tourNarrHint: "Read each stop aloud (AI voice, in Chinese)", voices: { Charon: "Male", Kore: "Female" }, tourMusicHint: "Background music during tours and timeline playback (AI-generated)", tourImmersive: "Immersive", tourImmersiveHint: "Enlarge the picture and fold the other panels away (Esc to leave)", tourBack: "Back to the tour", tourPrev: "Back", tourNext: "Next", tourPlay: "Play", tourPause: "Pause", tourEnd: "End tour", tourDone: "End of tour", tourSteps: (n) => `${n} stops`, tourCount: (n) => `${n} tour${n === 1 ? "" : "s"}`, followLife: "Follow their life", trail: "Footsteps", trailShow: "Footsteps", trailHint: "Draw their whole life journey on the map; it moves with the timeline", trailPrev: "Previous", trailNext: "Next stop", trailBefore: (y) => `Not born yet. The journey starts in ${y}; press Next stop or drag the timeline.`, trailAfter: "The journey ends here.", livesHere: "Lives in this period", livesAll: "Lives", tourAt: (n) => `Stop ${n}`, toursHere: "Tours for this period", toursOther: "Other periods", noTours: "No tours for this period yet", tourHint: "Pick a tour and the map follows the story", linkCopied: "Link copied", linkCopy: "Copy this link:", searchPh: "Search tours, events, people, rulers, cities or a year (755, 221 BC)", autoLayers: "Auto layers", autoHint: "Reading an event or a tour stop switches on the layers it needs; those get a dashed outline", autoOn: "Switched on for this", autoAlso: "Related layers", tipOn: "On", stLayBtn: "Layer buttons", stLayPos: "Layer layout", layBtns: { text: "Text", icon: "Icon", both: "Icon + text" }, layPos: { group: "Groups", nowrap: "One row, scroll", wrap: "One row, wrap" }, tipOff: "Off", tipAuto: "On for this story", sgroups: { time: "Year", era: "Periods", tour: "Tours", event: "Events", person: "People", ruler: "Rulers", city: "Cities", place: "Place names" }, noResults: "Nothing found", jumpYear: "Go to this year", capitals: "Capitals", faith: "Faith", inventions: "Inventions", passes: "Passes", admin: "Prefectures", adminSeat: "Seat", adminWas: "Han name", adminSite: "This seat by dynasty · click to jump", adminNow: "Today", adminSnap: (y) => `As in ${y} · AI-drafted, spot-checked against CHGIS`, adminUnsure: "position uncertain", adminChgis: "Look up in CHGIS", adminChgisWait: "Asking CHGIS…", adminChgisDown: "CHGIS can't be reached right now; try again later", adminChgisNone: "No record of this name in CHGIS for this year", adminChgisSrc: "From the CHGIS Temporal Gazetteer (Harvard, Fudan), looked up live", adminChgisMoved: "its seat differs a little from this map", roads: "Roads", walls: "Great Walls", wallBy: "Built by", wallLen: (n) => `about ${n.toLocaleString()} km`, ruin: "Abandoned; ruins remain", clans: "Elites", ckinds: { gentry: "Great clans", bloc: "Regional bloc", military: "Military clique", faction: "Court faction", merchant: "Merchant guild" }, seats: "Home seats", families: "Families", members: "Key figures", drafted: "AI-drafted, not source-checked", cityEvents: (n) => `Events here (${n}) · click to jump`, cityHere: (n, m) => n === m ? `${n} events here` : `${n} events in this phase · ${m} in all`, cityNone: (m) => `No events recorded in this phase · tap the bar for other periods (${m} in all)`, cityTop: "Major", cityAll: "All", gazHead: "Names through time · click to jump", gazHeld: "held by", gazIn: "roughly in", gazKind: "Place through time", gazNote: "Worked out from this atlas's cities, prefectures and borders · AI-drafted, approximate", personEvents: (n) => `Related events (${n}) · click to jump`, pranks: { capital: "Capital", secondary: "Secondary capital", major: "Major city", port: "Port", frontier: "Military stronghold" }, rkinds: { imperial: "Imperial highway", post: "Post road", trade: "Trade road" }, via: "Via", inUse: "In use",
    fields: { general: "Military", statesman: "Statesman", thinker: "Thinker", poet: "Poet", writer: "Writer", historian: "Historian", scientist: "Scientist", physician: "Physician", engineer: "Engineer", artist: "Artist", religious: "Religious figure", explorer: "Traveller", scholar: "Scholar" },
    faiths: { buddhist: "Buddhism", daoist: "Daoism", confucian: "Confucianism", islam: "Islam", christian: "Christianity", thought: "Thought", other: "Other" },
    ifields: { craft: "Craft", writing: "Writing", printing: "Printing", metallurgy: "Metalwork", military: "Military", astronomy: "Astronomy", math: "Mathematics", medicine: "Medicine", agriculture: "Farming", navigation: "Navigation", engineering: "Engineering", money: "Money" },
    pop: "Population", popOf: (m, y, k) => `${k === "estimate" ? "c. " : ""}${m} million (${y})`,
    capital: "Capital", works: "Known works", life: (a, b) => `${a} – ${b}`, inventor: "Inventor", pkinds: { pass: "Mountain pass", wall: "Great Wall gate", gate: "Gate" }, guards: "Guards", battles: "Happened here", built: (y) => `built ${y}`,
  },
};
const t = (k) => UI[state.lang][k];
const zh = () => state.lang === "zh";
// Languages offered in the language menu: `short` labels the corner button, `name` is the language's own name.
// Adding one means adding it here plus its strings and data fields (text falls back to English where missing).
const LANGS = [
  { id: "zh", short: "中文", name: "简体中文", html: "zh-CN" },
  { id: "en", short: "EN", name: "English", html: "en" },
];
const langOk = (l) => LANGS.some((x) => x.id === l);
// Pick the field for the current language, falling back to the other one.
const cmp = { sync: true, on: false, region: null, map: null, marks: [], key: "" }; // compare view: second map and its region
const tx = (o, k) => (zh() ? o[k + "_zh"] || o[k] : o[k] || o[k + "_zh"]) || "";
const titleOf = (o) => (zh() ? o.title_zh || o.title : o.title);
const nameOf = (o) => (zh() ? o.name_zh || o.name : o.name);
// A region (a geographic area: 欧洲与地中海, 中国与东亚大陆) by its short name: 欧洲, 中国.
const regionShort = (r) => (zh() ? r.short_zh || r.name_zh : r.short || r.name);
const bandName = (e) => (zh() ? e.glyph : e.short || e.name); // the period on the timeline

function fmtYear(y, circa) {
  const n = y === 0 ? 1 : Math.abs(y);
  if (zh()) return `${circa ? "约" : ""}${y < 0 ? "前" : ""}${n}年`;
  return `${circa ? "c. " : ""}${n}${y < 0 ? " BCE" : ""}`;
}
function fmtYearParts(y) {
  const n = String(y === 0 ? 1 : Math.abs(y));
  if (zh()) return y < 0 ? ["前" + n, "年"] : [n, "年"];
  return [n, y < 0 ? "BCE" : "CE"];
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function applyLang() {
  const L = LANGS.find((x) => x.id === state.lang) || LANGS[0];
  document.documentElement.lang = L.html;
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  // A pack's own note replaces the China borders note.
  if (state.pack?.only) document.querySelector('[data-i18n="note"]').textContent = tx(state.pack.manifest, "note") || t("notePack");
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute("aria-label", el.title); });
  iconChips();
  setMinButton($("era-min"), !!state.eraMin);
  renderLayoutChips();
  setRailButton(!!state.railMin);
  setRailStyleButton();
  setMinButton($("ledger-min"), $("ledger").classList.contains("collapsed"));
  if (!$("settings").hidden) renderSettings();
  $("zoom-in").setAttribute("aria-label", t("zoomIn"));
  $("zoom-out").setAttribute("aria-label", t("zoomOut"));
  $("pan-prev").setAttribute("aria-label", t("earlier"));
  $("pan-next").setAttribute("aria-label", t("later"));
  $("slider").setAttribute("aria-label", t("year"));
  $("play").setAttribute("aria-label", state.playing ? t("pause") : t("play"));
  $("ledger-toggle").textContent = $("ledger").classList.contains("collapsed") ? t("show") : t("hide");
  if (typeof tourCard === "function" && state.tour) tourCard();
  $("search-open").title = $("search-open").ariaLabel = t("search");
  $("search-q").placeholder = t("searchPh");
  renamePackChips();
  if (state.regionById) renderRegionBtn();
}

async function setLang(lang) {
  state.lang = lang;
  popup?.remove();
  try { localStorage.setItem("atlas-lang", lang); } catch {}
  applyLang();
  setEra(state.era, true);
  buildRail();
  await setYear(state.year);
  buildEventMarkers();
  renderEventStates();
  renderPolityLabels(state.borders[state.snapshot]);
  renderPlaces();
  renderGeo();
  renderLookChips();
  renderPanelChip();
  renderLedger();
  updateCompare(true);
  emit("lang", { lang });
}

// A border file, or one map out of a bundle when the path ends in #<id> (tools/carve_states.py writes those).
async function loadBorders(path) {
  const [file, key] = path.split("#");
  if (!key) return loadJSON(file);
  const bundle = await (state.bundles[file] || (state.bundles[file] = loadJSON(file)));
  return bundle[key];
}

async function loadJSON(path) {
  // Revalidate, so a browser holding an older data file picks up the new one after a publish.
  const res = await fetch(BASE + path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

// Hypsometric tint: sea, lowland plains, loess and hills, plateau, high peaks.
// Plains read green, hills and loess tan, mountains brown, high plateau grey, peaks white.
const RELIEF = [
  "interpolate", ["linear"], ["elevation"],
  -6000, "#3d5a6c", -200, "#6c8f9f", -1, "#9db8bf",
  0, "#a9c98e", 100, "#b6d098", 300, "#d2d6a0", 700, "#dccb94", 1200, "#c9a878",
  2000, "#ad8a64", 3000, "#97795f", 4200, "#8f8582", 5200, "#c9c5c1", 6500, "#f7f5f2",
];

/* ---------- bundled elevation tiles ---------- */

// A tile from the live source, or null. After a run of failures (offline, blocked) the source is left alone.
const liveFails = { dem: 0, sat: 0 };
async function liveTile(kind, z, x, y) {
  if (!LIVE || liveFails[kind] >= 8) return null;
  try {
    const r = await fetch(LIVE[kind].replace("{z}", z).replace("{x}", x).replace("{y}", y), { signal: AbortSignal.timeout(8000) });
    if (r.ok) { liveFails[kind] = 0; return await r.arrayBuffer(); }
    if (r.status !== 404) liveFails[kind]++;
  } catch { liveFails[kind]++; }
  return null;
}

const packs = {};
// data/tiles.json maps each pack ("pack/4-0-0") to its current hashed file name on R2.
let tileNamesJob = null;
const tileNames = () => tileNamesJob ||= loadJSON("data/tiles.json").then((names) => {
  pruneKept(["/tiles/", "/atlas/tiles/", BASE_PATH + "tiles/"], Object.values(names).map((n) => "/atlas/tiles/" + n));
  return names;
}, () => ({}));
// The service worker keeps packs and pictures forever under their names. A file that changed has a new name, so once
// the current list is known, kept copies it no longer names (and copies from before R2) are dropped.
async function pruneKept(prefixes, keepPaths) {
  try {
    const keep = new Set(keepPaths), c = await caches.open("atlas-keep-v1");
    for (const req of await c.keys()) {
      const p = new URL(req.url).pathname;
      if (prefixes.some((x) => p.startsWith(x)) && !keep.has(p)) c.delete(req);
    }
  } catch {}
}
function loadPack(z, px, py, dir = "pack") {
  const key = `${dir}/${z}-${px}-${py}`;
  if (!(key in packs)) {
    // Each archive is wrapped in a 1x1 PNG (the host serves only standard file types); the archive itself sits in
    // a private "tpAk" chunk: a 4-byte index length, a JSON index {"x/y": [offset, length]}, then the tile PNGs.
    packs[key] = tileNames()
      .then((names) => names[key] && fetch(`${R2}/tiles/${names[key]}`))
      .then((r) => (r?.ok ? r.arrayBuffer() : null))
      .then((png) => {
        if (!png) return null;
        const v = new DataView(png);
        for (let o = 8; o + 8 <= png.byteLength; o += 12 + v.getUint32(o)) {
          if (String.fromCharCode(v.getUint8(o + 4), v.getUint8(o + 5), v.getUint8(o + 6), v.getUint8(o + 7)) !== "tpAk") continue;
          const start = o + 8, n = v.getUint32(start, true);
          return { buf: png, base: start + 4 + n, idx: JSON.parse(new TextDecoder().decode(new Uint8Array(png, start + 4, n))) };
        }
        return null;
      })
      .catch(() => null);
  }
  return packs[key];
}
// Elevation tiles: zooms 0-3 are one archive each, 4 and up in 8x8 blocks (the world to zoom 5, East Asia to 8).
async function demTile(z, x, y) {
  const sh = z <= 3 ? 31 : 3;
  const p = await loadPack(z, x >> sh, y >> sh);
  const e = p?.idx[`${x}/${y}`];
  if (e) return p.buf.slice(p.base + e[0], p.base + e[0] + e[1]);
  const live = z > 5 && await liveTile("dem", z, x, y);
  if (live) return live;
  // Not bundled at this zoom and not reachable live: enlarge a quarter of the parent tile. The heights are decoded, interpolated
  // bilinearly and encoded again (smoothing the colours themselves would mix them into nonsense, and plain
  // pixel doubling turns slopes into steps that the hillshade draws as stripes).
  if (z === 0) return null;
  const parent = await demTile(z - 1, x >> 1, y >> 1);
  if (!parent) return null;
  const bmp = await createImageBitmap(new Blob([parent], { type: "image/png" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = new OffscreenCanvas(256, 256);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const src = g.getImageData(0, 0, 256, 256).data;
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < h.length; i++) h[i] = src[i * 4] * 256 + src[i * 4 + 1] + src[i * 4 + 2] / 256;
  const out = g.createImageData(256, 256), d = out.data;
  const ox = (x & 1) * 128, oy = (y & 1) * 128;
  for (let j = 0; j < 256; j++) {
    const sy = Math.min(255, Math.max(0, oy + (j + 0.5) / 2 - 0.5)), y0 = Math.floor(sy), y1 = Math.min(255, y0 + 1), fy = sy - y0;
    for (let i = 0; i < 256; i++) {
      const sx = Math.min(255, Math.max(0, ox + (i + 0.5) / 2 - 0.5)), x0 = Math.floor(sx), x1 = Math.min(255, x0 + 1), fx = sx - x0;
      const v = (h[y0 * 256 + x0] * (1 - fx) + h[y0 * 256 + x1] * fx) * (1 - fy) + (h[y1 * 256 + x0] * (1 - fx) + h[y1 * 256 + x1] * fx) * fy;
      const k = (j * 256 + i) * 4, r = Math.floor(v / 256), gg = Math.floor(v - r * 256);
      d[k] = r; d[k + 1] = gg; d[k + 2] = Math.round((v - r * 256 - gg) * 256) & 255; d[k + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return (await c.convertToBlob({ type: "image/png" })).arrayBuffer();
}
// Satellite tiles: zooms 1-3 are one archive each, 4-8 in 8x8 blocks (the world to zoom 5, East Asia beyond),
// 9 (China proper) in 16x16; past the bundled zoom, a smoothly enlarged quarter of the parent.
async function satTile(z, x, y) {
  if (z < 1) return null;
  const sh = z >= 9 ? 4 : z >= 4 ? 3 : 31;
  const p = await loadPack(z, x >> sh, y >> sh, "sat");
  const e = p?.idx[`${x}/${y}`];
  if (e) return p.buf.slice(p.base + e[0], p.base + e[0] + e[1]);
  const live = z > 5 && await liveTile("sat", z, x, y);
  if (live) return live;
  if (z <= 1) return null;
  const parent = await satTile(z - 1, x >> 1, y >> 1);
  if (!parent) return null;
  const bmp = await createImageBitmap(new Blob([parent], { type: "image/jpeg" }));
  const c = new OffscreenCanvas(256, 256);
  c.getContext("2d").drawImage(bmp, (x & 1) * 128, (y & 1) * 128, 128, 128, 0, 0, 256, 256);
  return (await c.convertToBlob({ type: "image/jpeg", quality: 0.9 })).arrayBuffer();
}
const demJobs = new Map();
maplibregl.addProtocol("atlas", async (params) => {
  // A pack's base map tiles (see buildStyle) go through here too, so they load the same way as Earth's.
  const pk = params.url.match(/^atlas:\/\/pk-(dem|img)\/(\d+)\/(\d+)\/(\d+)$/);
  if (pk) {
    const src = state.basemap[pk[1] === "dem" ? "dem" : "imagery"];
    const r = await fetch(src.tiles.replace("{z}", pk[2]).replace("{x}", pk[3]).replace("{y}", pk[4]));
    if (!r.ok) throw new Error(`no tile ${params.url}`);
    return { data: await r.arrayBuffer() };
  }
  const sat = params.url.startsWith("atlas://sat/");
  const [z, x, y] = params.url.slice(sat ? "atlas://sat/".length : "atlas://".length).split("/").map(Number);
  // The hillshade and the 3D terrain read the same elevation tiles from two sources; fetch (or enlarge) each tile once.
  let job = sat ? null : demJobs.get(params.url);
  if (!job) {
    job = sat ? satTile(z, x, y) : demTile(z, x, y);
    if (!sat) {
      demJobs.set(params.url, job);
      const url = params.url, drop = () => demJobs.get(url) === job && demJobs.delete(url);
      job.then((d) => d || drop(), drop);
      if (demJobs.size > 64) demJobs.delete(demJobs.keys().next().value);
    }
  }
  const data = await job;
  if (!data) throw new Error(`no ${sat ? "imagery" : "elevation"} tile ${z}/${x}/${y}`);
  // MapLibre hands the buffer to a worker, which takes it over, so each caller gets its own copy.
  return { data: sat ? data : data.slice(0) };
});

// With 3D terrain a marker fades when a hill hides it. MapLibre checks that by reading pixels back from the GPU, one
// marker at a time, every 100 ms while the map moves; with a few hundred markers those reads stall every frame of a
// flight (each read waits for the GPU). Here markers keep their look while the map moves, and once it comes to rest
// all of them are checked from one read of the depth image.
const markerDepth = { queue: new Set(), timer: 0 };
{
  const P = maplibregl.Marker.prototype, own = P._updateOpacity;
  if (own) P._updateOpacity = function (force = false) {
    const m = this._map, terrain = m?.terrain;
    if (!terrain?.depthAtPoint || !terrain.painter || m.transform.isLocationOccluded(this._lngLat)) return own.call(this, force);
    if (!force && m.isMoving()) return;
    markerDepth.queue.add(this);
    markerDepth.timer ||= setTimeout(markerDepthCheck, 0);
  };
}
// Placing a marker on the terrain looks up its height, and MapLibre first works out which elevation tiles cover the
// view, once per marker and twice per frame. That answer is the same for every marker in a frame, so keep it per view.
function shareTerrainZoom(terrain) {
  const T = Object.getPrototypeOf(terrain);
  if (T.__sharedZoom || !T.getElevationForLngLat || !T.getElevationForLngLatZoom) return;
  T.__sharedZoom = true;
  const own = T.getElevationForLngLat;
  T.getElevationForLngLat = function (lnglat, tr) {
    const c = tr.center, key = `${tr.zoom} ${c.lng} ${c.lat} ${tr.pitch} ${tr.bearing} ${tr.width} ${tr.height} ${tr.elevation}`;
    const memo = this.__zoomMemo;
    if (memo?.key === key && memo.tr === tr && performance.now() - memo.t < 100) return this.getElevationForLngLatZoom(lnglat, memo.zoom);
    // Ask MapLibre once for this view and note the zoom it settles on.
    let zoom = null, v;
    this.getElevationForLngLatZoom = (ll, z) => { zoom = z; return T.getElevationForLngLatZoom.call(this, ll, z); };
    try { v = own.call(this, lnglat, tr); } finally { delete this.getElevationForLngLatZoom; }
    this.__zoomMemo = zoom === null ? null : { key, tr, zoom, t: performance.now() };
    return v;
  };
}
// With 3D terrain MapLibre paints the flat layers into one texture per terrain tile and keeps those textures while
// nothing changes. It decides that from a fingerprint per source, but also takes one for sources whose layers are all
// hidden (the flat styles' land, a switched-off overlay), which is then never matched, so every texture was painted
// again on every frame. This is MapLibre 5.24's preparation step with hidden layers left out. Style changes (showing a
// layer, a new filter) still clear the textures through MapLibre's own "style" data event.
const RTT_TYPES = { background: 1, fill: 1, line: 1, raster: 1, hillshade: 1, "color-relief": 1 };
function keepTerrainTextures(m) {
  const rt = m.painter?.renderToTexture, RT = rt && Object.getPrototypeOf(rt);
  if (!RT || RT.__keep || maplibregl.getVersion?.() !== "5.24.0") return;
  RT.__keep = true;
  // The texture pool reused an older free texture before making a new one, so with more than one stack of layers
  // (anything drawn live, like dots, splits the stack) each stack painted over the other's textures every frame.
  // Grow the pool first; reuse the least recently used texture only once it is full.
  const P = Object.getPrototypeOf(rt.pool), take = P.getOrCreateFreeObject;
  P.getOrCreateFreeObject = function () {
    if (this._objects.length < this._size) {
      const obj = this._createObject(this._objects.length);
      this._objects.push(obj);
      return obj;
    }
    return take.call(this);
  };
  RT.prepareForRender = function (style, zoom) {
    this._stacks = [];
    this._prevType = null;
    this._rttTiles = [];
    this._renderableTiles = this.terrain.tileManager.getRenderableTiles();
    this._renderableLayerIds = style._order.filter((id) => !style._layers[id].isHidden(zoom));
    this._coordsAscending = {};
    for (const id in style.tileManagers) {
      const asc = (this._coordsAscending[id] = {});
      const tm = style.tileManagers[id], ranges = tm.getSource().terrainTileRanges || null;
      for (const tileID of tm.getVisibleCoordinates()) {
        const keys = this.terrain.tileManager.getTerrainCoords(tileID, ranges);
        for (const key in keys) (asc[key] ||= []).push(keys[key]);
      }
    }
    this._rttFingerprints = {};
    for (const id of this._renderableLayerIds) {
      const source = style._layers[id].source;
      if (!RTT_TYPES[style._layers[id].type] || this._rttFingerprints[source]) continue;
      const fp = (this._rttFingerprints[source] = {});
      const revision = style.tileManagers[source]?.getState().revision ?? 0;
      for (const key in this._coordsAscending[source]) fp[key] = `${this._coordsAscending[source][key].map((c) => c.key).sort().join()}#${revision}`;
    }
    for (const tile of this._renderableTiles) {
      for (const source in this._rttFingerprints) {
        const fp = this._rttFingerprints[source][tile.tileID.key];
        if (fp && fp !== tile.rttFingerprint[source]) tile.rtt = [];
      }
    }
  };
}
function markerDepthCheck() {
  markerDepth.timer = 0;
  const list = [...markerDepth.queue].filter((mk) => mk._map?.terrain);
  markerDepth.queue.clear();
  if (!list.length) return;
  const m = list[0]._map, terrain = m.terrain, tr = m.transform, painter = terrain.painter, ctx = painter.context, gl = ctx.gl;
  const W = Math.floor(painter.width / devicePixelRatio), H = Math.floor(painter.height / devicePixelRatio);
  // Each marker is looked at where it stands and, if that is hidden, at its middle.
  const pts = list.map((mk) => [mk._pos, new maplibregl.Point(mk._pos.x, mk._pos.y - mk._offset.y)]);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (const p of pts.flat()) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, buf = new Uint8Array(Math.max(0, w * h * 4));
  if (w > 0) {
    ctx.bindFramebuffer.set(terrain.getFramebuffer("depth").framebuffer);
    gl.readPixels(x0, H - y1 - 1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    ctx.bindFramebuffer.set(null);
  }
  // Depth as MapLibre encodes it (terrain_depth.fragment.glsl); off screen counts as hidden.
  const depthAt = (p) => {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
    const k = ((y1 - y) * w + (x - x0)) * 4;
    return (buf[k] / 16777216 + buf[k + 1] / 65536 + buf[k + 2] / 256 + buf[k + 3]) / 256;
  };
  const near = 0.006;
  list.forEach((mk, i) => {
    const elev = terrain.getElevationForLngLat(mk._lngLat, tr);
    let hidden = tr.lngLatToCameraDepth(mk._lngLat, elev) - depthAt(pts[i][0]) >= near;
    if (hidden) {
      const up = (Math.sin((m.getPitch() * Math.PI) / 180) * -mk._offset.y) / tr.pixelsPerMeter;
      hidden = tr.lngLatToCameraDepth(mk._lngLat, elev + up) - depthAt(pts[i][1]) > near;
      if (hidden && mk._popup?.isOpen()) mk._popup.remove();
    }
    mk._element.style.opacity = hidden ? mk._opacityWhenCovered : mk._opacity;
    mk._element.classList.toggle("maplibregl-marker-covered", hidden);
  });
}

// Two looks: satellite colours with light shading, or the drawn relief map (hypsometric tint, stronger shading).
const SKY = {
  space: { "sky-color": "#05060a", "horizon-color": "#2a1d18", "fog-color": "#1a1412",
           "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.5, "atmosphere-blend": 0.4 },
  sat: { "sky-color": "#3f86c8", "horizon-color": "#cfe4f2", "fog-color": "#d6e6f0",
         "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.3, "atmosphere-blend": 0.8 },
  antique: { "sky-color": "#d8cfb8", "horizon-color": "#efe7d2", "fog-color": "#efe7d2",
             "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.4, "atmosphere-blend": 0.4 },
  dark: { "sky-color": "#0c1219", "horizon-color": "#26313b", "fog-color": "#1c242b",
          "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.4, "atmosphere-blend": 0.3 },
  relief: { "sky-color": "#a9c4d0", "horizon-color": "#e3ebe8", "fog-color": "#e3ebe8",
            "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.4, "atmosphere-blend": 0.5 },
};
// Relief is exaggerated more as you zoom in, so hills and ranges keep standing out at close range.
const terrainExaggeration = (z) => Math.min(5, 2 + Math.max(0, z - 5) * 0.9) * (state.basemap ? state.basemap.exaggeration ?? 1 : 1);
function setTerrainForZoom() {
  if (!state.show3d || (state.basemap && !state.basemap.dem)) return;
  const e = Math.round(terrainExaggeration(map.getZoom()) * 10) / 10;
  if (e === state.terrainExag) return;
  state.terrainExag = e;
  // Calling setTerrain again would rebuild the terrain and stall tile loading; adjust the live terrain instead.
  if (map.terrain) { map.terrain.exaggeration = e; map.triggerRepaint(); }
  // A flight that starts while the style is still being swapped (a new period's look) ends here before the style has
  // loaded, and setTerrain would throw; try again once the map is idle.
  else if (!map.isStyleLoaded()) { state.terrainExag = null; map.once("idle", setTerrainForZoom); return; }
  else map.setTerrain({ source: "dem-terrain", exaggeration: e });
  if (map.terrain) { shareTerrainZoom(map.terrain); keepTerrainTextures(map); }
}
// Map styles (底图). Each sets the land colours, the hillshade, the water and the sky; `flat` turns 3D off while it is
// chosen. ?style=<id> picks one on load (for embedders), and plugins can call atlas.setStyle(id).
const flatRelief = (sea, land) => ["interpolate", ["linear"], ["elevation"], -1, sea, 0, land, 9000, land];
const shade = (hi, lo) => [[hi, hi, hi, hi], [lo, lo, lo, lo]];
const LOOKS = {
  satellite: { name: "Satellite", name_zh: "卫星", swatch: "linear-gradient(135deg,#2c4a2a,#6b6a45 55%,#1d4f86 56%)", dark: true, sat: true,
    relief: RELIEF, bg: "#1d4f86", lakes: 0, river: "#4f86a3", sky: "sat",
    shadeEx: ["interpolate", ["linear"], ["zoom"], 3, 0.3, 6, 0.55, 8, 0.8],
    hi: ["rgba(255,244,214,0.5)", "rgba(255,244,214,0.35)", "rgba(255,244,214,0.2)", "rgba(255,244,214,0.35)"],
    lo: ["rgba(8,14,6,0.95)", "rgba(8,14,6,0.8)", "rgba(8,14,6,0.6)", "rgba(8,14,6,0.8)"] },
  terrain: { name: "Terrain", name_zh: "地形", swatch: "linear-gradient(135deg,#a9c98e,#dccb94 45%,#97795f 70%,#9db8bf 71%)",
    relief: RELIEF, bg: "#9db8bf", lakes: 0.9, lakeColor: "#86afc2", river: "#4f86a3", sky: "relief",
    shadeEx: ["interpolate", ["linear"], ["zoom"], 3, 0.45, 6, 0.6, 8, 0.7],
    hi: ["#fffdf5", "#fffdf5", "#fff8e8", "#fffdf5"], lo: ["#3a3328", "#4a3f33", "#3a3328", "#2e2a24"] },
  antique: { name: "Antique", name_zh: "古风", swatch: "linear-gradient(135deg,#efe4c8,#d9c49b 50%,#a98c63 70%,#b9c4b6 71%)",
    relief: ["interpolate", ["linear"], ["elevation"], -6000, "#a7ad98", -200, "#bdc1aa", -1, "#cfcfb6",
      0, "#f1e6c6", 300, "#eadbb2", 1000, "#dfc794", 2500, "#c9a874", 4500, "#ad8f68", 6500, "#e6dcc4"],
    bg: "#cfcfb6", lakes: 0.9, lakeColor: "#bdc1aa", river: "#7d8a72", sky: "antique",
    shadeEx: ["interpolate", ["linear"], ["zoom"], 3, 0.35, 6, 0.5, 8, 0.6],
    hi: ["#fbf5e4", "#fbf5e4", "#f6eed8", "#fbf5e4"], lo: ["#5b4630", "#6a5238", "#5b4630", "#4c3a28"] },
  plain: { name: "Simple", name_zh: "简洁", swatch: "linear-gradient(135deg,#f3f0e8 55%,#cfe0ea 56%)", flat: true,
    relief: flatRelief("#cfe0ea", "#f4f1e9"), land: "#f4f1e9", coast: "#a9bfcc", bg: "#cfe0ea", lakes: 1, lakeColor: "#cfe0ea", river: "#8fb3c9", sky: "relief", noShade: true },
  dark: { name: "Terrain · dark", name_zh: "地形·暗色", swatch: "linear-gradient(135deg,#2a3230,#3d4440 55%,#0f1a24 56%)", dark: true,
    relief: ["interpolate", ["linear"], ["elevation"], -6000, "#0a121a", -1, "#122030", 0, "#262d2b", 1500, "#2f3532", 4000, "#3c403c", 6500, "#5a5d5a"],
    bg: "#122030", lakes: 1, lakeColor: "#16283a", river: "#3f6f8c", sky: "dark",
    shadeEx: ["interpolate", ["linear"], ["zoom"], 3, 0.4, 6, 0.55, 8, 0.65],
    hi: ["rgba(255,255,255,0.18)", "rgba(255,255,255,0.12)", "rgba(255,255,255,0.08)", "rgba(255,255,255,0.12)"],
    lo: ["rgba(0,0,0,0.9)", "rgba(0,0,0,0.75)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.75)"] },
};
// Flat and quiet, for reading the data on top: charcoal land, navy sea, thin slate-blue rivers and lake outlines.
LOOKS.night = { name: "Simple · dark", name_zh: "简洁·暗色", swatch: "linear-gradient(135deg,#2b2a28 55%,#1c2333 56%)", dark: true, flat: true,
  relief: flatRelief("#1c2333", "#1c2333"), land: "#2b2a28", coast: "#4a4b50", bg: "#1c2333", lakes: 1, lakeColor: "#1c2333", lakeLine: 0.9, river: "#6f86b8", riverWidth: 0.7,
  sky: "dark", noShade: true };
// Menu order: each light style next to its dark twin.
const LOOK_ORDER = ["satellite", "terrain", "dark", "plain", "night", "antique"];
const OLD_LOOK = { sat: "satellite", relief: "terrain" };
const lookId = (v) => (LOOKS[v] ? v : OLD_LOOK[v] || null);
// Under a pack's base map only its own styles exist: its imagery (if any) and its elevation coloured by its `relief`.
function basemapLooks() {
  const B = state.basemap, out = {};
  if (B.imagery) out.satellite = { ...LOOKS.satellite, name: B.imagery.name || "Imagery", name_zh: B.imagery.name_zh || B.imagery.name || "影像",
    relief: B.relief ? reliefExpr(B.relief) : flatRelief(B.background || "#000", B.background || "#000"), bg: B.background || "#000", sky: "space" };
  if (B.dem) out.terrain = { ...LOOKS.terrain, name: B.reliefName || "Relief", name_zh: B.reliefName_zh || "地形",
    swatch: `linear-gradient(135deg,${(B.relief || []).map((r) => r[1]).join(",") || "#888,#ccc"})`,
    relief: B.relief ? reliefExpr(B.relief) : RELIEF, bg: B.background || "#000", sky: "space" };
  return out;
}
const reliefExpr = (stops) => ["interpolate", ["linear"], ["elevation"], ...stops.flat()];
const looks = () => (state.basemap ? basemapLooks() : LOOKS);
const lookOrder = () => (state.basemap ? Object.keys(basemapLooks()) : LOOK_ORDER);
function applyLook(m = map) {
  const L = looks()[state.look] || Object.values(looks())[0] || LOOKS.satellite;
  if (m === map || m === null) {
    document.documentElement.classList.toggle("sat", !!L.dark);
    document.documentElement.dataset.look = state.look;
  }
  if (!m?.getLayer("satellite")) return;
  m.setLayoutProperty("satellite", "visibility", L.sat ? "visible" : "none");
  // Earth's imagery covers the whole world, so under it the relief would only cost drawing time (a third of each
  // frame in 3D); a pack's own imagery may stop short, so the relief stays under that.
  m.setLayoutProperty("relief", "visibility", L.sat && !state.basemap ? "none" : "visible");
  m.setPaintProperty("relief", "color-relief-color", L.relief);
  m.setLayoutProperty("hillshade", "visibility", L.noShade ? "none" : "visible");
  if (!L.noShade) {
    m.setPaintProperty("hillshade", "hillshade-exaggeration", L.shadeEx);
    m.setPaintProperty("hillshade", "hillshade-highlight-color", L.hi);
    m.setPaintProperty("hillshade", "hillshade-shadow-color", L.lo);
  }
  m.setPaintProperty("lakes", "fill-opacity", L.lakes);
  for (const id of ["land", "coast"]) m.setLayoutProperty(id, "visibility", L.land ? "visible" : "none");
  if (L.land) {
    m.setPaintProperty("land", "fill-color", L.land);
    m.setPaintProperty("coast", "line-color", L.coast);
    if (!m._landLoaded) { m._landLoaded = true; m.getSource("land").setData(BASE + "data/geo/land.geojson"); }
  }
  m.setPaintProperty("lakes-line", "line-opacity", L.lakeLine || 0);
  m.setPaintProperty("rivers", "line-opacity", L.riverWidth ? 0.95 : 0.9);
  m.setPaintProperty("rivers", "line-width", L.riverWidth
    ? ["interpolate", ["linear"], ["zoom"], 3, ["case", ["<=", ["get", "rank"], 3], 1, 0.5], 8, ["case", ["<=", ["get", "rank"], 3], 2.4, 1.6]]
    : ["interpolate", ["linear"], ["zoom"], 3, ["case", ["<=", ["get", "rank"], 3], 1.2, 0.6], 8, ["case", ["<=", ["get", "rank"], 3], 4.5, 3]]);
  if (L.lakeColor) m.setPaintProperty("lakes", "fill-color", L.lakeColor);
  for (const id of ["rivers", "rivers-minor", "old-river"]) m.setPaintProperty(id, "line-color", L.river);
  m.setPaintProperty("bg", "background-color", L.bg);
  // 政区 area edges: cream over dark looks, ink over light ones.
  if (m.getLayer("admin-area-line")) m.setPaintProperty("admin-area-line", "line-color", L.dark ? "#f3e6c4"
    : ["match", ["get", "lv"], 3, "#2f5f8a", "#5a3d2a"]);
  m.setSky(state.basemap?.sky || SKY[L.sky]);
  if (state.basemap) {
    // Earth's own water and coast stay off; without elevation there is no relief to shade.
    if (state.basemap.earth === false) for (const id of ["rivers", "rivers-minor", "lakes", "lakes-line", "land", "coast", "old-river", "old-coast"]) m.setLayoutProperty(id, "visibility", "none");
    if (!state.basemap.dem) for (const id of ["relief", "hillshade"]) m.setLayoutProperty(id, "visibility", "none");
  }
}
// The map's style already dressed in the chosen look, so a reload doesn't first draw the default terrain colours and
// switch over once the map has loaded: applyLook is run against the style description instead of a live map.
function buildStyle() {
  const style = baseStyle(), layer = (id) => style.layers.find((l) => l.id === id);
  const shim = {
    getLayer: layer,
    setLayoutProperty: (id, k, v) => { const l = layer(id); if (l) (l.layout ||= {})[k] = v; },
    setPaintProperty: (id, k, v) => { const l = layer(id); if (l) (l.paint ||= {})[k] = v; },
    setSky: (sky) => { style.sky = sky; },
    getSource: (id) => ({ setData: (data) => { style.sources[id].data = data; } }),
  };
  applyLook(shim);
  return style;
}
// Picks a map style; a flat style turns 3D off and remembers whether it was on, so leaving it brings 3D back.
function setLook(id, remember = true) {
  id = lookId(id);
  if (!id || !looks()[id]) return false;
  const was = looks()[state.look], now = looks()[id];
  state.look = id;
  if (remember) try { localStorage.setItem("atlas-look", id); } catch {}
  if (now.flat && !was?.flat && state.show3d) { state.flat3d = true; set3d(false); }
  else if (!now.flat && was?.flat && state.flat3d) { state.flat3d = false; set3d(true); }
  applyLook();
  if (cmp.map && cmp.loaded) applyLook(cmp.map);
  renderLookChips();
  return true;
}
// The style button in the 地图 row shows the current style; its menu lists them all.
const lookSwatch = (L) => `<i style="background:${L.swatch}"></i>`;
function renderLookChips() {
  const btn = $("look-btn"), L = looks()[state.look] || Object.values(looks())[0];
  if (!btn) return;
  btn.innerHTML = `${lookSwatch(L)}<b>${esc(zh() ? L.name_zh : L.name)}</b><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  btn.title = t("g_look");
  if (!$("look-pop").hidden) toggleLookPop(true);
}
function toggleLookPop(open) {
  const pop = $("look-pop"), btn = $("look-btn");
  open ??= pop.hidden;
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", open);
  if (!open) return;
  pop.innerHTML = lookOrder().map((id) => [id, looks()[id]]).map(([id, L]) => `<button type="button" role="menuitemradio" aria-checked="${id === state.look}" data-look="${id}"><span>${lookSwatch(L)}<b>${esc(zh() ? L.name_zh : L.name)}</b></span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.3 2.2L9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>`).join("");
  // Fixed to the window (the layers panel clips on phones); opens upward when there is no room below.
  if (pop.parentNode !== document.body) document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(), h = pop.offsetHeight;
  pop.style.position = "fixed";
  pop.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6}px`;
  pop.style.left = `${Math.min(r.left, innerWidth - pop.offsetWidth - 8)}px`;
  pop.style.right = "auto";
  pop.querySelector('[aria-checked="true"]')?.focus();
}

// Panel colour and opacity (面板 row). "auto" keeps the built-in light/dark panel; a dark colour
// switches the interface to dark ink. Opacity applies to the era card, ledger, timeline and tour card.
const PANEL_COLORS = [
  { id: "auto", name: "Default", name_zh: "默认", swatch: "linear-gradient(135deg, #f7f9f8 50%, #151a1d 50%)" },
  { id: "#f7f9f8", name: "Light", name_zh: "浅色" },
  { id: "#ffffff", name: "White", name_zh: "雪白" },
  { id: "#f2e8d3", name: "Paper", name_zh: "宣纸" },
  { id: "#dce9e2", name: "Celadon", name_zh: "青瓷" },
  { id: "#151a1d", name: "Dark", name_zh: "深色" },
  { id: "#000000", name: "Black", name_zh: "纯黑" },
  { id: "#162a2b", name: "Teal ink", name_zh: "黛青" },
  { id: "#18213a", name: "Night blue", name_zh: "夜蓝" },
  { id: "#2e221b", name: "Umber", name_zh: "赭石" },
];
const hexOk = (c) => /^#[0-9a-f]{6}$/i.test(c || "") ? c.toLowerCase() : null;
const hexRgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hexDark = (c) => { const [r, g, b] = hexRgb(c).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18; };
function applyPanel() {
  const root = document.documentElement, st = root.style, c = state.panelColor;
  if (c === "auto") {
    for (const k of ["--panel-rgb", "--panel-solid"]) st.removeProperty(k);
    root.removeAttribute("data-theme");
  } else {
    st.setProperty("--panel-rgb", hexRgb(c).join(", "));
    st.setProperty("--panel-solid", c);
    root.dataset.theme = hexDark(c) ? "dark" : "light";
  }
  if (state.panelOp == null) st.removeProperty("--panel-op");
  else st.setProperty("--panel-op", String(state.panelOp));
  renderPanelChip();
}
function setPanel({ color = state.panelColor, op = state.panelOp } = {}) {
  state.panelColor = color;
  state.panelOp = op;
  applyPanel();
  try {
    localStorage.setItem("atlas-panel-color", color);
    if (op == null) localStorage.removeItem("atlas-panel-op"); else localStorage.setItem("atlas-panel-op", String(op));
  } catch {}
  emit("panel", { color, opacity: op });
}
const panelEntry = (c) => PANEL_COLORS.find((p) => p.id === c) || { id: c, name: "Custom", name_zh: "自定义" };
const panelSwatch = (p) => `<i style="background:${p.swatch || p.id}"></i>`;
function renderPanelChip() {
  const btn = $("panel-btn");
  if (!btn) return;
  const p = panelEntry(state.panelColor);
  btn.innerHTML = `${panelSwatch(p)}<b>${esc(zh() ? p.name_zh : p.name)}</b><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  btn.title = t("g_panel");
  // Unset opacity shows the built-in one (92% light, 90% dark).
  const op = Math.round(100 * (state.panelOp ?? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--panel-a")) || 0.92)));
  $("panel-op").value = op;
  $("panel-op-v").value = `${op}%`;
}
function togglePanelPop(open) {
  const pop = $("panel-pop"), btn = $("panel-btn");
  open ??= pop.hidden;
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", open);
  if (!open) return;
  const tick = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.3 2.2L9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const item = (p) => `<button type="button" role="menuitemradio" aria-checked="${p.id === state.panelColor}" data-panel="${p.id}"><span>${panelSwatch(p)}<b>${esc(zh() ? p.name_zh : p.name)}</b></span>${tick}</button>`;
  const custom = !PANEL_COLORS.some((p) => p.id === state.panelColor);
  const cur = hexOk(state.panelColor) || "#f7f9f8";
  pop.innerHTML = PANEL_COLORS.slice(0, 5).map(item).join("") + "<hr>" + PANEL_COLORS.slice(5).map(item).join("") + "<hr>"
    + `<button type="button" role="menuitemradio" aria-checked="${custom}" class="panel-custom"><span>${custom ? panelSwatch({ id: cur }) : "<i></i>"}<b>${esc(t("panelCustom"))}</b></span>${tick}<input type="color" value="${cur}" aria-label="${esc(t("panelCustom"))}"></button>`;
  if (pop.parentNode !== document.body) document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(), h = pop.offsetHeight;
  pop.style.position = "fixed";
  pop.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6}px`;
  pop.style.left = `${Math.min(r.left, innerWidth - pop.offsetWidth - 8)}px`;
  pop.style.right = "auto";
  pop.querySelector('[aria-checked="true"]')?.focus();
}
// Panel styles (设置 › 外观): each is a block of CSS under html[data-ui="<id>"] in style.css; "classic" sets none.
// The preview is a tiny drawing of the panels over a map: --p panel fill, --b edge, --r corner.
const UI_STYLES = [
  { id: "classic", name: "Classic", name_zh: "经典", preview: "--p:rgba(247,249,248,.95);--r:4px" },
  { id: "paper", name: "Paper", name_zh: "宣纸", preview: "--p:#f5eede;--b:#8a6a46;--r:1px" },
  { id: "glass", name: "Glass", name_zh: "毛玻璃", preview: "--p:rgba(20,24,30,.6);--b:rgba(255,255,255,.4);--r:6px" },
  { id: "editorial", name: "Editorial", name_zh: "简报", preview: "--p:#fff;--b:#111;--r:0" },
  { id: "lacquer", name: "Lacquer", name_zh: "漆金", preview: "--p:#1d1311;--b:#d8b46e;--r:2px" },
];
function setUIStyle(id, remember = true) {
  if (!UI_STYLES.some((u) => u.id === id)) id = "classic";
  state.ui = id;
  if (id === "classic") document.documentElement.removeAttribute("data-ui");
  else document.documentElement.dataset.ui = id;
  renderPanelChip();
  if (!remember) return;
  try { localStorage.setItem("atlas-ui", id); } catch {}
  emit("panelStyle", { style: id });
}
let savedUI = null;
try { savedUI = localStorage.getItem("atlas-ui"); } catch {}
setUIStyle(savedUI, false);

// Applied before the map loads so the panels never flash in the old colour.
try {
  state.panelColor = localStorage.getItem("atlas-panel-color") || "auto";
  const op = parseFloat(localStorage.getItem("atlas-panel-op"));
  state.panelOp = op >= 0.2 && op <= 1 ? op : null;
} catch {}
if (state.panelColor !== "auto" && !hexOk(state.panelColor)) state.panelColor = "auto";
state.panelOp ??= null;
applyPanel();

function baseStyle() {
  // A pack's own base map (another planet, an invented world) replaces Earth's elevation and imagery.
  const B = state.basemap;
  const dem = B?.dem ? { type: "raster-dem", tiles: ["atlas://pk-dem/{z}/{x}/{y}"], tileSize: B.dem.tileSize || 256, encoding: B.dem.encoding || "terrarium", maxzoom: B.dem.maxzoom ?? 6 }
    : { type: "raster-dem", tiles: [TILE_URL], tileSize: 256, encoding: "terrarium", maxzoom: 10 };
  const sat = B ? { type: "raster", tiles: B.imagery ? ["atlas://pk-img/{z}/{x}/{y}"] : [], tileSize: B.imagery?.tileSize || 256, maxzoom: B.imagery?.maxzoom ?? 6 }
    : { type: "raster", tiles: [SAT_URL], tileSize: 256, maxzoom: 10,
        attribution: "Imagery: Sentinel-2 2020, Copernicus/Sentinel Hub (CC BY 4.0); Sentinel-2 cloudless 2016 by EOX, s2maps.eu (CC BY 4.0)" };
  return {
    version: 8,
    sources: {
      dem, "dem-terrain": { ...dem }, sat,
      rivers: { type: "geojson", data: BASE + "data/geo/rivers.geojson" },
      lakes: { type: "geojson", data: BASE + "data/geo/lakes.geojson" },
      land: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      oldgeo: { type: "geojson", data: BASE + "data/geo/old-rivers.geojson" },
      borders: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      routes: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      spread: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      roads: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      clans: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      disasters: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      walls: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      admin: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      adminAreas: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    sky: SKY.relief,
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#9db8bf" } },
      { id: "relief", type: "color-relief", source: "dem", paint: { "color-relief-color": RELIEF } },
      // Natural Earth land (10m, simplified): flat styles draw it over the relief for a crisp coast.
      { id: "land", type: "fill", source: "land", layout: { visibility: "none" }, paint: { "fill-color": "#2b2a28" } },
      { id: "coast", type: "line", source: "land", layout: { visibility: "none", "line-join": "round" }, paint: { "line-color": "#55565a", "line-width": 0.8 } },
      { id: "satellite", type: "raster", source: "sat", layout: { visibility: "none" },
        paint: { "raster-fade-duration": 150, "raster-contrast": 0.08, "raster-saturation": 0.05 } },
      // Light from several directions so ranges read clearly whichever way they run.
      { id: "hillshade", type: "hillshade", source: "dem", paint: {
          "hillshade-method": "multidirectional",
          "hillshade-highlight-color": ["#fffdf5", "#fffdf5", "#fff8e8", "#fffdf5"],
          "hillshade-shadow-color": ["#3a3328", "#4a3f33", "#3a3328", "#2e2a24"],
          "hillshade-illumination-direction": [270, 315, 0, 45],
          "hillshade-illumination-altitude": [30, 30, 30, 30],
          "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 3, 0.45, 6, 0.6, 8, 0.7] } },
      // Modern rivers and lakes (Natural Earth); minor rivers appear as you zoom in.
      { id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": "#86afc2", "fill-opacity": 0.9 } },
      { id: "lakes-line", type: "line", source: "lakes", paint: { "line-color": "#7d8fb8", "line-width": 1.2, "line-opacity": 0 } },
      { id: "rivers-minor", type: "line", source: "rivers", minzoom: 4.5, filter: [">", ["get", "rank"], 5],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#4a82a0", "line-opacity": 0.85,
                 "line-width": ["interpolate", ["linear"], ["zoom"], 4.5, 0.5, 8, 2.2] } },
      // Old courses of the Yellow River and old shorelines, each shown in its own years (see renderOldGeo).
      { id: "old-coast", type: "line", source: "oldgeo", filter: ["==", ["get", "kind"], "none"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#d9f1ff", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.2, 8, 3], "line-dasharray": [1.5, 1.5], "line-opacity": 0.9 } },
      { id: "old-river", type: "line", source: "oldgeo", filter: ["==", ["get", "kind"], "none"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#4f86a3", "line-opacity": 0.95, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.6, 8, 5] } },
      { id: "rivers", type: "line", source: "rivers", filter: ["<=", ["get", "rank"], 5],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#4f86a3", "line-opacity": 0.9,
                 "line-width": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["<=", ["get", "rank"], 3], 1.2, 0.6], 8, ["case", ["<=", ["get", "rank"], 3], 4.5, 3]] } },
      { id: "neighbour-fill", type: "fill", source: "borders", filter: ["!", ["get", "focus"]],
        paint: { "fill-color": ["coalesce", ["get", "color"], "#6b5a7a"],
                 "fill-opacity": ["case", ["!=", ["get", "name_zh"], ""], 0.2, 0.07] } },
      { id: "neighbour-line", type: "line", source: "borders", filter: ["!", ["get", "focus"]],
        paint: { "line-color": "#4b4058", "line-width": 1, "line-opacity": 0.55, "line-dasharray": [3, 2] } },
      // States that carry their own colour (e.g. the Warring States) get it; dynasties use jade.
      { id: "focus-fill", type: "fill", source: "borders", filter: ["get", "focus"],
        paint: { "fill-color": ["coalesce", ["get", "color"], "#2c7a68"],
                 "fill-opacity": ["case", ["has", "color"], 0.34, 0.2] } },
      { id: "focus-casing", type: "line", source: "borders", filter: ["get", "focus"],
        paint: { "line-color": "#f6f3e8", "line-width": 5, "line-opacity": 0.7, "line-blur": 1 } },
      { id: "focus-line", type: "line", source: "borders", filter: ["get", "focus"],
        paint: { "line-color": "#b93a26", "line-width": ["case", ["has", "color"], 1.4, 2.2] } },
      // The selected country: every other state dimmed, its own edge in gold (applySelMap sets the filters).
      { id: "sel-dim", type: "fill", source: "borders", layout: { visibility: "none" }, paint: { "fill-color": "#141a1e", "fill-opacity": 0.45 } },
      { id: "sel-line", type: "line", source: "borders", filter: ["==", ["get", "name"], "\u0000"], layout: { "line-join": "round" },
        paint: { "line-color": "#f0b429", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 8, 5] } },
      // The states a tour step talks about (tourHighlight sets the filter).
      { id: "hl-fill", type: "fill", source: "borders", filter: ["==", ["get", "name_zh"], "\u0000"],
        paint: { "fill-color": "#f2c14e", "fill-opacity": 0.42 } },
      { id: "hl-line", type: "line", source: "borders", filter: ["==", ["get", "name_zh"], "\u0000"], layout: { "line-join": "round" },
        paint: { "line-color": "#f2c14e", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 6], "line-blur": 0.5 } },
      // Elite groups (豪族/士人集团): a soft tint over their home region with a dashed edge, coloured by kind.
      { id: "clan-fill", type: "fill", source: "clans", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.3 } },
      { id: "clan-line", type: "line", source: "clans", layout: { "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.95, "line-dasharray": [2, 1.5] } },
      // Disasters (气候与灾害): a soft tint over the stricken area, coloured by kind; faded once it is over.
      { id: "dis-fill", type: "fill", source: "disasters", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "past"], 0.05, 0.13] } },
      { id: "dis-line", type: "line", source: "disasters", layout: { "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-opacity": ["case", ["get", "past"], 0.35, 0.85], "line-dasharray": [1, 1.4] } },
      // Great Walls (长城): manned walls as a dark line with battlement ticks; abandoned ones as faint dashes.
      { id: "wall-ruin", type: "line", source: "walls", filter: ["==", ["get", "ruin"], true],
        paint: { "line-color": "#6b5a48", "line-opacity": 0.45, "line-width": 1.6, "line-dasharray": [2, 2] } },
      { id: "wall-casing", type: "line", source: "walls", filter: ["!=", ["get", "ruin"], true], layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#efe2c2", "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 8, 10] } },
      { id: "wall-line", type: "line", source: "walls", filter: ["!=", ["get", "ruin"], true], layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#5a4030", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 8, 5] } },
      { id: "wall-crenel", type: "line", source: "walls", filter: ["!=", ["get", "ruin"], true],
        paint: { "line-color": "#3a2a1e", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 8, 10], "line-dasharray": [0.4, 1.2] } },
      { id: "wall-hit", type: "line", source: "walls", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 14 } },
      // Official roads (官道): a pale casing with a dark brown line; trade roads dotted.
      { id: "road-casing", type: "line", source: "roads", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#f3e9cf", "line-opacity": 0.75, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 8, 8] } },
      { id: "road-line", type: "line", source: "roads", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["match", ["get", "kind"], "imperial", "#8a2f1c", "trade", "#7a5a1e", "#4a3424"],
                 "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2, 8, 4.5],
                 "line-dasharray": ["match", ["get", "kind"], "trade", ["literal", [1, 1.5]], ["literal", [1, 0]]] } },
      { id: "road-hit", type: "line", source: "roads", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 14 } },
      // Administrative seats (郡/州/府… 治所): small rings, frontier and military offices in slate; names come as
      // markers from zoom 5 on (renderAdminLabels).
      // Their rough areas (nearest seat, clipped to the period map): faint dashed edges, the open seat's area tinted.
      { id: "admin-area-on", type: "fill", source: "adminAreas", filter: ["==", ["get", "i"], -1],
        paint: { "fill-color": "#d9b45a", "fill-opacity": 0.3 } },
      { id: "admin-area-line", type: "line", source: "adminAreas", layout: { "line-join": "round" },
        paint: { "line-color": ["match", ["get", "lv"], 3, "#2f5f8a", "#5a3d2a"],
                 "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.5, 0, 4.5, 0.55, 7, 0.8],
                 "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 8, 1.6], "line-dasharray": [3, 2] } },
      { id: "admin-dot", type: "circle", source: "admin", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.8, 6, 3.5, 9, 5],
          "circle-color": "#f6efe0", "circle-opacity": 0.95,
          "circle-stroke-color": ["match", ["get", "lv"], 3, "#2f5f8a", 1, "#8a2f1c", "#5a3d2a"],
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 7, 1.8] } },
      // Routes: campaigns and journeys dashed, trade routes, canals and walls solid.
      { id: "route-casing", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#f6f3e8", "line-opacity": 0.8, "line-width": ["match", ["get", "kind"], "wall", 7, 6] } },
      { id: "route-solid", type: "line", source: "routes", filter: ["in", ["get", "kind"], ["literal", ["trade", "canal", "wall"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["match", ["get", "kind"], "trade", "#b8862b", "canal", "#2a7fb0", "#5a4636"],
                 "line-width": ["match", ["get", "kind"], "wall", 4, 3] } },
      { id: "route-dashed", type: "line", source: "routes", filter: ["in", ["get", "kind"], ["literal", ["campaign", "journey"]]],
        layout: { "line-join": "round" },
        paint: { "line-color": ["match", ["get", "kind"], "campaign", "#b93a26", "#2f5f8a"], "line-width": 3, "line-dasharray": [2, 1.2] } },
      { id: "spread-line", type: "line", source: "spread", filter: ["!=", ["geometry-type"], "Point"], layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-opacity": ["case", ["==", ["get", "live"], 1], 0.95, 0.4],
                 "line-width": ["case", ["==", ["get", "live"], 1], 3, 1.6] } },
      { id: "spread-dot", type: "circle", source: "spread", filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 3.5, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1, "circle-opacity": 0.85 } },
    ],
  };
}

let map;
const markers = { events: new Map(), places: [], polities: [], polityEls: [], armies: [], routes: [] };

/* ---------- world: regions and their periods ---------- */

// The timeline follows the region that fills the view (data/regions.json); across several regions or none it
// runs on plain calendar years. Periods outside China use the world maps (data/world/index.json).
const WORLD_STARTS = [-3000, -2000, -1000, -500, 1, 500, 1000, 1500, 1800, 1900];
const worldAt = (year) => { let w = null; for (const x of state.worldIndex) if (year >= x.from) w = x; return w || state.worldIndex[0]; };
function worldSnaps(start, end) {
  const idx = state.worldIndex, out = [];
  idx.forEach((x, i) => {
    const b = (idx[i + 1]?.from ?? Infinity) - 1;
    if (b >= start && x.from <= end) out.push({ from: Math.max(x.from, start), borders: x.full, world: true });
  });
  return out.length ? out : [{ from: start, borders: null, world: true }];
}
function setupRegions(eras, regions, worldIndex) {
  state.worldIndex = worldIndex;
  const byId = Object.fromEntries(eras.eras.map((e) => [e.id, { ...e, region: "china", layers: true }]));
  const period = (r, p) => byId[p.id] || { ...p, region: r.id, worldMaps: true, layers: !!p.layers, snapshots: worldSnaps(p.start, p.end) };
  state.regions = regions.map((r) => ({ ...r, eras: r.periods.map((p) => period(r, p)) }));
  state.regionById = Object.fromEntries(state.regions.map((r) => [r.id, r]));
  const china = state.regionById.china;
  state.chinaEras = china ? china.eras : Object.values(byId);
  if (!china) state.regions.unshift(state.regionById.china = { id: "china", name: "China", name_zh: "中国", eras: state.chinaEras, polygon: [] });
  state.range = regions.length ? { start: -3000, end: 2026 } : eras.range;
  const zy = (y) => (y < 0 ? `前${-y}` : `${y}`), ey = (y) => (y < 0 ? `${-y} BC` : `AD ${y}`);
  const span = (a, b) => [a < 0 ? `前${-a}–前${-b}年` : `${a}–${b}年`, a < 0 ? `${-a}–${-b} BC` : `AD ${a}–${b}`];
  state.worldEras = WORLD_STARTS.map((a, i) => {
    let b = (WORLD_STARTS[i + 1] ?? state.range.end + 1) - 1;
    if (b === 0) b = -1;
    const [name_zh, name] = span(a, b);
    return { id: `world${a}`, region: "world", start: a, end: b, seal: "公元", glyph: a === 1 ? "公元" : zy(a), short: ey(a), tiny: `${zy(a).replace("前", "-")}|`,
      name, name_zh, focus: [],
      summary: "The view spans several civilisations (or none), so the timeline runs on calendar years. Move or zoom into one and it switches to that civilisation's periods.",
      summary_zh: "地图上不止一个文明（或没有划定的文明区），时间轴按公元纪年；移动或放大到某个文明，时间轴就换成它的朝代与时期。",
      snapshots: worldSnaps(a, b) };
  });
  state.eras = state.chinaEras;
}
// A pack's periods form one more region, drawn on the world maps. On its own (packonly) it is the only region;
// otherwise it comes first, so inside its outline it wins over the atlas's regions.
function addPack(manifest, eras, worldIndex, only) {
  const id = manifest.id;
  const list = eras.eras.map((e) => ({ ...e, region: id, worldMaps: true, focus: e.focus || [], snapshots: worldSnaps(e.start, e.end) }));
  const R = manifest.region || {};
  const [[w, so], [ea, n]] = R.bounds || [[-180, -85], [180, 85]];
  const region = { id, name: manifest.name, name_zh: manifest.name_zh || manifest.name, color: manifest.color, eras: list,
    polygon: R.polygon || [[w, so], [ea, so], [ea, n], [w, n]] };
  const range = manifest.range || eras.range;
  if (only) {
    state.worldIndex = worldIndex;
    state.regions = [region];
    state.regionById = { [id]: region };
    state.chinaEras = list;
    state.worldEras = [];
    state.range = range;
    state.home = id;
  } else {
    state.regions.unshift(region);
    state.regionById[id] = region;
    state.range = { start: Math.min(state.range.start, range.start), end: Math.max(state.range.end, range.end) };
  }
  state.eras = list;
  state.mode = id;
}
/* ---------- data format versions ---------- */
// One number, the Atlas format, versions everything a pack can hold: its manifest, its data files (eras, events,
// tours, layers) and the plugin API. A pack's manifest says `"atlas": N`, the lowest format that can read it.
// FORMAT goes up when the atlas learns something a pack may rely on (a new field or file whose absence an older
// atlas would get wrong); fields an older atlas can safely ignore don't need a bump. The atlas reads every format up
// to its own: UPGRADES[n] turns format n into n + 1, so the rest of this file only ever sees the current shape.
// A newer pack is refused, unless the atlas page is simply stale (see checkDataFormat). A layer or plugin entry may
// carry its own `atlas` too: an optional extra that is skipped, not fatal, on an older atlas.
// FORMAT is separate from the app version (?v=, APP_VERSION): many releases share one format. The atlas's own data/
// declares its format in data/manifest.json. Each format and the app version that brought it: docs/custom-data.md#versions.
const FORMAT = 1;
const UPGRADES = {
  // n: { manifest(m), eras(d), events(d), tours(d) }, each returning format n + 1's shape. None yet.
};
const formatOf = (x) => (Number.isInteger(x?.atlas) && x.atlas > 0 ? x.atlas : 1);
// Too-new error, in the visitor's language.
function newerFormat(n) {
  const e = new Error(zh() ? `需要更新版本的 Atlas（数据格式 ${n}，本页支持到 ${FORMAT}）。请刷新页面。`
    : `This needs a newer Atlas (data format ${n}; this page reads up to ${FORMAT}). Try reloading the page.`);
  e.format = n;
  return e;
}
function upgradeManifest(m) {
  const n = formatOf(m);
  if (n > FORMAT) throw newerFormat(n);
  for (let v = n; v < FORMAT; v++) m = UPGRADES[v]?.manifest?.(m) ?? m;
  return { ...m, atlas: FORMAT, format: n };
}
// A pack data file (key: eras, events, tours), written in the pack's own format, brought up to FORMAT.
function upgradeFile(key, data, from) {
  for (let v = from; v < FORMAT; v++) data = UPGRADES[v]?.[key]?.(data) ?? data;
  return data;
}
// Optional manifest entries (layers, plugins) that need a newer format than this atlas are left out.
const fitsFormat = (entry) => {
  if (formatOf(entry) <= FORMAT) return true;
  console.warn(`Skipped ${entry.id || entry.src || "an entry"}: it needs Atlas format ${entry.atlas}, this page reads ${FORMAT}.`);
  return false;
};
// The atlas's own data/ moves with app.js, but a browser can still pair a cached old page with new data. Then the
// page reloads once to pick up the new code; if that doesn't help, it says so.
async function checkDataFormat() {
  const n = formatOf(await loadJSON("data/manifest.json").catch(() => null));
  if (n <= FORMAT) { try { sessionStorage.removeItem("atlas-format-reload"); } catch {} return; }
  let again = false;
  try { again = !sessionStorage.getItem("atlas-format-reload"); sessionStorage.setItem("atlas-format-reload", "1"); } catch {}
  if (again) {
    await navigator.serviceWorker?.getRegistration?.().then((r) => r?.update()).catch(() => {});
    location.reload();
    await new Promise(() => {});
  }
  throw newerFormat(n);
}

// Packs and plugins load only from this site, the sites in PACK_ORIGINS and a local server.
const allowedOrigin = (u) => u.origin === location.origin || PACK_ORIGINS.includes(u.origin) || ["localhost", "127.0.0.1"].includes(u.hostname);
// The manifest named by ?pack=, or null. Throws with a readable message when the pack cannot be used.
async function openPack(url) {
  let u;
  try { u = new URL(url, location.href); } catch { throw new Error(`"${url}" is not a pack address.`); }
  if (!allowedOrigin(u)) throw new Error(`Packs from ${u.origin} are not allowed.`);
  const res = await fetch(u, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load the pack (${res.status}).`);
  const manifest = upgradeManifest(await res.json());
  for (const k of ["eras", "events"]) if (!manifest.data?.[k]) throw new Error(`The pack has no ${k}.`);
  if (!/^[a-z0-9-]+$/.test(manifest.id || "")) throw new Error("The pack has no valid id.");
  return { url: u.href, manifest, only: PACK_ONLY };
}
// A file of the open pack by its manifest key (eras, events, tours, places).
function packFile(key) {
  const path = state.pack.manifest.data[key];
  if (!path) return Promise.reject(new Error(`The pack has no ${key}.`));
  return fetch(new URL(path, state.pack.url), { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`Could not load the pack's ${key} (${r.status})`);
    return r.json();
  }).then((d) => upgradeFile(key, d, state.pack.manifest.format));
}
// A pack's own pictures, narration and music (manifest "media", docs/custom-data.md#tour-media): indexes in the same
// shape as the atlas's (data/ai-illustrations.json, data/narration.json, data/music.json), whose file names sit under
// media.base/ai/, /narration/ and /music/ (an app's folder on R2, apps/<id>/). Each is merged into the atlas's own index
// with its file names made absolute, so the players need no second lookup. A missing or unreadable index is left out.
const MEDIA_DIRS = { pictures: "ai", narration: "narration", music: "music" };
async function packMedia(kind) {
  const M = state.pack?.manifest.media, path = M?.[kind];
  if (!path || !M.base) return null;
  let base;
  try { base = new URL(M.base.replace(/\/?$/, "/"), state.pack.url); } catch { return null; }
  if (!allowedOrigin(base) && !base.href.startsWith(DATA_URL + "/apps/")) return null;
  const idx = await fetch(new URL(path, state.pack.url), { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!idx) return null;
  const abs = (f) => new URL(`${MEDIA_DIRS[kind]}/${f}`, base).href;
  const fix = (o, keys) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, ...Object.fromEntries(keys.filter((x) => v[x]).map((x) => [x, abs(v[x])])) }]));
  if (kind === "pictures") return { keys: idx.keys || {}, images: fix(idx.images || {}, ["f"]) };
  return fix(idx, kind === "music" ? ["f"] : ["Charon", "Kore"]);
}
// A file of an index: its name under the atlas's folder, or a pack's absolute address.
const mediaSrc = (dir, f) => (/^https?:/.test(f) ? f : `${R2}/${dir}/${f}`);

// A link from an event or tour step to the pack's own page for it (the Bible pack: the verse in the reader).
function refLink(refs) {
  const R = state.pack?.manifest.refs;
  const ref = Array.isArray(refs) ? refs[0] : refs;
  if (!R?.url || !ref) return null;
  return { href: R.url.replace("{ref}", encodeURIComponent(ref)), label: (zh() && R.label_zh) || R.label || ref, ref };
}
function refLabel(ref) {
  return ref.replace(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)(?:-(\d+))?$/, (m, b, c, v, z) => `${b} ${c}:${v}${z ? "–" + z : ""}`);
}

/* ---------- pack layers and plugins ---------- */
// A pack can bring its own map layers: GeoJSON the engine draws and filters by year (manifest "layers"), and code
// (manifest "plugins": ES modules from the allowed sites) that gets the plugin API below. Each layer gets a switch in a
// "Pack" group of the layers panel, remembered per pack. See docs/plugins.md.
const PLUGIN_API = FORMAT; // the plugin API is part of the Atlas format
const hooks = {};           // event name -> handlers: year, lang, event, tour-step, tour-end
function emit(name, detail) {
  for (const fn of hooks[name] || []) {
    try { fn(detail); } catch (e) { console.error(`A plugin's "${name}" handler failed:`, e); }
  }
}
const packLayers = [];      // { def, ids: MapLibre layer ids, on, chip, onToggle }
const packLayerKey = () => `atlas-pack-layers:${state.pack?.manifest.id}`;
// A feature counts in years [from, to), like the old river courses; either end may be left out.
const packInYears = (y) => ["all", ["<=", ["coalesce", ["get", "from"], -1e6], y], [">", ["coalesce", ["get", "to"], 1e6], y]];
const GEOM = { fill: ["Polygon", "MultiPolygon"], line: ["LineString", "MultiLineString", "Polygon", "MultiPolygon"], circle: ["Point", "MultiPoint"] };

// One switch in the layers panel's "Pack" group (made on first use).
function packChip(def, on, onClick) {
  let g = $("lg-pack");
  if (!g) {
    g = document.createElement("div");
    g.className = "lg";
    g.id = "lg-pack";
    g.innerHTML = `<span data-i18n="g_pack">${esc(t("g_pack"))}</span>`;
    document.querySelector(".era-layers").appendChild(g);
  }
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.dataset.packLayer = def.id;
  b.setAttribute("aria-pressed", String(on));
  b.textContent = tx(def, "name") || def.id;
  b.addEventListener("click", onClick);
  g.append(b);
  return b;
}
function renamePackChips() {
  for (const L of packLayers) if (L.chip) L.chip.textContent = tx(L.def, "name") || L.def.id;
}
// Adds a GeoJSON layer drawn by the engine: polygons filled, lines and outlines stroked, points as dots.
// def: { id, name, name_zh, data (URL or GeoJSON), color, opacity, width, dash, radius, on, years: [from, to] }.
// Features may carry from/to (years), color, name/name_zh, text/text_zh and ref (a link through the pack's refs).
function addPackLayer(def, base) {
  if (!/^[a-z0-9-]+$/.test(def.id || "") || packLayers.some((L) => L.def.id === def.id)) throw new Error(`Layer id "${def.id}" is missing or taken.`);
  const src = `pk-${def.id}`;
  map.addSource(src, { type: "geojson", data: typeof def.data === "string" ? new URL(def.data, base).href : def.data || { type: "FeatureCollection", features: [] } });
  const color = ["coalesce", ["get", "color"], def.color || "#b93a26"];
  const paint = {
    fill: { "fill-color": color, "fill-opacity": def.opacity ?? 0.22 },
    line: { "line-color": color, "line-width": def.width ?? 2.5, "line-opacity": 0.9, ...(def.dash ? { "line-dasharray": def.dash } : {}) },
    circle: { "circle-color": color, "circle-radius": def.radius ?? 5, "circle-stroke-color": "#fff8ee", "circle-stroke-width": 1.5 },
  };
  const before = map.getLayer("tour-past") ? "tour-past" : undefined;
  const ids = [];
  for (const kind of def.type ? [def.type] : ["fill", "line", "circle"]) {
    const id = `${src}-${kind}`;
    map.addLayer({ id, type: kind, source: src, paint: paint[kind], layout: kind === "line" ? { "line-cap": "round", "line-join": "round" } : {},
      filter: ["in", ["geometry-type"], ["literal", GEOM[kind]]] }, before);
    map.on("click", id, (e) => { const f = e.features[0]; if (f && (f.properties.name || f.properties.text)) showCard(e.lngLat, packFeatureCard(f.properties)); });
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    ids.push(id);
  }
  return packEntry(def, ids);
}
// A pack layer's switch and remembered state; ids are its MapLibre layers (none for a plugin's plain toggle).
function packEntry(def, ids) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(packLayerKey()) || "{}"); } catch {}
  const L = { def, ids, on: saved[def.id] ?? def.on !== false };
  L.chip = def.chip === false ? null : packChip(def, L.on, () => setPackLayer(L, !L.on, true));
  packLayers.push(L);
  renderPackLayer(L);
  return L;
}
function setPackLayer(L, on, remember) {
  L.on = on;
  L.chip?.setAttribute("aria-pressed", String(on));
  if (remember) {
    try {
      const saved = JSON.parse(localStorage.getItem(packLayerKey()) || "{}");
      saved[L.def.id] = on;
      localStorage.setItem(packLayerKey(), JSON.stringify(saved));
    } catch {}
  }
  renderPackLayer(L);
  L.onToggle?.(on);
}
function renderPackLayer(L) {
  const y = state.year, [a, b] = L.def.years || [];
  const vis = L.on && !(a != null && y < a) && !(b != null && y >= b) ? "visible" : "none";
  for (const id of L.ids) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, "visibility", vis);
    map.setFilter(id, ["all", ["in", ["geometry-type"], ["literal", GEOM[id.slice(id.lastIndexOf("-") + 1)]]], packInYears(y)]);
  }
}
const renderPackLayers = () => packLayers.forEach(renderPackLayer);
function packFeatureCard(p) {
  const r = refLink(p.ref);
  const years = p.from != null || p.to != null ? `<p class="pc-meta">${p.from != null ? fmtYear(p.from) : ""} – ${p.to != null ? fmtYear(p.to) : ""}</p>` : "";
  return `<h4>${esc(tx(p, "name") || "")}</h4>${years}${p.text ? `<p>${esc(tx(p, "text"))}</p>` : ""}` +
    (r ? `<p class="pc-meta"><a href="${esc(r.href)}" target="_blank" rel="noopener" title="${esc(r.label)}">${esc(refLabel(r.ref))} ↗</a></p>` : "");
}

// What a plugin gets: the map, read-only state, events, and a few ways to move the atlas and add to it.
function pluginApi(src) {
  const base = new URL(".", src).href;
  return {
    version: PLUGIN_API,
    map,
    maplibregl,
    pack: state.pack.manifest,
    get year() { return state.year; },
    get era() { return state.era && { id: state.era.id, name: state.era.name, name_zh: state.era.name_zh, start: state.era.start, end: state.era.end }; },
    get lang() { return state.lang; },
    get tour() { return state.tour && { id: state.tour.id, index: state.tour.i, steps: state.tour.tr.steps, path: !!state.tour.tr.path }; },
    // Text in the visitor's language: text(en, zh) or text(obj, "key") for obj.key / obj.key_zh.
    text: (a, b) => (typeof a === "object" ? tx(a, b) : zh() && b ? b : a),
    on(name, fn) { (hooks[name] ||= []).push(fn); return () => (hooks[name] = hooks[name].filter((f) => f !== fn)); },
    setYear: (y) => setYear(y),
    get style() { return state.look; },
    get styles() { return lookOrder(); },
    setStyle: (id) => setLook(id, false),
    startTour: (id, step = 0) => startTour(id, step),
    openEvent: (id) => state.events.some((e) => e.id === id) && openStory(id),
    // Plugin code is trusted (it comes from an allowed site), so its card HTML goes in as is.
    showCard: (lngLat, html) => showCard(lngLat, html),
    addLayer: (def) => {
      const L = addPackLayer(def, base);
      return { get on() { return L.on; }, setData: (gj) => map.getSource(`pk-${def.id}`).setData(gj), show: (on = true) => setPackLayer(L, on), layerIds: L.ids };
    },
    // A switch in the layers panel that only reports clicks: addToggle({id, name, name_zh, on}, (on) => ...).
    addToggle(def, fn) {
      if (!/^[a-z0-9-]+$/.test(def.id || "") || packLayers.some((L) => L.def.id === def.id)) throw new Error(`Toggle id "${def.id}" is missing or taken.`);
      const L = packEntry(def, []);
      L.onToggle = fn;
      fn(L.on);
      return { get on() { return L.on; } };
    },
    url: (path) => new URL(path, base).href,
    fetchJSON: (path) => fetch(new URL(path, base)).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); }),
  };
}
// Imports the pack's plugin modules (started early, so they load alongside the data).
function importPlugins() {
  // An entry is a path, or { src, atlas } for a plugin that needs a newer format than the pack itself.
  return (state.pack?.manifest.plugins || []).map((p) => (typeof p === "string" ? { src: p } : p)).filter(fitsFormat).map(({ src }) => {
    const u = new URL(src, state.pack.url);
    if (!allowedOrigin(u)) return Promise.reject(new Error(`Plugins from ${u.origin} are not allowed.`));
    return import(u.href).then((m) => ({ src: u.href, m }));
  });
}
// Once the map has loaded: the manifest's layers, then each plugin's setup(atlas). A broken one is logged and skipped.
async function startPlugins(imports) {
  const base = state.pack.url;
  for (const def of (state.pack.manifest.layers || []).filter(fitsFormat)) {
    try { addPackLayer(def, base); } catch (e) { console.error(`Pack layer "${def.id}" was skipped:`, e); }
  }
  for (const r of await Promise.allSettled(imports)) {
    if (r.status === "rejected") { console.error("A pack plugin did not load:", r.reason); continue; }
    const { src, m } = r.value, setup = typeof m.default === "function" ? m.default : m.default?.setup || m.setup;
    try {
      if (typeof setup !== "function") throw new Error("it exports no setup function");
      await setup(pluginApi(src));
    } catch (e) { console.error(`The plugin ${src} failed to start:`, e); }
  }
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyBounds(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}
// Sample a grid over the open part of the map, the middle counting most; sea and unassigned land are left out.
// A region with most of the rest wins; once chosen, a region keeps the timeline while it still holds a good share.
function detectRegion() {
  if (state.regions.length < 2) return state.home;
  const c = map.getCanvas(), W = c.clientWidth - (innerWidth > 720 ? 380 : 0), H = c.clientHeight;
  const n = {};
  let tot = 0, hit = 0;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) {
    const ll = map.unproject([(W * (i + 0.5)) / 8, H * (0.12 + (0.8 * (j + 0.5)) / 6)]);
    if (!isFinite(ll.lat) || Math.abs(ll.lat) > 85) continue;
    const w = 2 - Math.abs(i - 3.5) / 4 - Math.abs(j - 2.5) / 3;
    tot += w;
    const lon = ((((ll.lng + 180) % 360) + 360) % 360) - 180;
    const r = state.regions.find((r) => r.polygon?.length > 2 && inPoly(lon, ll.lat, r.polygon));
    if (r) { n[r.id] = (n[r.id] || 0) + w; hit += w; }
  }
  if (!tot) return state.mode;
  if (hit < 0.2 * tot) return "world";
  if (state.mode !== "world" && (n[state.mode] || 0) >= 0.35 * hit) return state.mode;
  const [best, second] = Object.entries(n).sort((a, b) => b[1] - a[1]);
  return best && best[1] >= 0.45 * hit && best[1] >= 1.5 * (second?.[1] || 0) ? best[0] : "world";
}
// Switch the timeline to a region's periods (or the calendar years), keeping the year.
// `force` rebuilds the periods when the region stays but the selected country changes.
function setMode(id, quiet, force) {
  if (id !== "world" && !state.regionById[id]) return false;
  const eras = id === "world" ? state.worldEras : erasOf(id);
  if (id === state.mode && (!force || eras === state.eras)) return false;
  state.mode = id;
  state.eras = eras;
  state.scope = null;
  buildScale();
  if (state.zoom) state.win = windowFor(state.zoom, state.year);
  state.era = null;
  renderRegionBtn();
  if (!quiet) { setYear(state.year); refreshTimeline(); }
  else setEra(eraFor(state.year), true);
  return true;
}

/* ---------- time scale ---------- */

// Zoom "all": each era gets slider width by the square root of its length.
function buildScale() {
  const w = state.eras.map((e) => Math.sqrt(e.end - e.start + 1));
  const total = w.reduce((a, b) => a + b, 0);
  let p = 0;
  state.scale = state.eras.map((era, i) => {
    const p0 = p;
    p += (w[i] / total) * SLIDER_MAX;
    return { era, p0, p1: p };
  });
}
// Zoomed in, the rail is linear over state.win; year y covers [y, y + 1).
function yearToPos(y) {
  if (state.zoom > 0) {
    const [a, b] = state.win;
    return ((Math.max(a, Math.min(b + 1, y)) - a) / (b + 1 - a)) * SLIDER_MAX;
  }
  const s = state.scale.find((s) => y >= s.era.start && y <= s.era.end) || state.scale[state.scale.length - 1];
  return s.p0 + ((y - s.era.start) / (s.era.end + 1 - s.era.start)) * (s.p1 - s.p0);
}
function posToYear(p) {
  if (state.zoom > 0) {
    const [a, b] = state.win;
    return Math.min(b, Math.floor(a + (p / SLIDER_MAX) * (b + 1 - a)));
  }
  const s = state.scale.find((s) => p >= s.p0 && p < s.p1) || state.scale[state.scale.length - 1];
  return Math.min(s.era.end, Math.floor(s.era.start + ((p - s.p0) / (s.p1 - s.p0)) * (s.era.end + 1 - s.era.start)));
}

// The decades window is a quarter of the dynasty, kept between 12 and 60 years.
function decadesSpan(era) {
  return Math.max(12, Math.min(60, Math.round((era.end - era.start + 1) / 4)));
}
function windowFor(zoom, year) {
  const era = eraFor(year);
  if (zoom === 1) return [era.start, era.end];
  const span = decadesSpan(era);
  let a = Math.round(year - span / 2);
  a = Math.max(state.range.start, Math.min(state.range.end - span + 1, a));
  return [a, a + span - 1];
}
const inWindow = (y) => state.zoom === 0 || (y >= state.win[0] && y <= state.win[1]);

function setZoom(z, year = state.year) {
  z = Math.max(0, Math.min(ZOOMS.length - 1, z));
  if (z === state.zoom && z !== 2) return;
  state.zoom = z;
  state.scope = null;
  state.win = z ? windowFor(z, year) : null;
  if (z && !inWindow(state.year)) setYear(Math.max(state.win[0], Math.min(state.win[1], year)));
  refreshTimeline();
}
function pan(dir) {
  if (!state.zoom) return;
  stop();
  state.scope = null;
  const [a, b] = state.win;
  if (state.zoom === 1) {
    const i = state.eras.indexOf(eraFor(a)) + dir;
    if (!state.eras[i]) return;
    state.win = [state.eras[i].start, state.eras[i].end];
    setYear(state.eras[i].start);
  } else {
    const span = b - a;
    const step = Math.max(1, Math.round((span + 1) / 2)) * dir;
    const na = Math.max(state.range.start, Math.min(state.range.end - span, a + step));
    state.win = [na, na + span];
    setYear(Math.max(na, Math.min(na + span, state.year + step)));
  }
  refreshTimeline();
}
function refreshTimeline() {
  saveView();
  buildRail();
  $("slider").value = yearToPos(state.year);
  buildEventMarkers();
  renderEventStates();
  if (!state.reading) renderLedger();
}

function eraFor(year) {
  return state.eras.find((e) => year >= e.start && year <= e.end) || state.eras[state.eras.length - 1];
}
function snapshotFor(era, year) {
  let snap = era.snapshots[0];
  for (const s of era.snapshots) if (year >= s.from) snap = s;
  return snap;
}

async function setYear(year, opts = {}) {
  state.year = Math.max(state.range.start, Math.min(state.range.end, Math.round(year)));
  const era = eraFor(state.year);
  const eraChanged = era !== state.era;
  if (eraChanged) setEra(era, true);
  // Keep the zoomed window around the current year.
  if ((state.zoom && !inWindow(state.year)) || (eraChanged && state.zoom === 1)) {
    state.scope = null;
    state.win = windowFor(state.zoom, state.year);
    refreshTimeline();
  } else if (eraChanged) {
    buildRail();
    buildEventMarkers();
    if (!state.reading) renderLedger();
  }
  const [num, suffix] = fmtYearParts(state.year);
  $("year").textContent = num;
  $("year-suffix").textContent = suffix;
  if (!opts.fromSlider) $("slider").value = yearToPos(state.year);
  if (state.dial && !dial.drag) drawDial();
  revealYear(true);
  saveView();
  refreshRegionPop();
  const snap = snapshotFor(era, state.year);
  const label = snap.world && state.basemap?.earth === false ? "" : snap.world ? t("worldMap")(fmtYear(worldAt(state.year)?.from ?? snap.from)) : tx(snap, "label");
  $("era-snap").textContent = label ? t("map") + label : "";
  $("era-snap").hidden = !label;
  document.querySelectorAll(".band.snap").forEach((b) => b.classList.toggle("current", b.dataset.path === snap.borders && +b.dataset.from === snap.from));
  await setMaps(era, state.year);
  applySelMap();
  renderSelCard();
  updateCompare();
  renderEventStates();
  renderPlaces();
  renderOverlays();
  if (trail.life) updateTrail();
  renderOldGeo();
  renderPackLayers();
  emit("year", { year: state.year, era: era.id, eraChanged });
  renderWorldStrip();
}

// A period (朝代) can be part of a longer-lived state (实体): 秦朝 前221 within 秦国 from 前770, 民国 on the mainland
// until 1948 while the country goes on. Such periods name the state's lineage in `entity` (tools/check_eras.py).
function entityLine(era) {
  const L = era.entity && (state.countries?.lineages || []).find((l) => l.id === era.entity);
  if (!L || L.start == null) return "";
  const yrs = `${fmtYear(L.start)} – ${L.end == null ? t("sel").now : fmtYear(L.end)}`;
  return `<span class="era-entity">${esc(t("asState"))}${esc(nameOf(L))} ${esc(yrs)}</span>`;
}

function setEra(era, quiet) {
  state.era = era;
  syncMusic();
  const seal = $("era-glyph");
  seal.textContent = era.seal || era.glyph;
  seal.classList.toggle("double", (era.seal || era.glyph).length > 1);
  const civ = era.region === "world" ? { seal: "#56606a" } : state.regionById[era.region];
  const color = era.region === "china" ? null : era.color || civ?.seal || civ?.color;
  seal.classList.toggle("civ", !!color);
  if (color) seal.style.setProperty("--seal", color); else seal.style.removeProperty("--seal");
  $("era-name").textContent = zh() ? era.name_zh : era.name;
  // Each piece wraps whole: other-language name, span of years, length.
  const region = state.regionById[era.region];
  const L = era.country && (state.countries?.lineages || []).find((l) => l.id === era.country);
  $("era-zh").innerHTML = (region ? [L ? nameOf(L) : regionShort(region), zh() ? era.name : era.name_zh, `${fmtYear(era.since ?? era.start)} – ${fmtYear(era.until ?? era.end)}`, t("lasted")(eraYears(era))]
    : [t("worldName"), t("lasted")(eraYears(era))])
    .map((x) => `<span>${esc(x)}</span>`).join(" · ") + entityLine(era);
  $("era-summary").textContent = tx(era, "summary");
  const note = tx(era, "note");
  $("era-note").textContent = note;
  $("era-note").hidden = !note;
  document.querySelectorAll(".band.era-band").forEach((b) => b.classList.toggle("current", b.dataset.era === era.id));
  $("scale-hint").textContent = hintText();
  loadDetails(era);
  state.layerData = null;
  popup?.remove();
  loadLayers(era).then((d) => { if (state.era === era) { state.layerData = d; renderOverlays(); renderSelCard(); if (state.tab === "events" && !state.reading) renderLedger(); } });
  if (!quiet) {
    buildEventMarkers();
    if (!state.reading) renderLedger();
  }
}

// The borders shown: inside China's dynasties (前2070–1912) the dynasty map, with the rest of the world from the
// world map with East Asia cut out; otherwise the whole world map. Polities named in the period's `focus` list
// are drawn as the main states; China's own periods keep the dynasty map's focus.
const rawBorders = (path) => state.raw[path] || (state.raw[path] = loadBorders(path));
function bordersKey(era, year, mode) {
  const ce = state.chinaEras.find((e) => !e.worldMaps && year >= e.start && year <= e.end);
  const china = ce ? snapshotFor(ce, year).borders : null;
  const w = worldAt(year);
  const world = w ? (china ? w.outer : w.full) : null;
  const focus = era.focus || (mode === "china" ? null : []);
  return { key: [china, world, focus ? focus.join("|") : "*"].join("§"), china, world, focus };
}
async function bordersFor({ key, china, world, focus }) {
  if (!state.borders[key]) {
    const [a, b] = await Promise.all([china && rawBorders(china), world && rawBorders(world).catch(() => null)]);
    const fs = new Set(focus || []);
    const feats = [...(a?.features || []), ...(b?.features || [])];
    state.borders[key] = { type: "FeatureCollection",
      features: focus ? feats.map((f) => ({ ...f, properties: { ...f.properties, focus: fs.has(f.properties.name) } })) : feats };
  }
  return state.borders[key];
}
async function setMaps(era, year) {
  const spec = bordersKey(era, year, state.mode), key = spec.key;
  if (key === state.snapshot) return;
  state.snapshot = key;
  await bordersFor(spec);
  if (state.snapshot !== key) return; // a newer request won
  const prev = state.shownBorders;
  state.shownBorders = state.borders[key];
  renderPolityLabels(state.borders[key]);
  renderWorldStrip();
  applySelMap();
  // While playing, the old map turns into the new one; otherwise it simply switches.
  if ((state.playing || state.tour?.tr.morph) && prev && !matchMedia("(prefers-reduced-motion: reduce)").matches && morphBorders(prev, state.borders[key])) return;
  endMorph();
  map.getSource("borders")?.setData(state.borders[key]);
}

/* ---------- border morph: during playback each territory change spreads outward from the side that gains it ---------- */
// Both maps are drawn onto a grid over the area that changed; every changed cell flips from its old owner to its
// new one at a time set by how far it lies from the new owner's existing land, so conquests advance as a front.
// The grid is shown as a canvas layer for the length of the morph, then the vector borders take over again.
let morph = null;
const MORPH_MS = 800, MORPH_CELLS = 640;
const geomSig = (f) => { const g = f.geometry, c = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0]?.[0]; return `${f.properties.name}|${g.coordinates.length}|${c?.length}|${c?.[0]}`; };
function endMorph() {
  if (!morph) return;
  cancelAnimationFrame(morph.raf);
  if (map.getLayer("morph")) map.removeLayer("morph");
  if (map.getSource("morph")) map.removeSource("morph");
  morph = null;
}
function morphBorders(A, B) {
  endMorph();
  const keep = (f) => f.geometry && (f.properties.focus || state.showNeighbours);
  const sigA = new Set(A.features.filter(keep).map(geomSig)), sigB = new Set(B.features.filter(keep).map(geomSig));
  const all = [...A.features.filter((f) => keep(f) && !sigB.has(geomSig(f))), ...B.features.filter((f) => keep(f) && !sigA.has(geomSig(f)))];
  // The story is in the main states: they morph; neighbours that changed simply switch.
  const main = (f) => f.properties.focus || f.properties.kind === "state";
  const changed = all.some(main) ? all.filter(main) : all;
  if (!changed.length) return false;
  // Area to animate: everything that changed, padded a little, kept within the Mercator range.
  let w = 180, e = -180, so = 85, n = -85;
  const walk = (c) => { if (typeof c[0] === "number") { w = Math.min(w, c[0]); e = Math.max(e, c[0]); so = Math.min(so, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); };
  changed.forEach((f) => walk(f.geometry.coordinates));
  if (e - w > 200 || e <= w) return false;
  const pad = Math.max(0.5, (e - w) * 0.04);
  w = Math.max(-180, w - pad); e = Math.min(180, e + pad); so = Math.max(-84, so - pad); n = Math.min(84, n + pad);
  const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const mN = my(n), mS = my(so);
  const aspect = (mN - mS) / (((e - w) * Math.PI) / 180);
  const W = aspect > 1 ? Math.max(8, Math.round(MORPH_CELLS / aspect)) : MORPH_CELLS, H = aspect > 1 ? MORPH_CELLS : Math.max(8, Math.round(MORPH_CELLS * aspect));
  const px = (lon) => ((lon - w) / (e - w)) * W, py = (lat) => ((mN - my(Math.max(-84, Math.min(84, lat)))) / (mN - mS)) * H;

  // Owners: one table of names for both maps; colour and focus come from each map's own feature.
  const names = [], idx = new Map(), look = [new Map(), new Map()];
  const ownerOf = (f, side) => {
    const nm = f.properties.name || "";
    if (!idx.has(nm)) { idx.set(nm, names.length); names.push(nm); }
    look[side].set(idx.get(nm), f.properties);
    return idx.get(nm);
  };
  const raster = (gj, side) => {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d", { willReadFrequently: true });
    gj.features.forEach((f) => {
      if (!keep(f)) return;
      const id = ownerOf(f, side) + 1;
      g.fillStyle = `rgb(${id & 255},${(id >> 8) & 255},${id >> 16})`;
      g.beginPath();
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) ring.forEach(([x, y], i) => (i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y))));
      g.fill("evenodd");
    });
    const d = g.getImageData(0, 0, W, H).data, own = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      // Anti-aliased edge pixels blend two ids: they take the owner of the pixel to their left.
      own[i] = d[i * 4 + 3] < 128 ? -1 : d[i * 4] + (d[i * 4 + 1] << 8) + (d[i * 4 + 2] << 16) - 1;
      if (own[i] >= names.length || (d[i * 4 + 3] > 0 && d[i * 4 + 3] < 255)) own[i] = i % W ? own[i - 1] : -1;
    }
    return own;
  };
  const oa = raster(A, 0), ob = raster(B, 1);

  // Flip times: a breadth-first front from each new owner's unchanged land through the cells it gains.
  const N = W * H, dist = new Float32Array(N).fill(-1), q = new Int32Array(N);
  let qh = 0, qt = 0;
  const nb = (i, fn) => { const x = i % W; if (x) fn(i - 1); if (x < W - 1) fn(i + 1); if (i >= W) fn(i - W); if (i < N - W) fn(i + W); };
  for (let i = 0; i < N; i++) if (oa[i] !== ob[i]) nb(i, (j) => { if (dist[i] < 0 && oa[j] === ob[j] && oa[j] === ob[i]) { dist[i] = 1; q[qt++] = i; } });
  while (qh < qt) { const i = q[qh++]; nb(i, (j) => { if (dist[j] < 0 && oa[j] !== ob[j] && ob[j] === ob[i]) { dist[j] = dist[i] + 1; q[qt++] = j; } }); }
  let max = 1;
  for (let i = 0; i < N; i++) if (dist[i] > max) max = dist[i];
  // Land with no neighbour to grow from (a new state, an island) fades in across the morph instead.
  for (let i = 0; i < N; i++) if (oa[i] !== ob[i]) dist[i] = dist[i] < 0 ? 0.15 + 0.7 * ((i * 2654435761) % 1000) / 1000 : dist[i] / max;

  // Colours as the vector layers paint them.
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const paint = (p) => {
    const c = hex(p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : p.focus ? "#2c7a68" : "#6b5a7a");
    const a = p.focus ? (p.color ? 0.34 : 0.2) : p.name_zh ? 0.2 : 0.07;
    return [...c, Math.round(a * 255)];
  };
  // Only owners whose shape changes are drawn here; the rest stay on the vector layers throughout.
  const moved = [new Set(), new Set()];
  changed.forEach((f) => { const k = idx.get(f.properties.name || ""); if (k !== undefined) { moved[0].add(k); moved[1].add(k); } });
  const col = [new Map(), new Map()];
  for (const s of [0, 1]) for (const [k, p] of look[s]) col[s].set(k, { fill: paint(p), focus: !!p.focus });

  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), img = g.createImageData(W, H), px8 = img.data;
  const cur = new Int32Array(N), side = new Uint8Array(N);
  const draw = (p) => {
    for (let i = 0; i < N; i++) { const b = oa[i] === ob[i] || dist[i] <= p; cur[i] = b ? ob[i] : oa[i]; side[i] = b ? 1 : 0; }
    for (let i = 0; i < N; i++) {
      const o = cur[i], k = i * 4;
      if (o < 0 || !moved[side[i]].has(o)) { px8[k + 3] = 0; continue; }
      const c = col[side[i]].get(o) || col[1 - side[i]].get(o);
      // A cell beside a different owner is drawn as border: red round the main state, dusky between neighbours.
      const x = i % W, edge = (x < W - 1 && cur[i + 1] !== o) || (i < N - W && cur[i + W] !== o) || (x && cur[i - 1] !== o) || (i >= W && cur[i - W] !== o);
      if (edge) { const f = c.focus; px8[k] = f ? 185 : 75; px8[k + 1] = f ? 58 : 64; px8[k + 2] = f ? 38 : 88; px8[k + 3] = f ? 230 : 140; }
      else { px8[k] = c.fill[0]; px8[k + 1] = c.fill[1]; px8[k + 2] = c.fill[2]; px8[k + 3] = c.fill[3]; }
    }
    g.putImageData(img, 0, 0);
  };
  draw(0);

  // Swap in the canvas: the vector borders keep only what lies outside the animated area (unchanged anyway).
  const coords = [[w, n], [e, n], [e, so], [w, so]];
  map.addSource("morph", { type: "canvas", canvas: cv, coordinates: coords, animate: true });
  map.addLayer({ id: "morph", type: "raster", source: "morph", paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "nearest" } }, "hl-fill");
  map.getSource("borders")?.setData({ type: "FeatureCollection", features: B.features.filter((f) => !keep(f) || sigA.has(geomSig(f)) || !moved[1].has(idx.get(f.properties.name || ""))) });
  const t0 = performance.now();
  morph = { raf: 0 };
  const tick = () => {
    const t = Math.min(1, (performance.now() - t0) / MORPH_MS), ease = t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
    draw(ease);
    // With 3D terrain the map drapes layers through cached textures: drop them so the new frame shows.
    (map.terrain?.tileManager || map.terrain?.sourceCache)?.freeRtt?.();
    map.triggerRepaint();
    if (t < 1) { morph.raf = requestAnimationFrame(tick); return; }
    map.getSource("borders")?.setData(B);
    // Let the vector borders paint before the canvas goes.
    morph.raf = requestAnimationFrame(() => requestAnimationFrame(endMorph));
  };
  morph.raf = requestAnimationFrame(tick);
  return true;
}

function renderPolityLabels(gj) {
  scheduleDeclutter();
  markers.polities.forEach((m) => m.remove());
  markers.polities = [];
  markers.polityEls = [];
  if (!gj) return;
  for (const f of gj.features) {
    const p = f.properties;
    // Neighbours with a Chinese name are labelled even when small; others only when large.
    const minArea = p.kind === "state" ? 2 : p.name_zh ? 3 : 20;
    if (!p.focus && (p.area < minArea || !state.showNeighbours || p.nolabel)) continue;
    const el = document.createElement("div");
    // Dynasty names are one or two characters and get a big, spaced label; longer names (平原野牛猎人) a smaller one.
    const len = zh() ? (p.name_zh || "").length : p.name.length / 3;
    el.className = "mk-polity" + (p.focus ? " focus" : p.name_zh ? " neighbour" : "") +
      (p.kind === "state" ? " state" : "") + (p.minor ? " minor" : "") + (len > 5 ? " longer" : len > 3 ? " long" : "");
    if (zh()) el.innerHTML = p.name_zh ? esc(p.name_zh) : `<small>${esc(p.name)}</small>`;
    else el.innerHTML = `<span>${esc(p.name)}</span>` + (p.name_zh ? `<small lang="zh-CN">${esc(p.name_zh)}</small>` : "");
    markers.polities.push(new maplibregl.Marker({ element: el }).setLngLat(p.label).addTo(map));
    markers.polityEls.push({ el, name: p.name, focus: p.focus, state: p.kind === "state", area: p.area || 0, lat: p.label[1] });
  }
  updateRulers();
}

/* ---------- one country selected: the map, the panels and the timeline follow it ---------- */
// Click a state on the map (or pick it in the 世界 tab or the event filter) to select it: every other state dims,
// and events, people, rulers and cities narrow to it. data/countries.json (tools/build_countries.py) says when each
// name is on the map; the same name centuries apart is another country, and `lineages` join a country's names
// (Wessex → England → Great Britain). Events and people carry `states`, the polities they belong to.
// A lineage's names may carry their own years, ["China", 1945, 1948]; the rest take the lineage's from/to.
function lineageWin(L) {
  if (!L.win) {
    L.win = {};
    for (const x of L.names) { const [n, a, b] = Array.isArray(x) ? x : [x]; L.win[n] = [a ?? L.from ?? -1e9, b ?? L.to ?? 1e9]; }
  }
  return L.win;
}
const lineageAt = (name, year) => (state.countries?.lineages || []).find((l) => { const w = lineageWin(l)[name]; return w && year >= w[0] && year <= w[1]; });
function countryEntity(name, year) {
  const C = state.countries || { spans: {}, lineages: [] };
  const runs = C.spans[name] || [];
  const near = (r) => (year < r[0] ? r[0] - year : year > r[1] ? year - r[1] : 0);
  const run = [...runs].sort((a, b) => near(a) - near(b))[0];
  const L = lineageAt(name, year);
  let spans, win, label;
  if (L) {
    win = lineageWin(L);
    label = { name: L.name, name_zh: L.name_zh };
    spans = [];
    for (const [a, b] of Object.entries(win).flatMap(([n, [lo, hi]]) => (C.spans[n] || []).filter((r) => r[1] >= lo && r[0] <= hi)
      .map((r) => [Math.max(lo, r[0]), Math.min(hi, r[1])])).sort((x, y) => x[0] - y[0])) {
      const last = spans.at(-1);
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b); else spans.push([a, b]);
    }
  } else {
    const f = state.shownBorders?.features.find((f) => f.properties.name === name);
    label = { name, name_zh: run?.[2] || f?.properties.name_zh || "" };
    spans = run ? [[run[0], run[1]]] : [];
    win = { [name]: run ? [run[0], run[1]] : [-1e9, 1e9] };
  }
  // Its years: from the country table (data/lineages.json `start`/`end`, end null = today) when dated, else the maps'
  // snapshots (approximate). `spans` stays the years it is on the map.
  const dated = L && L.start != null;
  const years = dated ? [[L.start, L.end ?? 2026]] : spans;
  return { id: L ? "L:" + L.id : `${name}@${run?.[0] ?? ""}`, names: new Set(Object.keys(win)), win, ...label, spans, years, dated,
    region: L?.region || run?.[3] || "", from: years[0]?.[0] ?? -1e9, to: years.at(-1)?.[1] ?? 1e9 };
}
// The selected country's names on the map in a year (中华民国 is "China" only until 1948).
const selNames = (y = state.year) => new Set(state.sel ? Object.entries(state.sel.win).filter(([, [a, b]]) => y >= a && y <= b).map(([n]) => n) : []);
const selName = (s = state.sel) => (zh() ? s.name_zh || s.name : s.name);
// Something tagged with these states over these years belongs to the selected country.
function selHas(states, a, b) {
  const s = state.sel;
  return !!s && (states || []).some((n) => s.win[n] && b >= s.win[n][0] && a <= s.win[n][1]);
}
const selPerson = (p) => !state.sel || selHas(p.states, ...personSpan(p));
const selOnMap = () => !!state.sel && state.sel.spans.some(([a, b]) => state.year >= a && state.year <= b) &&
  !!state.shownBorders?.features.some((f) => selNames().has(f.properties.name));
// The selected country's land on the map now, for cities inside it.
function selContains(lon, lat) {
  if (!selOnMap()) return false;
  const now = selNames();
  return state.shownBorders.features.some((f) => {
    if (!now.has(f.properties.name)) return false;
    const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    return polys.some((p) => inPoly(lon, lat, p[0]) && !p.slice(1).some((h) => inPoly(lon, lat, h)));
  });
}
// Layer items for the selected country: one with a point or a line on its land (or within ~30 km of its border,
// for ports and frontier passes) belongs to it. With no country selected everything shows.
function selNear(lon, lat) {
  if (selContains(lon, lat)) return true;
  const d = 0.3;
  return [[d, 0], [-d, 0], [0, d], [0, -d]].some(([x, y]) => selContains(lon + x, lat + y));
}
const selKeep = (pts) => !state.sel || pts.some((p) => p && selNear(p[0], p[1]));
function applySelMap() {
  if (!map?.getLayer("sel-dim")) return;
  const on = selOnMap(), now = selNames(), names = on ? [...now] : [];
  const key = on ? `${state.snapshot}|${state.sel.id}` : "";
  if (key === applySelMap.key) return;
  applySelMap.key = key;
  // Every other state is dimmed. (A world-sized mask with the country cut out would also dim the sea, but the
  // maps' rounded rings can cross themselves, and as holes they tear the mask.)
  map.setLayoutProperty("sel-dim", "visibility", on ? "visible" : "none");
  map.setFilter("sel-dim", ["!", ["in", ["get", "name"], ["literal", names]]]);
  map.setFilter("sel-line", ["in", ["get", "name"], ["literal", names]]);
  for (const p of markers.polityEls) p.el.classList.toggle("dim", on && !now.has(p.name));
}
// The periods the timeline runs on. A place has periods at whatever level fits it: Europe has 中世纪 and 文艺复兴,
// England has 都铎 and 斯图亚特. While a country with its own periods (data/country-periods.json, copied into
// countries.json `periods`) is selected, its periods replace its region's over its years; before and after them the
// region's periods go on. Rulers and people for a country period come from the region periods it overlaps.
function erasOf(id) {
  const R = state.regionById[id].eras, s = state.sel;
  const L = s?.id.startsWith("L:") && s.region === id && (state.countries?.lineages || []).find((l) => "L:" + l.id === s.id);
  const P = L && state.countries.periods?.[L.id];
  if (!P?.length) return R;
  if (erasOf.key === s.id + id) return erasOf.list;
  const a = P[0].start, b = P.at(-1).end, names = Object.keys(lineageWin(L));
  const clip = (e, lo, hi) => (e.start >= lo && e.end <= hi ? e : { ...e, start: Math.max(e.start, lo), end: Math.min(e.end, hi) });
  const mine = P.map((p) => ({ ...p, region: id, country: L.id, worldMaps: true, layers: true, focus: names,
    layerFrom: R.filter((e) => e.layers && e.start <= p.end && e.end >= p.start).map((e) => e.id), snapshots: worldSnaps(p.start, p.end) }));
  erasOf.key = s.id + id;
  return (erasOf.list = [...R.filter((e) => e.start < a).map((e) => clip(e, -1e9, a - 1)), ...mine,
    ...R.filter((e) => e.end > b).map((e) => clip(e, b + 1, 1e9))]);
}
const selRegion = () => (state.regionById[state.sel?.region] ? state.sel.region : state.mode);
function selectCountry(name, opts = {}) {
  state.sel = name ? countryEntity(name, opts.year ?? state.year) : null;
  // The timeline moves to the country's region; letting go hands it back to the map.
  if (state.ready) setMode(state.sel ? selRegion() : detectRegion(), false, true);
  // The rulers tab follows the selection; with none it goes back to the period's main country.
  if (!state.sel) state.rulerPolity = null;
  saveView();
  applySelMap();
  renderPlaces();
  renderOverlays();
  refreshTimeline();
  renderSelCard();
  if (state.reading) renderLedger();
  if (opts.fly) flyToCountry(name);
}
function countryBounds(name) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const f of state.shownBorders?.features || []) {
    if (f.properties.name !== name) continue;
    const g = f.geometry;
    for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates) for (const [x, y] of poly[0]) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return x1 > x0 ? [[x0, y0], [x1, y1]] : null;
}
function flyToCountry(name) {
  const b = countryBounds(name);
  if (b) map.fitBounds(b, { padding: { top: 120, bottom: 150, left: 60, right: innerWidth > 720 ? 400 : 60 }, maxZoom: 6, duration: 1400 });
}
// The card over the ledger: the selected country's years, ruler now, counts and its cities on the map this year.
function renderSelCard() {
  renderWorldStrip();
  const box = $("sel-card"), s = state.sel;
  box.hidden = !s;
  $("ledger").classList.toggle("has-sel", !!s);
  if (!s) return;
  const on = selOnMap();
  const span = s.years.length ? `${s.dated ? "" : t("sel").circa}${fmtYear(s.from)} – ${s.to >= 2026 ? t("sel").now : fmtYear(s.to)}` : "";
  const name = [...selNames()].find((n) => rulerAt(n, state.year));
  const r = name && rulerAt(name, state.year);
  const nEv = state.events.filter((ev) => selHas(ev.states, ev.year, ev.year)).length;
  const nPp = (state.layerData?.people || []).filter((p) => state.sel && selPerson(p)).length;
  const cities = on ? state.places.filter((p) => state.year >= p.from && state.year <= p.to && selContains(p.lon, p.lat))
    .sort((a, b) => (b.rank === "capital") - (a.rank === "capital")).slice(0, 14) : [];
  // Not on the map this year: offer the nearest year it is.
  const near = !on && s.spans.length ? (state.year < s.spans[0][0] ? s.spans[0][0] : s.spans.findLast(([a]) => a <= state.year)?.[1] ?? s.spans.at(-1)[1]) : null;
  const S = t("sel");
  // Scrolled away from the country: a button flies back to it (the timeline keeps following it meanwhile).
  const b = on && countryBounds([...selNames()].find((n) => state.shownBorders.features.some((f) => f.properties.name === n)));
  const v = map.getBounds();
  const away = b && (b[1][0] < v.getWest() || b[0][0] > v.getEast() || b[1][1] < v.getSouth() || b[0][1] > v.getNorth());
  box.innerHTML = `<div class="sc-head"><span class="sc-dot"></span><b>${esc(selName(s))}</b>${!zh() && s.name_zh ? `<small lang="zh-CN">${esc(s.name_zh)}</small>` : zh() && s.name !== s.name_zh ? `<small lang="en">${esc(s.name)}</small>` : ""}
      <span class="sc-years">${esc(span)}</span><button type="button" class="sc-x" aria-label="${esc(S.clear)}" title="${esc(S.clear)}">×</button></div>
    ${away ? `<p class="sc-off">${esc(S.away)} <button type="button" class="chip" data-back>${esc(S.back(selName(s)))}</button></p>` : ""}
    ${on ? "" : `<p class="sc-off">${esc(state.year >= s.from && state.year <= s.to ? S.offMap : state.year < s.from ? S.before : S.after)}${near != null ? ` <button type="button" class="chip" data-y="${near}">${esc(S.jump(fmtYear(near)))}</button>` : ""}</p>`}
    ${nEv >= 3 ? `<button type="button" class="sc-story" data-story>▶ ${esc(S.story)}</button>` : ""}
    <p class="sc-meta">${r ? `<span>${esc(t("ruler"))}${esc(rulerText(r)[0])}</span>` : ""}<button type="button" data-tab="events">${esc(S.events(nEv))}</button>${nPp ? `<button type="button" data-tab="people">${esc(S.people(nPp))}</button>` : ""}</p>
    ${cities.length ? `<p class="sc-cities"><span>${esc(S.cities)}</span>${cities.map((c) => `<button type="button" data-c="${esc(c.id)}"${c.rank === "capital" ? ' class="cap"' : ""}>${esc(zh() ? c.name_zh : c.name)}</button>`).join("")}</p>` : ""}`;
  box.querySelector(".sc-x").addEventListener("click", () => selectCountry(null));
  box.querySelector("[data-story]")?.addEventListener("click", () => { const tr = countryTour(); if (tr) startTour(tr.id, 0, true); });
  box.querySelector("[data-back]")?.addEventListener("click", () => flyToCountry([...selNames()].find((n) => countryBounds(n))));
  box.querySelector("[data-y]")?.addEventListener("click", (e) => { stop(); setYear(+e.currentTarget.dataset.y); });
  box.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { $("tab-" + b.dataset.tab).click(); }));
  box.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => {
    const c = state.places.find((p) => p.id === b.dataset.c);
    map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(map.getZoom(), 6), duration: 1200, essential: true });
    map.once("moveend", () => showCard([c.lon, c.lat], placeCard(c)));
  }));
}
// The countries on the map now whose label lies in a region, main states first, then by size.
function regionCountries(r) {
  const out = [], seen = new Set();
  for (const f of state.shownBorders?.features || []) {
    const p = f.properties;
    if (!p.label || seen.has(p.name) || (!p.focus && (p.area || 0) < 1.5)) continue;
    const x = ((((p.label[0] + 180) % 360) + 360) % 360) - 180;
    if (!(r.polygon?.length > 2 && inPoly(x, p.label[1], r.polygon))) continue;
    // One chip per country: names joined in a lineage (Kingdom of France, France) count once.
    const L = lineageAt(p.name, state.year);
    for (const n of L ? Object.keys(lineageWin(L)) : [p.name]) seen.add(n);
    out.push(L ? { ...p, name_zh: L.name_zh, label_en: L.name } : p);
  }
  return out.sort((a, b) => !!b.focus - !!a.focus || (b.area || 0) - (a.area || 0));
}

/* ---------- overlay layers: rulers, armies, routes ---------- */

// Length of a period in years; there is no year 0, so a span across it is one year shorter.
const eraYears = (e) => e.end - e.start + 1 - (e.start < 0 && e.end > 0 ? 1 : 0);
function loadLayers(era) {
  if (!era.layers) return Promise.resolve({});
  // A country's own period takes the rulers and people of the region periods it overlaps.
  if (era.layerFrom) return (state.layers[era.id] ||= Promise.all(era.layerFrom.map((id) => loadLayers(regionEras(era.region).find((e) => e.id === id))))
    .then((ds) => {
      const out = { polities: {}, rulers: {}, people: [] }, seen = new Set();
      for (const d of ds) {
        Object.assign(out.polities, d.polities);
        for (const [k, rs] of Object.entries(d.rulers || {})) for (const r of rs) {
          const key = `${k}|${r.name}|${r.from}`;
          if (!seen.has(key)) { seen.add(key); (out.rulers[k] ||= []).push(r); }
        }
        for (const p of d.people || []) if (!seen.has("p" + p.id)) { seen.add("p" + p.id); out.people.push(p); }
      }
      return out;
    }));
  // Periods of the other world regions share one file per region (the artifact caps its file count).
  if (!state.layers[era.id]) state.layers[era.id] = era.worldMaps
    ? (state.layers["world-" + era.region] ||= loadJSON(`data/layers/world-${era.region}.json`).catch(() => ({}))).then((b) => b[era.id] || {})
    : loadJSON(`data/layers/${era.id}.json`).catch(() => ({}));
  return state.layers[era.id];
}

function rulerAt(name, year) {
  // In a handover year two reigns overlap; the newer ruler wins.
  return (state.layerData?.rulers?.[name] || []).findLast((r) => year >= r.from && year <= r.to);
}
// The name a learner knows (汉武帝, 冒顿单于), plus the personal name when the title doesn't already contain it.
function rulerText(r) {
  // Rulers outside China carry a rank (国王, 苏丹) instead of a title; the name leads.
  if (r.rank || r.rank_zh) return zh() ? [r.name_zh || r.name, r.rank_zh || ""] : [r.name, r.rank || ""];
  if (zh()) return [r.title_zh || r.name_zh, r.title_zh && !r.title_zh.includes(r.name_zh) ? r.name_zh : ""];
  return [r.title || r.name, r.title && !r.title.includes(r.name) ? r.name : ""];
}

// Layers switched on for the story being read or the tour step being shown ("auto layers"); they go off again after.
const shown = (k) => state.show[k] || !!state.auto[k];
const AUTO_RULES = [
  [["armies", "passes"], (c, x) => c === "war" || c === "rebellion" || /之战|战役|大战|围攻|攻破|北伐|西征|东征|南征|出兵|起兵|起义|击败|大败|会战|叛乱/.test(x)],
  [["walls"], (c, x) => /长城|边塞|匈奴|突厥|蒙古|瓦剌|鞑靼|鲜卑|柔然|边墙/.test(x)],
  [["routes", "roads"], (c, x) => /运河|渠|驿|驰道|直道|官道|丝绸之路|西域|出使|西行|东渡|下西洋|巡游|南巡|漕运|海运|行军|远征/.test(x)],
  [["capitals"], (c, x) => /迁都|定都|建都|都城|营建|东迁|南渡|国都|京城|首都/.test(x)],
  [["admin"], (c, x) => /郡县|设郡|置郡|分天下为|行省|改土归流|废郡|置州|设府|郡国并行|推恩令|州郡|道制/.test(x)],
  [["faith"], (c, x) => /佛|寺|僧|道教|道士|儒|孔子|孟子|理学|心学|书院|景教|伊斯兰|摩尼|祆教|基督|天主|传教|石窟|经书|佛经|百家/.test(x)],
  [["inventions"], (c, x) => c === "science" || /发明|造纸|印刷|火药|指南|历法|地动仪|天文|算|医书|本草|农书|技术|瓷/.test(x)],
  [["clans"], (c, x) => /门阀|士族|世家|豪族|朋党|党争|党禁|商帮|集团|郡望/.test(x)],
  [["climate"], (c, x) => /旱|蝗|饥荒|大饥|奇荒|水灾|大水|洪水|决口|决堤|改道|夺淮|地震|大疫|瘟疫|鼠疫|雪灾|寒冬|结冰/.test(x)],
];
// A dashed (auto) chip clicked is switched off until the story or step changes; clicked again it is on for good.
function syncAuto() {
  let text = "", cat = null, ctx = "";
  if (state.autoLayers) {
    const s = state.tour?.tr.steps[state.tour.i];
    const ev = state.events.find((e) => e.id === (s ? s.event : state.reading && state.selected));
    ctx = s ? `${state.tour.id}|${state.tour.i}` : ev ? ev.id : "";
    if (s) text = s.text_zh; else if (ev) text = `${ev.title_zh} ${ev.summary_zh}`;
    if (ev) { cat = ev.category; text += ` ${ev.title_zh}`; }
  }
  const auto = {};
  if (ctx !== state.autoCtx) { state.autoCtx = ctx; state.autoOff = {}; }
  // Each event and tour stop names its own layers (`layers`, chosen one by one); the keyword rules are the fallback.
  const s = state.autoLayers && state.tour?.tr.steps[state.tour.i];
  const ev = state.autoLayers && state.events.find((e) => e.id === (s ? s.event : state.reading && state.selected));
  const own = s ? s.layers ?? (s.event ? ev?.layers : undefined) : ev?.layers;
  const ok = (k) => !state.autoOff[k] && !$("l-" + k)?.hidden && k in state.show;
  if (Array.isArray(own)) own.forEach((k) => { if (ok(k)) auto[k] = true; });
  else if (text) for (const [keys, test] of AUTO_RULES) if (test(cat, text)) for (const k of keys) if (ok(k)) auto[k] = true;
  for (const k of Object.keys(state.show)) $("l-" + k)?.classList.toggle("auto", !state.show[k] && !!auto[k]);
  renderAutoStrip(auto);
  const key = Object.keys(auto).sort().join();
  if (key === Object.keys(state.auto).sort().join()) return;
  state.auto = auto;
  renderOverlays();
}
// A strip over the map names the layers the story or tour stop switched on (dashed) and the related ones already on;
// clicking one works like its chip in the layer panel, so the change is visible even with the panel closed.
function renderAutoStrip(auto) {
  const box = $("auto-strip"), keys = Object.keys(auto);
  box.hidden = !keys.length;
  if (!keys.length) return;
  const label = (k) => t(k === "people" ? "people_l" : k);
  const on = keys.filter((k) => !state.show[k]), also = keys.filter((k) => state.show[k]);
  box.innerHTML = (on.length ? `<span>${t("autoOn")}</span>` + on.map((k) => `<button type="button" class="chip layer auto" data-k="${k}">${esc(label(k))}</button>`).join("") : "") +
    (also.length ? `<span>${t("autoAlso")}</span>` + also.map((k) => `<button type="button" class="chip layer" aria-pressed="true" data-k="${k}">${esc(label(k))}</button>`).join("") : "");
  box.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => $("l-" + b.dataset.k).click()));
}
// Layer switches are icons; the name shows in a tip: on hover with a mouse, and briefly after each tap on a phone
// (with the new state), or while a finger holds the icon without switching it.
const LAYER_ICONS = {
  "t-3d": '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  "t-geo": '<path d="M2 17l6-9 4 5 3-4 7 8"/><path d="M3 21c3-1.5 5 1.5 9 0s6 1.5 9 0"/>',
  "t-neighbours": '<path d="M3 5h7l1 6-1 8H3z"/><path d="M14 5h7v14h-7l-1-6z" stroke-dasharray="2.6 2"/>',
  "l-rulers": '<path d="M3.5 8l4 4.5L12 6l4.5 6.5 4-4.5L19 18H5z"/><path d="M5 21h14"/>',
  "l-capitals": '<path d="M2 9l10-5 10 5"/><path d="M5 9v12M19 9v12M3 21h18M10 21v-5h4v5"/>',
  "t-places": '<path d="M3 21V10h6M9 21V4h7v17M16 13h5v8M2 21h20M12 8h1M12 12h1M12 16h1"/>',
  "l-admin": '<path d="M3 4h18v16H3z"/><path d="M3 11h7l2 3h9M10 4v7M14 14v6"/>',
  "l-clans": '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.3 5 2.6 5 5.8"/>',
  "l-armies": '<path d="M4 4l11 11M20 4L9 15M13 17l4-4M11 17l-4-4M16 16l3 3M8 16l-3 3"/>',
  "l-passes": '<path d="M3 21V10h18v11M2 10l2-4h16l2 4M9 21v-5a3 3 0 016 0v5"/>',
  "l-walls": '<path d="M3 20V7h3v3h4.5V7h3v3H18V7h3v13z"/><path d="M10 20v-3a2 2 0 014 0v3"/>',
  "l-roads": '<path d="M9 3L4 21M15 3l5 18M12 5v2M12 11v2M12 17v3"/>',
  "l-routes": '<circle cx="5" cy="18" r="2"/><path d="M7 17c4-2 2-8 7-9 3-.6 4-1.5 5-3" stroke-dasharray="2.6 2.4"/><path d="M16 4.5l3.2.3.3 3.2"/>',
  "l-climate": '<path d="M9 14.5V5a2.5 2.5 0 015 0v9.5a4 4 0 11-5 0z"/><path d="M11.5 9v8"/><path d="M17.5 4.5c1.6 1.4 2.5 3 2.5 4.5a2.5 2.5 0 01-5 0c0-1.5.9-3.1 2.5-4.5z"/>',
  "l-people": '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  "l-faith": '<path d="M12 20c-4 0-8-3-9-7 3 0 6 1 9 4 3-3 6-4 9-4-1 4-5 7-9 7z"/><path d="M12 17c-2-2-3-5-3-8 1.5 1 2.5 2 3 3 .5-1 1.5-2 3-3 0 3-1 6-3 8z"/>',
  "l-inventions": '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
  "l-exchange": '<path d="M4 8h15l-3-3M20 16H5l3 3"/>',
  "l-spread": '<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M8 8a5.7 5.7 0 000 8M16 8a5.7 5.7 0 010 8M5 5a10 10 0 000 14M19 5a10 10 0 010 14"/>',
};
function iconChips() {
  for (const b of document.querySelectorAll(".chip.ico[data-tip]")) {
    if (!b.firstElementChild) b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${LAYER_ICONS[b.id] || ""}</svg><small aria-hidden="true"></small>`;
    b.querySelector("small").textContent = t(b.dataset.tip);
    b.setAttribute("aria-label", t(b.dataset.tip));
  }
}
// How the layer buttons look and sit (设置 → 图层按钮 / 图层排列): text, icon (default) or both; in their groups
// (default), all in one scrolling row, or all in one wrapping run. html[data-laybtn] / [data-laypos] pick the CSS.
const LAY_BTNS = ["text", "icon", "both"], LAY_POS = ["group", "nowrap", "wrap"];
function setLayButtons({ btn = state.layBtn, pos = state.layPos } = {}, remember = true) {
  state.layBtn = LAY_BTNS.includes(btn) ? btn : "icon";
  state.layPos = LAY_POS.includes(pos) ? pos : "group";
  const root = document.documentElement;
  if (state.layBtn === "icon") root.removeAttribute("data-laybtn"); else root.dataset.laybtn = state.layBtn;
  if (state.layPos === "group") root.removeAttribute("data-laypos"); else root.dataset.laypos = state.layPos;
  hideLayerTip();
  if (remember) try { localStorage.setItem("atlas-laybtn", state.layBtn); localStorage.setItem("atlas-laypos", state.layPos); } catch {}
}
const layerTip = { el: null, timer: 0, hold: 0, held: null, touch: false };
function tipText(b) {
  const name = t(b.dataset.tip);
  if (b.dataset.tipHint) return `<b>${esc(name)}</b><span>${esc(t(b.dataset.tipHint))}</span>`;
  const st = b.classList.contains("auto") ? t("tipAuto") : b.getAttribute("aria-pressed") === "true" ? t("tipOn") : t("tipOff");
  return `<b>${esc(name)}</b><i>${esc(st)}</i>`;
}
function showLayerTip(b, ms) {
  if (state.layBtn !== "icon" && !b.dataset.tipHint) return;
  let el = layerTip.el;
  if (!el) { el = layerTip.el = document.createElement("div"); el.className = "layer-tip"; el.setAttribute("role", "tooltip"); document.body.append(el); }
  clearTimeout(layerTip.timer);
  el.innerHTML = tipText(b);
  el.hidden = false;
  const r = b.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const above = r.top - h - 8 >= 8;
  el.style.left = x + "px";
  el.style.top = (above ? r.top - h - 8 : r.bottom + 8) + "px";
  el.classList.toggle("below", !above);
  el.style.setProperty("--arrow", r.left + r.width / 2 - x + "px");
  if (ms) layerTip.timer = setTimeout(hideLayerTip, ms);
}
function hideLayerTip() { clearTimeout(layerTip.timer); if (layerTip.el) layerTip.el.hidden = true; }
function initLayerTips() {
  const box = document.querySelector(".era-layers");
  const tipOf = (e) => e.target.closest?.("[data-tip]");
  box.addEventListener("pointerover", (e) => { const b = tipOf(e); if (b && e.pointerType === "mouse") showLayerTip(b); });
  box.addEventListener("pointerout", (e) => { if (e.pointerType === "mouse" && tipOf(e) && !tipOf(e).contains(e.relatedTarget)) hideLayerTip(); });
  box.addEventListener("focusin", (e) => { const b = tipOf(e); if (b && b.matches(":focus-visible")) showLayerTip(b); });
  box.addEventListener("focusout", hideLayerTip);
  // A finger held on an icon shows its name and the lift does not switch it.
  box.addEventListener("pointerdown", (e) => {
    const b = tipOf(e);
    layerTip.touch = e.pointerType !== "mouse";
    if (!b || !layerTip.touch) return;
    clearTimeout(layerTip.hold);
    layerTip.held = null;
    layerTip.hold = setTimeout(() => { layerTip.held = b; showLayerTip(b); }, 420);
  });
  const lift = () => { clearTimeout(layerTip.hold); if (layerTip.held) layerTip.timer = setTimeout(hideLayerTip, 1600); };
  box.addEventListener("pointerup", lift);
  box.addEventListener("pointercancel", () => { clearTimeout(layerTip.hold); layerTip.held = null; hideLayerTip(); });
  box.addEventListener("contextmenu", (e) => { if (tipOf(e)) e.preventDefault(); });
  box.addEventListener("click", (e) => {
    const b = tipOf(e);
    if (b && layerTip.held === b) { e.stopImmediatePropagation(); e.preventDefault(); layerTip.held = null; }
  }, true);
  // After a tap the tip names the layer and its new state (the switch's own handler has run by then).
  box.addEventListener("click", (e) => { const b = tipOf(e); if (b && layerTip.touch) showLayerTip(b, 1600); });
  box.closest(".era")?.addEventListener("scroll", hideLayerTip, { passive: true });
  addEventListener("resize", hideLayerTip);
}
function renderOverlays() {
  scheduleDeclutter();
  if (state.tab !== "events") renderLedger();
  updateRulers();
  renderArmies();
  renderRoutes();
  renderPeople();
  renderCapitals();
  renderFaith();
  renderInventions();
  renderPasses();
  renderRoads();
  renderClans();
  renderWalls();
  renderAdmin();
  renderPopulation();
  renderDisasters();
  renderClimChart();
}

/* People, capitals, religion & thought, inventions: small markers that open a card. */

let popup, cardPerson = null;
function showCard(lngLat, html) {
  popup?.remove();
  popup = new maplibregl.Popup({ className: "atlas-pop", maxWidth: "300px", offset: 14, focusAfterOpen: false })
    .setLngLat(lngLat).setHTML(html).addTo(map);
  fillIllus(popup.getElement());
  popup.getElement().querySelectorAll(".pc-gaz[data-gaz]").forEach(fillGaz);
  // Event lists open at the city's current period and jump to that moment when clicked.
  const list = popup.getElement().querySelector(".pc-events"), now = list?.querySelector(".now");
  if (now) list.scrollTop = now.parentElement.offsetTop - list.offsetTop - 4;
  const el = popup.getElement();
  el.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", async () => {
    const q = state.places.find((q) => q.id === b.dataset.seg);
    if (!q) return;
    await setYear(q.from);
    showCard([q.lon, q.lat], placeCard(q));
  }));
  el.querySelectorAll("[data-cf]").forEach((b) => b.addEventListener("click", () => {
    el.querySelector(".pc-evwrap")?.classList.toggle("top", b.dataset.cf === "top");
    el.querySelectorAll("[data-cf]").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
  }));
  popup.getElement().querySelector("[data-life]")?.addEventListener("click", (e) => { popup?.remove(); startTour(e.currentTarget.dataset.life); });
  popup.getElement().querySelector("[data-trail]")?.addEventListener("click", (e) => {
    const p = cardPerson?.id === e.currentTarget.dataset.trail ? cardPerson : e.currentTarget.dataset.trail;
    popup?.remove();
    showTrail(p, { fit: true });
  });
  popup.getElement().querySelectorAll("[data-ev]").forEach((b) => b.addEventListener("click", () => {
    popup?.remove();
    state.reading = false;
    selectEvent(b.dataset.ev);
  }));
}
/* ---------- illustrations ---------- */
// data/illustrations.json maps "p:<person id>" / "e:<event id>" to an image; the pictures themselves sit in data/img/<bucket>.json
// as data URLs (the hosted page cannot load images from other sites). Built by tools/pack_illustrations.py.
// "a:<event id>" keys are AI-generated scenes from data/ai-illustrations.json + <DATA_URL>/atlas/ai/<file>.webp (tools/pack_ai_illustrations.py),
// always captioned as AI-generated.
const illuSets = {};
const illuBuckets = {};
// A pack's own pictures (packMedia) join the AI set.
const illuSet = (set) => illuSets[set] ||= loadJSON(set === "ai" ? "data/ai-illustrations.json" : "data/illustrations.json")
  .then((idx) => {
    if (set === "ai") pruneKept(["/ai/", "/atlas/ai/", BASE_PATH + "data/ai/"], Object.values(idx.images).filter((im) => !/^https?:/.test(im.f)).map((im) => "/atlas/ai/" + im.f));
    return idx;
  }, () => ({ keys: {}, images: {} }))
  .then(async (idx) => {
    const p = set === "ai" && (await packMedia("pictures"));
    return p ? { keys: { ...idx.keys, ...p.keys }, images: { ...idx.images, ...p.images } } : idx;
  }).then((idx) => (illuSets[set + "Ready"] = idx));
function illuSlot(key) {
  return `<figure class="illu" data-illu="${esc(key)}" hidden></figure>`;
}
async function fillIllus(root) {
  const slots = [...root.querySelectorAll("figure[data-illu]:not(.done)")];
  for (const fig of slots) {
    fig.classList.add("done");
    const set = fig.dataset.illu.startsWith("a:") ? "ai" : "img";
    const idx = await illuSet(set);
    const id = idx.keys[fig.dataset.illu], im = idx.images[id];
    if (!im) continue;
    let src = im.f && mediaSrc(set, im.f); // AI pictures are files of their own, served from R2
    if (!src) {
      illuBuckets[set + im.b] ||= loadJSON(`data/${set}/${im.b}.json`).catch(() => ({}));
      src = (await illuBuckets[set + im.b])[id];
    }
    if (!src) continue;
    const credit = [im.artist, im.license].filter(Boolean).join(" · ");
    fig.classList.toggle("ai", !!im.ai);
    // An AI picture is described by its event ("Battle of Sarhu – AI-generated illustration, …"), the others by their page.
    const ev = im.ai && state.events.find((e) => e.id === fig.dataset.illu.slice(2));
    const alt = im.ai ? (ev ? `${titleOf(ev)} – ${t("aiIllu")}` : t("aiIllu")) : im.page;
    // An AI picture carries its note in the AI badge (tap or hover), not in a caption line.
    const note = im.ai && `${t("aiIllu")} · ${im.ai}`;
    fig.innerHTML = `<img src="${src}" alt="${esc(alt)}" style="aspect-ratio:${im.w}/${im.h}">` + (im.ai
      ? `<button type="button" class="ai-badge" aria-label="${esc(note)}" aria-expanded="false">AI<span class="ai-tip" role="tooltip">${esc(note)}</span></button>`
      : `<figcaption><a href="${esc(im.url)}" target="_blank" rel="noopener">${esc(credit || "Wikimedia Commons")} ↗</a></figcaption>`);
    // A picture that cannot be fetched (offline, or its host unreachable) leaves no broken frame behind.
    fig.querySelector("img").addEventListener("error", () => {
      fig.hidden = true;
      const box = fig.closest(".event-pic, .tour-pic");
      if (box) box.hidden = true;
    });
    fig.hidden = false;
  }
}
function wikiA(url) {
  return url ? `<a href="${esc(wikiLink(url))}" target="_blank" rel="noopener">${t("wiki")} ↗</a>` : "";
}
function pointMarkers(key, items, make) {
  (markers[key] || []).forEach((m) => m.remove());
  markers[key] = [];
  for (const it of items) {
    const { el, card, anchor } = make(it);
    el.dataset.name = nameOf(it);
    if (card) el.addEventListener("click", (e) => { e.stopPropagation(); showCard([it.lon, it.lat], card()); });
    markers[key].push(new maplibregl.Marker({ element: el, anchor: anchor || "center" }).setLngLat([it.lon, it.lat]).addTo(map));
  }
}

function renderPeople() {
  const list = shown("people") ? (state.layerData?.people || []) : [];
  // Alive this year; a person with no birth year shows for the 40 years before death.
  const alive = list.filter((p) => state.year >= personSpan(p)[0] && state.year <= personSpan(p)[1] && selPerson(p));
  // Someone with a life journey stands where they were that year, not at home (the one followed shows as the trail's dot).
  const placed = alive.filter((p) => trail.life?.person !== p.id).map((p) => {
    const life = state.lifeBy?.get(p.id);
    if (!life) return p;
    const s = life.steps[lifeIdx(life, state.year)];
    return { ...p, lon: s.at[0], lat: s.at[1], here: stopPlace(s) };
  });
  pointMarkers("people", placed, (p) => {
    const el = document.createElement("div");
    el.className = "mk-person f-" + p.field + (p.here ? " moves" : "");
    const nm = nameOf(p);
    el.innerHTML = `<i>${esc((p.name_zh || p.name).slice(0, 1))}</i><span>${esc(nm)}<small>${esc(t("fields")[p.field] || "")}${p.here ? ` · ${esc(p.here)}` : ""}</small></span>`;
    return { el, anchor: "left", card: () => personCard(p) };
  });
}
function personLife(p) {
  if (p.died == null && p.born != null) return zh() ? `${fmtYear(p.born, p.circa)}生` : `born ${fmtYear(p.born, p.circa)}`; // living
  return p.died != null ? t("life")(p.born != null ? fmtYear(p.born, p.circa) : "?", fmtYear(p.died, p.circa)) : (zh() ? "生卒不详" : "dates unknown");
}
function personCard(p) {
  cardPerson = p;
  const works = (p.works || []).map((w) => zh() ? `《${esc(w.title_zh || w.title)}》` : `<i>${esc(w.title)}</i>`).join(zh() ? "" : ", ");
  const line = p.line_zh ? `<blockquote><span lang="zh-CN">${esc(p.line_zh)}</span>${!zh() && p.line_en ? `<em>${esc(p.line_en)}</em>` : ""}</blockquote>` : "";
  return `${illuSlot("p:" + p.id)}<div class="pc-kind">${esc(t("fields")[p.field] || p.field)} · ${personLife(p)}</div>
    <h4>${esc(nameOf(p))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? p.name : p.name_zh)}</span></h4>
    <p>${esc(tx(p, "known_for"))}</p>${works ? `<p class="pc-works"><b>${t("works")}</b> ${works}</p>` : ""}${line}
    ${state.lifeOf?.has(p.id) ? `<span class="pc-lives">${trail.life?.person === p.id ? "" : `<button type="button" class="pc-life pc-trail" data-trail="${esc(p.id)}" title="${esc(t("trailHint"))}">◉ ${esc(t("trailShow"))}</button>`}<button type="button" class="pc-life" data-life="${esc(state.lifeOf.get(p.id))}">▶ ${esc(t("followLife"))}</button></span>` : ""}${personEventList(p)}${checkNote(p)}<p class="pc-meta">${esc(tx(p, "place"))} ${wikiA((zh() && p.source_zh) || p.source)}</p>`;
}
function personEventList(p) {
  const evs = personEvents(p);
  if (!evs.length) return "";
  // Highlight the latest event up to the current year, so the list opens there.
  const last = evs.filter((ev) => ev.year <= state.year).pop() || evs[0];
  return `<p class="pc-works"><b>${t("personEvents")(evs.length)}</b></p>${eventButtons(evs, (ev) => ev === last)}`;
}
// Where a person was in this year: their life journey's stop, else home.
function personAt(p) {
  const life = state.lifeBy?.get(p.id);
  return life ? life.steps[lifeIdx(life, state.year)].at : [p.lon, p.lat];
}
// Years a person's marker is on the map: their life, or the 40 years before death when the birth year is unknown.
const personSpan = (p) => p.show ? p.show : [p.born ?? p.died - 40, p.died ?? state.range.end];

function renderCapitals() {
  const list = shown("capitals") ? (state.layerData?.capitals || []) : [];
  const now = list.filter((c) => state.year >= c.from && state.year <= c.to && (!state.sel || selNames().has(c.polity) || selKeep([[c.lon, c.lat]])));
  pointMarkers("capitals", now, (c) => {
    const el = document.createElement("div");
    el.className = "mk-capital";
    el.innerHTML = `<i>★</i><span>${esc(nameOf(c))}<small>${esc(zh() ? (c.polity_zh || c.polity) + "都" : c.polity)}</small></span>`;
    return { el, anchor: "left", card: () => `<div class="pc-kind">${t("capital")} · ${esc(zh() ? c.polity_zh || c.polity : c.polity)}</div>
      <h4>${esc(nameOf(c))}${c.modern_zh ? ` <span>${zh() ? "今" : "modern "}${esc(c.modern_zh)}</span>` : ""}</h4>
      <p class="pc-meta">${fmtYear(c.from)} – ${fmtYear(c.to)}</p>${tx(c, "note") ? `<p>${esc(tx(c, "note"))}</p>` : ""}${capitalEvents(c)}` };
  });
}

// Faith sites and inventions: those of the current era up to this year (in the decades view, of the window).
function cumulative(key, items, cls, glyph, kindLabel) {
  const start = state.zoom === 2 ? state.win[0] : state.era?.start ?? state.year;
  const shown = items.filter((x) => x.year <= state.year && x.year >= start && selKeep([[x.lon, x.lat]]));
  pointMarkers(key, shown, (x) => {
    const recent = x.year >= (state.era?.start ?? state.year);
    const el = document.createElement("div");
    el.className = `${cls} k-${x.kind || x.field}` + (recent ? "" : " old");
    el.innerHTML = `<i>${glyph(x)}</i>` + (recent ? `<span>${esc(nameOf(x))}</span>` : "");
    el.title = `${fmtYear(x.year, x.circa)} · ${nameOf(x)}`;
    return { el, anchor: recent ? "left" : "center", card: () => `<div class="pc-kind">${esc(kindLabel(x))} · ${fmtYear(x.year, x.circa)}</div>
      <h4>${esc(nameOf(x))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? x.name : x.name_zh)}</span></h4>
      <p>${esc(tx(x, "summary"))}</p>${x.inventor ? `<p class="pc-works"><b>${t("inventor")}</b> ${esc(zh() ? x.inventor_zh || x.inventor : x.inventor)}</p>` : ""}
      <p class="pc-meta">${esc(tx(x, "place"))} ${wikiA(x.source)}</p>` };
  });
}
const FAITH_GLYPH = { buddhist: "佛", daoist: "道", confucian: "儒", islam: "伊", christian: "基", thought: "思", other: "宗" };
function renderFaith() {
  cumulative("faith", shown("faith") ? state.overlays.faith : [], "mk-faith", (x) => FAITH_GLYPH[x.kind] || "宗", (x) => t("faiths")[x.kind] || x.kind);
}
// Passes stand from their founding year until abandoned; battles already fought there are listed on the card.
function renderPasses() {
  const list = shown("passes") ? state.passes.filter((x) => state.year >= x.from && (x.to == null || state.year <= x.to) && selKeep([[x.lon, x.lat]])) : [];
  pointMarkers("passes", list, (x) => {
    const el = document.createElement("div");
    el.className = "mk-pass k-" + x.kind;
    el.innerHTML = `<i>关</i><span>${esc(nameOf(x))}</span>`;
    return { el, anchor: "left", card: () => {
      const fought = x.battles.filter((b) => b.year <= state.year);
      return `<div class="pc-kind">${esc(t("pkinds")[x.kind] || "")} · ${esc(t("built")(fmtYear(x.from, x.circa)))}</div>
        <h4>${esc(nameOf(x))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? x.name : x.name_zh)}</span></h4>
        <p class="pc-works"><b>${t("guards")}</b> ${esc(tx(x, "guards"))}</p><p>${esc(tx(x, "summary"))}</p>
        ${fought.length ? `<p class="pc-works"><b>${t("battles")}</b></p><ul class="pc-battles">${fought.map((b) =>
          `<li><span>${fmtYear(b.year)}</span> ${esc(zh() ? b.name_zh : b.name)}</li>`).join("")}</ul>` : ""}
        <p class="pc-meta">${wikiA(x.source)}</p>`;
    } };
  });
}
// Roads in use this year: lines on the map, a name label near the middle, and a card with the stations.
function roadCard(r) {
  return `<div class="pc-kind">${esc(t("rkinds")[r.kind] || "")} · ${t("inUse")} ${fmtYear(r.from, true)} – ${r.to == null ? (zh() ? "清末" : "1912") : fmtYear(r.to)}</div>
    <h4>${esc(nameOf(r))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? r.name : r.name_zh)}</span></h4>
    <p>${esc(tx(r, "summary"))}</p>
    <p class="pc-works"><b>${t("via")}</b> <span lang="zh-CN">${r.via.map((v) => esc(v[2])).join(" — ")}</span></p>
    <p class="pc-meta">${wikiA(r.source)}</p>`;
}
function renderRoads() {
  const list = shown("roads") ? state.roads.filter((r) => state.year >= r.from && (r.to == null || state.year <= r.to) && selKeep(r.via)) : [];
  map.getSource("roads")?.setData({ type: "FeatureCollection", features: list.map((r) => ({
    type: "Feature", properties: { id: r.id, kind: r.kind }, geometry: { type: "LineString", coordinates: r.via.map((v) => [v[0], v[1]]) } })) });
  (markers.roads || []).forEach((m) => m.remove());
  markers.roads = [];
  for (const r of list) {
    const el = document.createElement("div");
    el.className = "mk-road k-" + r.kind;
    el.textContent = nameOf(r);
    el.dataset.name = nameOf(r);
    el.addEventListener("click", (e) => { e.stopPropagation(); showCard(r.via[Math.floor(r.via.length / 2)], roadCard(r)); });
    // Label halfway along, between the two middle stations.
    const i = Math.floor((r.via.length - 1) / 2), a = r.via[i], b = r.via[Math.min(i + 1, r.via.length - 1)];
    markers.roads.push(new maplibregl.Marker({ element: el }).setLngLat([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]).addTo(map));
  }
}
// Elite groups active this year: a tinted area around their home seats and a label with a card.
const CLAN = { gentry: ["#8e5bb5", "族"], bloc: ["#d07a22", "集"], military: ["#b0405f", "军"], faction: ["#2f6fb0", "党"], merchant: ["#a88420", "商"] };
function clanCard(g) {
  return `<div class="pc-kind">${esc(t("ckinds")[g.kind] || "")} · ${fmtYear(g.from, true)} – ${fmtYear(g.to, true)}</div>
    <h4>${esc(nameOf(g))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? g.name : g.name_zh)}</span></h4>
    <p>${esc(tx(g, "summary"))}</p>
    <p class="pc-works"><b>${t("families")}</b> ${esc(tx(g, "families"))}</p>
    <p class="pc-works"><b>${t("members")}</b> ${esc(tx(g, "people"))}</p>
    <p class="pc-works"><b>${t("seats")}</b> <span lang="zh-CN">${g.seats.map((v) => esc(v[2])).join("、")}</span></p>
    <p class="pc-meta">${t("drafted")} ${wikiA(g.source)}</p>`;
}
function renderClans() {
  const list = shown("clans") ? state.clans.filter((g) => state.year >= g.from && state.year <= g.to && selKeep(g.seats)) : [];
  map.getSource("clans")?.setData({ type: "FeatureCollection", features: list.map((g) => ({
    type: "Feature", properties: { id: g.id, color: CLAN[g.kind][0] }, geometry: g.geometry })) });
  pointMarkers("clans", list.map((g) => ({ ...g, lon: g.label[0], lat: g.label[1] })), (g) => {
    const el = document.createElement("div");
    el.className = "mk-clan k-" + g.kind;
    el.style.setProperty("--c", CLAN[g.kind][0]);
    el.innerHTML = `<i>${CLAN[g.kind][1]}</i><span>${esc(nameOf(g))}</span>`;
    return { el, anchor: "left", card: () => clanCard(g) };
  });
}
// Great Walls: those manned this year drawn in full with a label; those abandoned before now as faint ruins.
function wallCard(w) {
  const ruin = state.year > w.to;
  return `<div class="pc-kind">${t("walls")} · ${fmtYear(w.from, true)} – ${fmtYear(w.to, true)}</div>
    <h4>${esc(nameOf(w))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? w.name : w.name_zh)}</span></h4>
    <p class="pc-works"><b>${t("wallBy")}</b> ${esc(tx(w, "builder"))} · ${t("wallLen")(w.length_km)}</p>
    <p>${esc(tx(w, "summary"))}</p>${ruin ? `<p class="pc-meta">${t("ruin")}</p>` : ""}
    <p class="pc-meta">${t("drafted")} ${wikiA(w.source)}</p>`;
}
// Administrative seats (政区: 郡/州/府/路/军… 治所): one drafted snapshot per dynasty (data/admin.json, built by
// tools/build_admin.py), shown through that dynasty's years as far as each unit's own years allow. Dots for all of
// them; names from zoom 5 on, for the seats in view. A card can look the seat up live in CHGIS's Temporal Gazetteer.
const ADMIN_LABEL_ZOOM = 5;
let adminLoad, areasLoad;
// data/admin-areas.json (tools/build_admin_areas.py): one sketch polygon per seat, keyed by its index in admin.json.
function adminAreas() {
  if (state.adminAreas) return state.adminAreas;
  areasLoad ||= loadJSON("data/admin-areas.json").then((d) => {
    state.adminAreas = new Map(d.features.map((f) => [f.properties.i, f]));
    renderAdmin();
  }).catch(() => { state.adminAreas = new Map(); });
  return null;
}
function adminData() {
  if (state.admin) return state.admin;
  adminLoad ||= loadJSON("data/admin.json").then((d) => {
    const F = d.fields;
    state.admin = { ...d, items: d.items.map((r, i) => {
      const o = { i };
      F.forEach((f, k) => (o[f] = r[k]));
      o.lv = d.types[o.type]?.[2] ?? 2;
      return o;
    }) };
    renderAdmin();
  }).catch(() => { state.admin = { items: [], types: [] }; });
  return null;
}
// The China period this year falls in: its snapshot is the one shown.
const chinaEraAt = (y) => (state.chinaEras || []).find((e) => y >= e.start && y <= e.end)?.id;
const adminNow = (x, y = state.year) => x.era === chinaEraAt(y) && y >= x.from && (x.to == null || y <= x.to);
function adminList() {
  const d = shown("admin") ? adminData() : null;
  if (!d) return [];
  // A period with several snapshots (唐 639, 742, 820) can have two records of one seat valid in the same year:
  // the record from the snapshot nearest this year wins.
  const now = d.items.filter((x) => adminNow(x) && selKeep([[x.lon, x.lat]]))
    .sort((a, b) => Math.abs(a.snap - state.year) - Math.abs(b.snap - state.year));
  const kept = [];
  for (const x of now) {
    if (!kept.some((o) => o.snap !== x.snap && Math.abs(o.lon - x.lon) < 0.2 && Math.abs(o.lat - x.lat) < 0.2)) kept.push(x);
  }
  return kept;
}
const adminType = (x) => { const T = state.admin.types[x.type] || []; return zh() ? T[0] : T[1]; };
const adminName = (x) => (zh() ? x.name_zh : x.name);
function renderAdmin() {
  const list = adminList();
  state.adminShown = list;
  map.getSource("admin")?.setData({ type: "FeatureCollection", features: list.map((x) => ({
    type: "Feature", properties: { i: x.i, lv: x.lv }, geometry: { type: "Point", coordinates: [x.lon, x.lat] } })) });
  const areas = list.length ? adminAreas() : null;
  map.getSource("adminAreas")?.setData({ type: "FeatureCollection", features: areas ? list.map((x) => areas.get(x.i))
    .filter(Boolean).map((f) => ({ ...f, properties: { i: f.properties.i, lv: state.admin.items[f.properties.i].lv } })) : [] });
  if (map.getLayer("admin-area-on") && !list.some((x) => x.i === state.adminOn)) adminHighlight(null);
  renderAdminLabels();
}
function renderAdminLabels() {
  (markers.admin || []).forEach((m) => m.remove());
  markers.admin = [];
  if (!map || map.getZoom() < ADMIN_LABEL_ZOOM || !state.adminShown?.length) return scheduleDeclutter();
  const b = map.getBounds();
  for (const x of state.adminShown) {
    if (!b.contains([x.lon, x.lat])) continue;
    const el = document.createElement("div");
    el.className = "mk-admin lv-" + x.lv + (x.conf === 0 ? " unsure" : "");
    el.textContent = adminName(x);
    el.dataset.name = adminName(x);
    el.addEventListener("click", (e) => { e.stopPropagation(); openAdmin(x); });
    markers.admin.push(new maplibregl.Marker({ element: el, anchor: "left", offset: [6, 0] }).setLngLat([x.lon, x.lat]).addTo(map));
  }
  scheduleDeclutter();
}
const adminSpan = (x) => `${fmtYear(x.from)} – ${x.to == null ? "" : fmtYear(x.to)}`;
function adminCard(x) {
  // Every snapshot's seat at this site (within ~5 km), oldest first: how the unit here was named dynasty by dynasty.
  const site = state.admin.items.filter((o) => Math.abs(o.lon - x.lon) < 0.05 && Math.abs(o.lat - x.lat) < 0.05)
    .sort((a, b) => a.snap - b.snap);
  const seat = x.seat_zh && (zh() ? `${t("adminSeat")} ${x.seat_zh}` : `${t("adminSeat")}: ${x.seat_zh}`);
  return `<div class="pc-kind">${esc(adminType(x))}${x.state ? ` · ${esc(x.state)}` : ""} · ${adminSpan(x)}</div>
    <h4>${esc(adminName(x))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? x.name : x.name_zh)}</span></h4>
    ${x.was_zh ? `<p class="pc-works"><b>${t("adminWas")}</b> <span lang="zh-CN">${esc(x.was_zh)}</span></p>` : ""}
    <p class="pc-works">${seat ? `<span lang="zh-CN">${esc(seat)}</span>　` : ""}${x.modern_zh ? `<b>${t("adminNow")}</b> <span lang="zh-CN">${esc(x.modern_zh.replace(/^今/, ""))}</span>` : ""}</p>
    <div class="pc-gaz" data-gaz="a:${x.i}">${site.length > 1 ? `<p class="pc-works"><b>${t("adminSite")}</b></p><ul class="pc-battles pc-admin">${site.map((o) =>
      `<li${o === x ? ' class="on"' : ""} data-admin-year="${o.snap}"><span>${fmtYear(o.snap)}</span> ${esc(adminName(o))} <small>${esc(adminType(o))}</small></li>`).join("")}</ul>` : ""}</div>
    <div class="pc-chgis" data-chgis="${x.i}"><button type="button" class="pc-life">${t("adminChgis")}</button></div>
    <p class="pc-meta">${t("adminSnap")(fmtYear(x.snap))}${x.conf === 0 ? ` · ${t("adminUnsure")}` : ""}</p>`;
}
// The card's history list opens scrolled to the record shown.
function adminHighlight(i) {
  state.adminOn = i;
  map.setFilter("admin-area-on", ["==", ["get", "i"], i ?? -1]);
}
function openAdmin(x) {
  showCard([x.lon, x.lat], adminCard(x));
  adminHighlight(x.i);
  popup.on("close", () => { if (state.adminOn === x.i) adminHighlight(null); });
  requestAnimationFrame(() => {
    const li = document.querySelector(".pc-admin li.on"), ul = li?.parentElement;
    if (ul) ul.scrollTop = li.offsetTop - ul.offsetTop - ul.clientHeight / 2;
  });
}
// CHGIS's own record for a seat, fetched only when the reader asks (the 「CHGIS 记录」 button): one call per seat and
// year, kept for the visit, at most one call a second from this browser, and nothing shown if Harvard is slow or
// down. CHGIS's data stays on Harvard's server; the atlas only shows what the reader looked up.
const TGAZ = "https://chgis.hudci.org/tgaz/placename";
const tgazCache = new Map();
let tgazLast = 0;
async function tgazLookup(x, year) {
  const key = `${x.name_zh}|${year}`;
  if (tgazCache.has(key)) return tgazCache.get(key);
  const wait = tgazLast + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  tgazLast = Date.now();
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
  const p = fetch(`${TGAZ}?fmt=json&n=${encodeURIComponent(x.name_zh)}&yr=${year}`, { signal: ctl.signal })
    .then((r) => r.json()).then((d) => (d.placenames || []).map((p) => {
      const [lon, lat] = String(p["xy coordinates"] || "").split(",").map(Number);
      return { ...p, lon, lat };
    // The same unit nearby (CHGIS also has villages and counties of the same name elsewhere).
    }).filter((p) => p.name === x.name_zh && p.lon && Math.abs(p.lon - x.lon) < 0.6 && Math.abs(p.lat - x.lat) < 0.6))
    .catch(() => null).finally(() => clearTimeout(timer));
  tgazCache.set(key, p);
  const out = await p;
  if (out == null) tgazCache.delete(key);   // try again next time
  return out;
}
async function showChgis(box) {
  const x = state.admin.items[+box.dataset.chgis];
  box.innerHTML = `<p class="pc-meta">${t("adminChgisWait")}</p>`;
  const year = Math.min(Math.max(state.year, x.from), x.to ?? state.year);
  const found = await tgazLookup(x, year);
  if (!box.isConnected) return;
  box.innerHTML = found == null ? `<p class="pc-meta">${t("adminChgisDown")}</p>`
    : !found.length ? `<p class="pc-meta">${t("adminChgisNone")}</p>`
    : `<ul class="pc-battles pc-chgis-list">${found.slice(0, 4).map((p) => `<li><span>${esc(String(p.years || "").replace(/\s*~\s*/, "–"))}</span> ${esc(p.name)} <small>${esc(String(p["feature type"] || "").replace(/\s*\(.*\)/, ""))}${p["parent name"] ? ` · ${esc(String(p["parent name"]).replace(/\s*\(.*\)/, ""))}` : ""}</small> <a href="${esc(p.uri)}" target="_blank" rel="noopener">↗</a></li>`).join("")}</ul>
      <p class="pc-meta">${t("adminChgisSrc")}${found.some((p) => Math.hypot(p.lon - x.lon, p.lat - x.lat) > 0.25) ? ` · ${t("adminChgisMoved")}` : ""}</p>`;
}
document.addEventListener("click", (e) => {
  const box = e.target.closest?.(".pc-chgis");
  if (box && e.target.closest("button")) return showChgis(box);
  const li = e.target.closest?.("[data-admin-year]");
  if (li) jumpToYear(+li.dataset.adminYear);
});
// 地名古今 (data/gazetteer.json, tools/build_gazetteer.py): for each site (a city with the seats at it, or seats no
// city claims), every China period's names, who held it at each of the period's maps, and the 郡/州 it lay in when it
// was no seat itself, down to its modern name. Loaded with the first city or seat card; city and seat cards show it.
let gazLoad;
function gazData() {
  if (state.gaz) return state.gaz;
  gazLoad ||= loadJSON("data/gazetteer.json").then((d) => {
    const byCity = new Map(), byAdmin = new Map();
    d.sites.forEach((s, k) => { s.k = k; if (s.city) byCity.set(s.city, s); for (const i of s.adm || []) byAdmin.set(i, s); });
    state.gaz = { ...d, byCity, byAdmin };
    document.querySelectorAll(".pc-gaz[data-gaz]").forEach(fillGaz);
    if (!$("search").hidden) renderSearch();
  }).catch(() => { state.gaz = { names: [], eras: [], sites: [], byCity: new Map(), byAdmin: new Map() }; });
  return null;
}
// data-gaz keys: c:<city id>, a:<admin index>, s:<site index>
function gazSite(key) {
  const g = state.gaz, [k, v] = [key.slice(0, 1), key.slice(2)];
  return k === "c" ? g.byCity.get(v) : k === "a" ? g.byAdmin.get(+v) : g.sites[+v];
}
const gazName = (i) => { const n = state.gaz.names[i]; return zh() ? n[0] : n[1]; };
const gazNow = (s) => (zh() ? s.now[0] : s.now[1] || s.now[0]);
function gazRows(s) {
  const G = state.gaz, cur = chinaEraAt(state.year);
  const rows = s.rows.map(([ei, y, city, seats, hold, units]) => {
    const e = state.chinaEras.find((e) => e.id === G.eras[ei]);
    if (!e) return "";
    // The holder is left out when it is the period's own dynasty (唐 in 唐).
    const own = hold.length === 1 && [e.name_zh, e.glyph].includes(G.names[hold[0][1]][0]);
    const held = hold.length && !own ? `<small class="gz-held">${t("gazHeld")} ${hold.map(([hy, h]) =>
      `<i data-gaz-year="${hy}" title="${fmtYear(hy)}">${esc(gazName(h))}</i>`).join(" → ")}</small>` : "";
    const lay = units?.length ? `<small>${t("gazIn")} ${units.map((u) => esc(gazName(u))).join(zh() ? "、" : ", ")}</small>` : "";
    const names = city.length ? `<b>${city.map((n) => esc(gazName(n))).join(zh() ? "、" : ", ")}</b>` : "";
    const seat = seats.length ? `<small class="gz-seat">${seats.map((n) => esc(gazName(n))).join(" · ")}</small>` : "";
    return `<li data-gaz-year="${y}"${e.id === cur ? ' class="on"' : ""}><span>${esc(zh() ? e.name_zh : e.short || e.name)}</span><div>${names}${seat}${held}${lay}${names || seat ? "" : `<em>—</em>`}</div></li>`;
  }).join("");
  const now = gazNow(s);
  return `<p class="pc-works"><b>${t("gazHead")}</b></p><ul class="pc-gazlist">${rows}${now ? `<li class="today"><span>${t("adminNow")}</span><div><b>${esc(now)}</b></div></li>` : ""}</ul>`;
}
function fillGaz(box) {
  if (!gazData()) return;    // fills when the file arrives
  const s = gazSite(box.dataset.gaz);
  if (!s) return;            // keeps whatever the card put there
  box.innerHTML = gazRows(s);
  gazScroll(box);
}
function gazScroll(box) {
  const li = box.querySelector("li.on"), ul = li?.parentElement;
  if (ul) ul.scrollTop = li.offsetTop - ul.offsetTop - ul.clientHeight / 2 + li.offsetHeight / 2;
}
// A card of its own for a site found by search (a seat or an old name).
function gazCard(s, title) {
  const now = gazNow(s);
  return `<div class="pc-kind">${t("gazKind")}</div>
    <h4>${esc(title)}${now ? ` <span lang="zh-CN">${esc(zh() ? `今${now}` : now)}</span>` : ""}</h4>
    <div class="pc-gaz" data-gaz="s:${s.k}"></div><p class="pc-meta">${t("gazNote")}</p>`;
}
document.addEventListener("click", async (e) => {
  const hit = e.target.closest?.(".pc-gazlist [data-gaz-year]");
  if (!hit) return;
  await jumpToYear(+hit.dataset.gazYear);
  // The open card stays; its row for the new period lights up.
  const box = hit.closest(".pc-gaz");
  if (box?.isConnected) { box.innerHTML = gazRows(gazSite(box.dataset.gaz)); gazScroll(box); }
});
// Search: sites by any name they ever had or by their modern name, beyond the cities search already lists.
function gazSearch(has, citiesFound) {
  const G = state.gaz, out = [];
  if (!G) return out;
  for (const s of G.sites) {
    if (s.city && citiesFound.has(s.city)) continue;
    let row = s.rows.find((r) => [...r[2], ...r[3]].some((n) => has(...G.names[n])));
    if (!row && !s.city && has(...s.now)) row = s.rows[s.rows.length - 1];
    if (!row) continue;
    const n = [...row[2], ...row[3]].find((n) => has(...G.names[n])) ?? row[3][0] ?? row[2][0];
    const e = state.chinaEras.find((e) => e.id === G.eras[row[0]]);
    out.push({ g: "place", year: row[1], title: gazName(n), sub: `${e ? nameOf(e) + " · " : ""}${zh() ? "今" : "modern "}${gazNow(s)}`,
      go: () => jumpToGaz(s, row[1], gazName(n)) });
    if (out.length >= 8) break;
  }
  return out;
}
async function jumpToGaz(s, y, title) {
  await jumpToYear(y);
  map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 6), duration: 1200, essential: true });
  map.once("moveend", () => showCard([s.lon, s.lat], gazCard(s, title)));
}
function renderWalls() {
  const list = shown("walls") ? state.walls.filter((w) => state.year >= w.from && (!state.sel || w.paths.some(selKeep))) : [];
  const feats = [];
  for (const w of list) for (const p of w.paths)
    feats.push({ type: "Feature", properties: { id: w.id, ruin: state.year > w.to }, geometry: { type: "LineString", coordinates: p } });
  map.getSource("walls")?.setData({ type: "FeatureCollection", features: feats });
  (markers.walls || []).forEach((m) => m.remove());
  markers.walls = [];
  for (const w of list.filter((w) => state.year <= w.to)) {
    const el = document.createElement("div");
    el.className = "mk-road mk-wall";
    el.textContent = nameOf(w);
    el.dataset.name = nameOf(w);
    const p = w.paths[0], mid = p[Math.floor(p.length / 2)];
    el.addEventListener("click", (e) => { e.stopPropagation(); showCard(mid, wallCard(w)); });
    markers.walls.push(new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -6] }).setLngLat(mid).addTo(map));
  }
}
function renderInventions() {
  cumulative("inventions", shown("inventions") ? state.overlays.inventions : [], "mk-invention", () => "✦", (x) => t("ifields")[x.field] || x.field);
}

// Population: a dot chart in the era card on the same nonlinear scale as the timeline, with the latest figure.
// Dots, not a line: the figures mix censuses of one state, totals and scholars' estimates, so they don't form a series.
function renderPopulation() {
  const box = $("pop-chart");
  const pts = state.overlays.population;
  box.hidden = !shown("capitals") || !pts.length;
  if (box.hidden) return;
  const W = 288, H = 54, max = Math.max(...pts.map((p) => p.millions));
  const sx = (y) => {
    const s = state.scale.find((s) => y >= s.era.start && y <= s.era.end) || state.scale[state.scale.length - 1];
    return ((s.p0 + ((y - s.era.start) / (s.era.end + 1 - s.era.start)) * (s.p1 - s.p0)) / SLIDER_MAX) * W;
  };
  const sy = (m) => H - 4 - (m / max) * (H - 12);
  const last = [...pts].reverse().find((p) => p.year <= state.year);
  const cx = sx(state.year);
  box.innerHTML = `<div class="pop-head"><b>${t("pop")}</b><span>${last ? esc(t("popOf")(last.millions, fmtYear(last.year), last.kind)) + (last.polity_zh && zh() ? " · " + esc(last.polity_zh) : "") : "—"}</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t("pop")}">
      ${pts.map((p) => `<circle class="pop-pt ${esc(p.kind)}${p === last ? " on" : ""}" cx="${sx(p.year).toFixed(1)}" cy="${sy(p.millions).toFixed(1)}" r="${p === last ? 3.5 : 2}"><title>${esc(fmtYear(p.year))} · ${p.millions}${zh() ? "百万" : "M"} ${esc(tx(p, "note"))}</title></circle>`).join("")}
      <line class="pop-now" x1="${cx}" x2="${cx}" y1="0" y2="${H}"/>
    </svg>`;
}

// Climate and disasters (气候与灾害, data/climate.json from tools/build_climate.py): droughts, floods, locusts, famines,
// quakes, epidemics, cold winters and Yellow River breaches stand on the map while they last (and fade for a few years
// after); a strip in the era panel draws the temperature sketch with its warm and cold phases across the whole timeline,
// with the disasters, revolts and capital moves as ticks, so the three can be read against each other.
const DIS = { drought: ["#c9852b", "旱"], flood: ["#2f7fc1", "涝"], locust: ["#7f9a2a", "蝗"], famine: ["#8a5a3c", "饥"],
  quake: ["#8d5bb0", "震"], plague: ["#b0405f", "疫"], cold: ["#5aa7c9", "寒"], river: ["#2a5f8f", "河"] };
const DIS_LINGER = 3;
const disNow = (d, y = state.year) => y >= d.from && y <= d.to + DIS_LINGER;
function anomalyAt(y) {
  const c = state.climate?.curve;
  if (!c?.length) return null;
  if (y <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (y <= c[i][0]) {
    const [y0, a0] = c[i - 1], [y1, a1] = c[i];
    return a0 + ((y - y0) / (y1 - y0)) * (a1 - a0);
  }
  return c[c.length - 1][1];
}
// The innermost warm or cold phase around a year (the coldest century sits inside the Little Ice Age).
const climPhase = (y) => (state.climate?.periods || []).filter((p) => y >= p.from && y <= p.to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
function circleGeom(lon, lat, km) {
  const ring = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    ring.push([lon + (km / (111.3 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 111.3) * Math.sin(a)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}
const chinaEv = (ev) => !ev.region && ev.year != null;
const isCapMove = (ev) => chinaEv(ev) && /迁都|定都|建都|南渡|东迁|西迁/.test(ev.title_zh || "");
const isRevolt = (ev) => chinaEv(ev) && ev.category === "rebellion" && (ev.level || 1) <= 2;
function disasterCard(d) {
  const [col] = DIS[d.kind] || ["#888"];
  const years = d.to > d.from ? `${fmtYear(d.from, d.circa)} – ${fmtYear(d.to)}` : fmtYear(d.from, d.circa);
  const byId = (id) => state.events.find((e) => e.id === id);
  const linked = (d.events || []).map(byId).filter(Boolean);
  // Revolts and capital moves in China from just before to a decade after, near enough to the stricken area.
  const far = Math.max(6, (d.r_km * 1.8) / 111);
  const around = state.events.filter((ev) => (isRevolt(ev) || isCapMove(ev)) && !linked.includes(ev) && ev.year >= d.from - 2 && ev.year <= d.to + 12
    && (ev.lon == null || Math.hypot(ev.lon - d.lon, ev.lat - d.lat) < far)).sort((a, b) => a.year - b.year).slice(0, 5);
  const ph = climPhase(d.from), a = anomalyAt(d.from);
  const now = (ev) => ev.year <= state.year && state.year <= ev.year + 5;
  return `<div class="pc-kind" style="color:${col}">${esc(t("climKinds")[d.kind] || d.kind)} · ${years}</div>
    <h4>${esc(nameOf(d))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? d.name : d.name_zh)}</span></h4>
    <p class="pc-works"><b>${t("climArea")}</b> ${esc(tx(d, "area"))}</p>
    ${tx(d, "toll") ? `<p class="pc-works"><b>${t("climToll")}</b> ${esc(tx(d, "toll"))}</p>` : ""}
    <p>${esc(tx(d, "summary"))}</p>
    ${a != null ? `<p class="pc-works"><b>${t("climPhase")}</b> ${esc(t("climNow")(a, ph ? nameOf(ph) : ""))}</p>` : ""}
    ${linked.length ? `<p class="pc-works"><b>${t("climLinked")}</b></p>${eventButtons(linked, now)}` : ""}
    ${around.length ? `<p class="pc-works"><b>${t("climAfter")}</b></p>${eventButtons(around, now)}` : ""}
    <p class="pc-meta">${t("drafted")} ${wikiA(d.source)}</p>`;
}
function renderDisasters() {
  const list = shown("climate") && state.climate ? state.climate.disasters.filter((d) => disNow(d) && selKeep([[d.lon, d.lat]])) : [];
  map.getSource("disasters")?.setData({ type: "FeatureCollection", features: list.map((d) => ({
    type: "Feature", properties: { id: d.id, color: (DIS[d.kind] || ["#888"])[0], past: state.year > d.to }, geometry: circleGeom(d.lon, d.lat, d.r_km) })) });
  pointMarkers("disasters", list, (d) => {
    const el = document.createElement("div");
    const past = state.year > d.to;
    el.className = "mk-dis k-" + d.kind + (past ? " past" : "");
    el.style.setProperty("--c", (DIS[d.kind] || ["#888"])[0]);
    el.innerHTML = `<i>${(DIS[d.kind] || ["", "灾"])[1]}</i>` + (past ? "" : `<span>${esc(nameOf(d))}</span>`);
    el.title = `${fmtYear(d.from, d.circa)} · ${nameOf(d)}`;
    return { el, anchor: past ? "center" : "left", card: () => disasterCard(d) };
  });
}
function renderClimChart() {
  const box = $("clim-chart");
  const c = state.climate;
  box.hidden = !shown("climate") || !c || !state.scale?.length;
  if (box.hidden) return;
  const W = 288, H = 66, top = 9, bot = H - 9, lo = -1.3, hi = 1.8;
  const first = state.scale[0].era.start, last = state.scale[state.scale.length - 1].era.end;
  const sx = (y) => {
    const s = state.scale.find((s) => y >= s.era.start && y <= s.era.end) || (y < first ? state.scale[0] : state.scale[state.scale.length - 1]);
    const f = Math.min(1, Math.max(0, (y - s.era.start) / (s.era.end + 1 - s.era.start)));
    return ((s.p0 + f * (s.p1 - s.p0)) / SLIDER_MAX) * W;
  };
  const sy = (a) => bot - ((a - lo) / (hi - lo)) * (bot - top);
  const pts = c.curve.filter(([y]) => y >= first - 10 && y <= last + 10);
  const line = pts.map(([y, a], i) => `${i ? "L" : "M"}${sx(y).toFixed(1)},${sy(a).toFixed(1)}`).join("");
  const z = sy(0).toFixed(1);
  const bands = c.periods.filter((p) => p.to >= first && p.from <= last).map((p) => {
    const x0 = sx(Math.max(p.from, first)), x1 = sx(Math.min(p.to, last));
    return `<rect class="cl-band ${p.kind}" x="${x0.toFixed(1)}" width="${Math.max(0.8, x1 - x0).toFixed(1)}" y="${top}" height="${bot - top}"><title>${esc(nameOf(p))} · ${fmtYear(p.from, p.circa)} – ${fmtYear(p.to)}</title></rect>`;
  }).join("");
  const tick = (cls, x, y0, y1, title, data, color) => `<line class="${cls}"${color ? ` style="stroke:${color}"` : ""} x1="${x}" x2="${x}" y1="${y0}" y2="${y1}"/><rect class="cl-hit" x="${(x - 2).toFixed(1)}" width="4" y="${y0 - 1}" height="${y1 - y0 + 2}" ${data}><title>${esc(title)}</title></rect>`;
  const dis = c.disasters.filter((d) => d.from >= first && d.from <= last).map((d) =>
    tick("cl-dis", sx(d.from).toFixed(1), H - 7, H, `${fmtYear(d.from, d.circa)} · ${nameOf(d)}`, `data-dis="${esc(d.id)}"`, (DIS[d.kind] || ["#888"])[0])).join("");
  const evTicks = state.events.filter((ev) => (isRevolt(ev) || isCapMove(ev)) && ev.year >= first && ev.year <= last).map((ev) =>
    tick(isCapMove(ev) ? "cl-cap" : "cl-reb", sx(ev.year).toFixed(1), 0, 6, `${fmtYear(ev.year, ev.circa)} · ${zh() ? ev.title_zh || ev.title : ev.title}`, `data-ev="${esc(ev.id)}"`)).join("");
  const a = anomalyAt(state.year), ph = climPhase(state.year), cx = sx(state.year).toFixed(1);
  const china = state.mode === "china";
  box.innerHTML = `<div class="pop-head"><b>${t("climHead")}</b><span title="${esc(t("climCurve"))}">${a == null ? "—" : esc(t("climNow")(a, ph ? nameOf(ph) : ""))}</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t("climHead"))}">
      ${bands}<line class="cl-zero" x1="0" x2="${W}" y1="${z}" y2="${z}"/>
      <path class="cl-line" d="${line}"/>${china ? evTicks : ""}${dis}
      <line class="pop-now" x1="${cx}" x2="${cx}" y1="0" y2="${H}"/>
    </svg>
    <div class="cl-key"><span class="k-reb">${t("climKey").reb}</span><span class="k-cap">${t("climKey").cap}</span><span class="k-dis">${t("climKey").dis}</span><span class="cl-src" title="${esc(t("climCurve"))}">${china ? t("climNote") : t("climElse")}</span></div>`;
  box.querySelectorAll("[data-ev]").forEach((r) => r.addEventListener("click", () => openStory(r.dataset.ev)));
  box.querySelectorAll("[data-dis]").forEach((r) => r.addEventListener("click", async () => {
    const d = c.disasters.find((x) => x.id === r.dataset.dis);
    if (!d) return;
    await setYear(d.from);
    map.easeTo({ center: [d.lon, d.lat], duration: 800 });
    showCard([d.lon, d.lat], disasterCard(d));
  }));
}

function updateRulers() {
  const focus = [];
  for (const p of markers.polityEls) {
    p.el.querySelector(".ruler")?.remove();
    const r = shown("rulers") && (!state.sel || selNames().has(p.name)) && rulerAt(p.name, state.year);
    if (!r) continue;
    if (p.focus) focus.push(r);
    const [title, name] = rulerText(r);
    const span = document.createElement("span");
    span.className = "ruler";
    span.innerHTML = esc(title) + (name ? ` <em>${esc(name)}</em>` : "");
    p.el.appendChild(span);
  }
  // The era card names the ruler when one dynasty holds the map.
  const line = $("era-ruler");
  const single = !markers.polityEls.some((p) => p.focus && p.state) && focus.length === 1 ? focus[0] : null;
  line.hidden = !single;
  if (single) {
    const [title, name] = rulerText(single);
    line.textContent = `${t("ruler")}${title}${name ? (zh() ? " " : " (") + name + (zh() ? "" : ")") : ""} · ${t("reign")(fmtYear(single.from, single.circa).replace(/年$/, ""), fmtYear(single.to).replace(/年$/, ""))}`;
  }
}

function unitsText(units) {
  return (units || []).map((u) => `<span class="unit u-${esc(u)}">${esc(t("units")[u] || u)}</span>`).join("");
}
function sideHTML(sd) {
  const cmd = (sd.commanders || []).map((c) => esc(zh() ? c.name_zh || c.name : c.name)).join(zh() ? "、" : ", ");
  const troops = (zh() ? sd.troops_text_zh || sd.troops_text : sd.troops_text) || (sd.troops ? sd.troops.toLocaleString() : t("unknown"));
  const res = t("result")[sd.result] || "";
  return `<div class="side ${esc(sd.result || "")}">
    <div class="side-head"><b>${esc(zh() ? sd.name_zh || sd.name : sd.name)}</b>${res ? `<span class="res">${res}</span>` : ""}</div>
    ${cmd ? `<div class="cmd">${cmd}</div>` : ""}
    <div class="troops"><span>${t("troops")}</span> ${esc(troops)}</div>
    <div class="units">${unitsText(sd.units)}</div></div>`;
}
// A bar comparing the sides' strength, when every side has a number.
function strengthBar(sides) {
  if (sides.length < 2 || sides.some((s) => !s.troops)) return "";
  return `<div class="strength">${sides.map((s, i) => `<i class="s${i} ${esc(s.result || "")}" style="flex:${s.troops}"></i>`).join("")}</div>`;
}
function armiesHTML(a) {
  const note = zh() ? a.note_zh || a.note : a.note;
  const losses = zh() ? a.losses_zh || a.losses : a.losses;
  return `<div class="sides">${a.sides.map(sideHTML).join("")}</div>${strengthBar(a.sides)}` +
    (losses ? `<p class="army-losses"><span>${t("losses")}</span> ${esc(losses)}</p>` : "") +
    (note ? `<p class="army-note">${esc(note)}</p>` : "");
}

// A marker anchored by its middle or bottom is shifted by -50% / -100% of its own size; when that size has a
// fractional height (line heights like 1.35 x 12px) the card lands between pixels and its text blurs. Round the
// height up to whole pixels once it is laid out.
// A map-pinned card placed with plain whole-pixel left/top. MapLibre markers carry rotateX/rotateZ and
// will-change: transform, which puts them on a GPU layer whose text some browsers leave blurry once the map
// has been clicked or moved. Offers the getElement()/remove() that the marker code uses.
function flatCard(el, lngLat, offsetY) {
  el.classList.add("flat-card");
  map.getCanvasContainer().appendChild(el);
  const place = () => {
    const p = map.project(lngLat);
    el.style.left = Math.round(p.x - el.offsetWidth / 2) + "px";
    el.style.top = Math.round(p.y - el.offsetHeight + offsetY) + "px";
  };
  place();
  map.on("move", place);
  map.on("resize", place);
  requestAnimationFrame(place);
  return { getElement: () => el, remove() { map.off("move", place); map.off("resize", place); el.remove(); } };
}

// Battle cards stand over the war site while the battle is current (or selected); at most three at once.
// A card closed with × stays closed until its event is picked again.
function renderArmies() {
  markers.armies.forEach((m) => m.remove());
  markers.armies = [];
  const data = state.layerData?.armies;
  if (!shown("armies") || !data || !state.era) return;
  // On a tour only the current step's battle is shown; earlier steps' armies are cleared.
  const step = state.tour?.tr.steps[state.tour.i];
  const evs = step ? state.events.filter((ev) => ev.id === step.event && data[ev.id] && !state.closedArmies.has(ev.id)) : visibleEvents()
    .filter((ev) => data[ev.id] && !state.closedArmies.has(ev.id) && ev.year <= state.year && (isActive(ev, state.year) || ev.id === state.selected))
    .sort((a, b) => (b.id === state.selected) - (a.id === state.selected) || b.year - a.year)
    .slice(0, 3);
  for (const ev of evs) {
    const el = document.createElement("div");
    el.className = "mk-army" + (ev.id === state.selected ? " selected" : "");
    el.innerHTML = `<div class="army-title">${esc(titleOf(ev))}<span>${fmtYear(ev.year, ev.circa)}</span>` +
      `<button type="button" class="army-close" aria-label="${t("close")}" title="${t("close")}">×</button></div>` + armiesHTML(data[ev.id]);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.closest(".army-close")) { state.closedArmies.add(ev.id); renderArmies(); return; }
      openStory(ev.id);
    });
    markers.armies.push(flatCard(el, [ev.lon, ev.lat], -16));
  }
}

// Campaigns and journeys grow along their path from their first to their last year; the rest show whole.
function partialPath(path, f) {
  if (f >= 1) return path;
  const seg = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    // A dateline jump ([180, lat] to [-180, lat]) has no length.
    const d = Math.abs(path[i][0] - path[i - 1][0]) > 180 ? 0 : Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    seg.push(d); total += d;
  }
  let left = total * f;
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (left >= seg[i - 1] && (seg[i - 1] > 0 || left > 0)) { out.push(path[i]); left -= seg[i - 1]; continue; }
    if (!seg[i - 1]) break;
    const k = left / seg[i - 1];
    out.push([path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k]);
    break;
  }
  return out;
}
// A line that crosses the dateline is split there ([180, lat] then [-180, lat]) so it isn't drawn across the whole map.
function lineGeom(path) {
  const parts = [[path[0]]];
  for (let i = 1; i < path.length; i++) {
    if (Math.abs(path[i][0] - path[i - 1][0]) > 180) parts.push([]);
    parts[parts.length - 1].push(path[i]);
  }
  const ok = parts.filter((p) => p.length > 1);
  return ok.length === 1 ? { type: "LineString", coordinates: ok[0] } : { type: "MultiLineString", coordinates: ok };
}
function bearing(a, b) {
  const rad = Math.PI / 180;
  return Math.atan2((b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * rad), b[1] - a[1]) / rad;
}

// Campaigns and journeys are drawn as flowing curves through their waypoints (a centripetal Catmull-Rom spline),
// and a two-point march as a gentle bow, instead of ruler lines. Cached per path array.
const smoothCache = new WeakMap();
function smoothPath(path) {
  if (path.length < 2) return path;
  if (smoothCache.has(path)) return smoothCache.get(path);
  let out;
  if (path.length === 2) out = arcLeg(path[0], path[1], 24);
  else {
    const p = unwrapLine(path);
    const ext = [[2 * p[0][0] - p[1][0], 2 * p[0][1] - p[1][1]], ...p, [2 * p[p.length - 1][0] - p[p.length - 2][0], 2 * p[p.length - 1][1] - p[p.length - 2][1]]];
    out = [p[0]];
    for (let i = 1; i < ext.length - 2; i++) {
      const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
      const d = (a, b) => Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
      const t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
      const n = Math.max(2, Math.min(16, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 2)));
      for (let k = 1; k <= n; k++) {
        const t = t1 + ((t2 - t1) * k) / n;
        const lerp = (a, b, ta, tb) => [0, 1].map((c) => ((tb - t) * a[c] + (t - ta) * b[c]) / (tb - ta));
        const a1 = lerp(p0, p1, 0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
        const b1 = lerp(a1, a2, 0, t2), b2 = lerp(a2, a3, t1, t3);
        out.push(lerp(b1, b2, t1, t2));
      }
    }
    out = out.map(([x, y]) => [((x + 540) % 360) - 180, y]);
  }
  smoothCache.set(path, out);
  return out;
}
function renderRoutes() {
  markers.routes.forEach((m) => m.remove());
  markers.routes = [];
  // Cross-civilisation routes (data/exchange.json) show in every region; a full route replaces the China-only one it supersedes.
  const xr = shown("exchange") ? state.exchange.routes.filter((r) => state.year >= r.from && state.year <= r.to) : [];
  const gone = new Set(xr.flatMap((r) => r.supersedes || []));
  const routes = [...((shown("routes") && state.layerData?.routes) || []).filter((r) => !gone.has(r.id)), ...xr];
  const feats = [];
  for (const r of routes) {
    if (state.year < r.from || state.year > r.to || r.path.length < 2 || r.kind === "wall") continue;
    // A campaign or journey belongs to the country its event names, or whose land it crosses.
    if (state.sel && !(r.event && selHas(state.events.find((ev) => ev.id === r.event)?.states, r.from, r.to)) && !selKeep(r.path)) continue;
    const moving = r.kind === "campaign" || r.kind === "journey";
    const f = moving && r.to > r.from ? Math.max(0.08, (state.year - r.from + 1) / (r.to - r.from + 1)) : 1;
    const path = moving ? partialPath(smoothPath(r.path), f) : r.path;
    feats.push({ type: "Feature", properties: { kind: r.kind }, geometry: lineGeom(path) });
    if (moving && path.length > 1) {
      const head = document.createElement("div");
      head.className = "mk-arrow k-" + r.kind;
      markers.routes.push(new maplibregl.Marker({ element: head, rotation: bearing(path[path.length - 2], path[path.length - 1]), rotationAlignment: "map" })
        .setLngLat(path[path.length - 1]).addTo(map));
    }
    const label = document.createElement("div");
    label.className = "mk-route k-" + r.kind;
    label.innerHTML = `<b>${esc(t("kinds")[r.kind] || "")}</b>${esc(nameOf(r))}`;
    label.title = tx(r, "summary");
    if (r.event) label.addEventListener("click", (e) => { e.stopPropagation(); openStory(r.event); });
    else label.classList.add("static");
    const mid = r.path[Math.floor((moving ? 0 : r.path.length / 2))];
    markers.routes.push(new maplibregl.Marker({ element: label, anchor: moving ? "right" : "bottom", offset: moving ? [-8, 0] : [0, -6] })
      .setLngLat(mid).addTo(map));
  }
  map.getSource("routes")?.setData({ type: "FeatureCollection", features: feats });
  renderSpread();
}

// Spread of faiths, techniques and crops: each leg grows from `start` to `year`, then stays as a faint line with a dot.
const light = (hex) => { const n = parseInt((hex || "#888").slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170; };
function renderSpread() {
  const feats = [];
  if (shown("spread")) for (const s of state.exchange.spread) {
    // Gone from the map three centuries after it arrived, so the late centuries don't fill with old lines.
    if (state.year < s.start || state.year > s.year + 300) continue;
    if (!selKeep(s.path)) continue;
    const tp = state.exchange.topics[s.topic] || {};
    const f = s.year > s.start ? Math.min(1, Math.max(0.08, (state.year - s.start + 1) / (s.year - s.start + 1))) : 1;
    const growing = state.year < s.year;
    const path = growing ? partialPath(s.path, f) : s.path;
    feats.push({ type: "Feature", properties: { color: tp.color || "#888", live: growing ? 1 : 0 }, geometry: lineGeom(path) });
    const end = path[path.length - 1];
    if (!growing) feats.push({ type: "Feature", properties: { color: tp.color || "#888", live: 0 }, geometry: { type: "Point", coordinates: end } });
    if (growing && path.length > 1) {
      const head = document.createElement("div");
      head.className = "mk-arrow";
      head.style.borderBottomColor = tp.color;
      markers.routes.push(new maplibregl.Marker({ element: head, rotation: bearing(path[path.length - 2], end), rotationAlignment: "map" }).setLngLat(end).addTo(map));
    }
    // Named while on the move and for a generation after it arrives.
    if (state.year > s.year + 25) continue;
    const label = document.createElement("div");
    label.className = "mk-route k-spread";
    label.style.background = tp.color;
    if (light(tp.color)) label.style.color = "#2b2118";
    label.innerHTML = `<b>${esc(nameOf(tp))} · ${esc(growing ? t("set_out")(fmtYear(s.start)) : t("arrived")(fmtYear(s.year)))}</b>${esc(nameOf(s))}`;
    label.title = tx(s, "summary");
    label.addEventListener("click", (e) => {
      e.stopPropagation();
      if (s.event) return openStory(s.event);
      showCard(end, `<div class="pc-kind">${esc(nameOf(tp))} · ${fmtYear(s.start)} – ${fmtYear(s.year)}</div><h4>${esc(nameOf(s))}</h4><p>${esc(tx(s, "summary"))}</p><p class="pc-meta">${t("drafted")}</p>`);
    });
    markers.routes.push(new maplibregl.Marker({ element: label, anchor: "bottom", offset: [0, -8] }).setLngLat(end).addTo(map));
  }
  map.getSource("spread")?.setData({ type: "FeatureCollection", features: feats });
}

function focusBounds() {
  const gj = state.borders[state.snapshot];
  if (!gj) return null;
  const b = new maplibregl.LngLatBounds();
  const walk = (c) => (typeof c[0] === "number" ? b.extend(c) : c.forEach(walk));
  gj.features.filter((f) => f.properties.focus).forEach((f) => walk(f.geometry.coordinates));
  return b.isEmpty() ? null : b;
}

/* ---------- decluttering ---------- */

// Markers that land on the same spot fold into the most important one, which shows a "+N" badge listing the rest;
// labels that would overlap a more important label hide (hover the icon to see one). Re-run as the map moves,
// so zooming in brings everything back.
// Icons closer than this fold into one with a +N badge; a phone gets a wider radius, as fingers need room.
const dcRadius = () => (innerWidth <= 720 ? 26 : 18);
function dcItems() {
  const out = [];
  const add = (m, kind, prio, opts = {}) => { const el = m.getElement(); if (el.isConnected) out.push({ m, el, kind, prio, ...opts }); };
  for (const m of markers.events.values()) {
    const el = m.getElement();
    // The open event's name always shows; other current events' names take their turn with the rest.
    add(m, "event", el.classList.contains("open") ? 100 : el.classList.contains("active") ? 90 : el.classList.contains("minor") ? 50 : 60);
  }
  (markers.capitals || []).forEach((m) => add(m, "capital", 80));
  (markers.people || []).forEach((m) => add(m, "person", 70));
  (markers.inventions || []).forEach((m) => add(m, "invention", m.getElement().classList.contains("old") ? 30 : 65));
  (markers.passes || []).forEach((m) => add(m, "pass", 62));
  (markers.faith || []).forEach((m) => add(m, "faith", m.getElement().classList.contains("old") ? 29 : 64));
  markers.places.forEach((m) => add(m, "place", m.getElement().classList.contains("capital") ? 75 : m.getElement().classList.contains("r-secondary") ? 48 : m.getElement().classList.contains("r-frontier") ? 63 : 40, { fixed: true }));
  (markers.roads || []).forEach((m) => add(m, "road", 20, { fixed: true, labelOnly: true }));
  (markers.clans || []).forEach((m) => add(m, "clan", 55));
  (markers.disasters || []).forEach((m) => add(m, "disaster", m.getElement().classList.contains("past") ? 26 : 61));
  (markers.walls || []).forEach((m) => add(m, "wall", 22, { fixed: true, labelOnly: true }));
  (markers.admin || []).forEach((m) => add(m, "admin", m.getElement().classList.contains("lv-3") ? 14 : 16, { fixed: true, labelOnly: true }));
  // Route and spread names: the lines and arrows always show; the name only where there is room.
  markers.routes.forEach((m) => {
    const el = m.getElement();
    if (el.classList.contains("mk-route")) add(m, "route", el.classList.contains("k-spread") ? 34 : 58, { fixed: true, labelOnly: true });
  });
  // Finer landscape names (smaller ranges, basins) only from their zoom on.
  const z = map.getZoom();
  (markers.geo || []).forEach((m) => {
    const el = m.getElement();
    if (el.dataset.minzoom && z < +el.dataset.minzoom) el.classList.add("dc-hide");
    else add(m, "geo", el.dataset.minzoom ? 9 : 10, { fixed: true, labelOnly: true });
  });
  return out.sort((a, b) => b.prio - a.prio);
}
const overlaps = (a, b, pad = 1) => a.left < b.right + pad && b.left < a.right + pad && a.top < b.bottom + pad && b.top < a.bottom + pad;
function declutter() {
  dcTimer = 0;
  document.querySelectorAll(".dc-more").forEach((b) => b.remove());
  document.querySelectorAll(".dc-hide, .dc-nolabel").forEach((el) => el.classList.remove("dc-hide", "dc-nolabel"));
  const items = dcItems();
  // Fold: an item whose icon sits within dcRadius() of a kept, more important icon joins that one's group.
  const kept = [];
  for (const it of items) {
    const icon = it.el.querySelector("i") || it.el;
    const r = icon.getBoundingClientRect();
    it.icon = r;
    it.cx = (r.left + r.right) / 2; it.cy = (r.top + r.bottom) / 2;
    if (it.labelOnly || r.width === 0) { kept.push(it); continue; }
    // A city dot under a capital star says the same thing twice.
    if (it.kind === "place" && kept.some((k) => k.kind === "capital" && Math.hypot(k.cx - it.cx, k.cy - it.cy) < dcRadius())) {
      it.el.classList.add("dc-hide"); continue;
    }
    const host = !it.fixed && kept.find((k) => !k.fixed && !k.labelOnly && Math.hypot(k.cx - it.cx, k.cy - it.cy) < dcRadius());
    if (host) { (host.group ||= [host]).push(it); it.el.classList.add("dc-hide"); }
    else kept.push(it);
  }
  // How much text the screen can hold: labels keep a gap between them (wider on a phone), and past a budget
  // set by the screen's area the less important ones show only their icon. Zooming in spreads the markers
  // apart, so more names fit; zooming out shows fewer.
  const phone = innerWidth <= 720, pad = phone ? 6 : 3;
  let budget = Math.round((innerWidth * innerHeight) / (phone ? 9000 : 6000));
  // Territory names: the main dynasty first, then by size. A name shows when its land is big enough on screen
  // to hold it and it doesn't run into a more important name, so smaller states appear as you zoom in.
  const ppd = (512 * 2 ** map.getZoom()) / 360;
  const polities = [];
  // The selected country first, then the period's main states (the largest of them always shows; the others, as
  // several peoples of one period can be, give way when they run into it), then the rest.
  const selNow = selNames();
  const rank = (p) => (selNow.has(p.name) ? 2 : p.focus ? 1 : 0);
  let firstFocus = true;
  for (const p of [...markers.polityEls].sort((a, b) => rank(b) - rank(a) || b.area - a.area)) {
    const r = p.el.getBoundingClientRect();
    if (!r.width) continue;
    const onScreen = p.area * ppd * ppd * Math.cos((p.lat * Math.PI) / 180);
    const must = (p.focus && (firstFocus || p.state)) || selNow.has(p.name);
    if (p.focus) firstFocus = false;
    if (!must && (onScreen < r.width * r.height * (phone ? 4 : 2.5) || polities.some((t) => overlaps(r, t, pad)))) {
      p.el.classList.add("dc-hide");
      continue;
    }
    polities.push(r);
  }
  // Labels: placed in priority order; battle cards are already taken space,
  // and the territory names push away the landscape, road and route names.
  const taken = markers.armies.map((m) => m.getElement().getBoundingClientRect());
  // A label gives way to labels and icons of more important markers; it may cover a less important icon.
  // The same name twice close together (an event at 咸阳 beside the city 咸阳, or two events there) shows once.
  const named = [];
  for (const it of kept) {
    const span = it.labelOnly ? it.el : it.el.querySelector("span");
    const r = span?.getBoundingClientRect();
    const name = !it.labelOnly && span?.textContent.trim();
    if (r?.width && name && named.some((n) => n.name === name && Math.hypot(n.x - it.cx, n.y - it.cy) < 140)) {
      it.el.classList.add("dc-nolabel");
      if (!it.fixed) taken.push(it.icon);
      continue;
    }
    if (r?.width) {
      const blocked = budget <= 0 || taken.some((t) => overlaps(r, t, pad)) ||
        ((it.kind === "geo" || it.kind === "road" || it.kind === "route") && polities.some((t) => overlaps(r, t)));
      // The open event's name always shows.
      if (blocked && it.prio < 100) it.el.classList.add("dc-nolabel");
      else { taken.push(r); budget--; if (name) named.push({ name, x: it.cx, y: it.cy }); }
    }
    if (!it.labelOnly && !it.fixed) taken.push(it.icon);
  }
  for (const it of kept) if (it.group) addGroupBadge(it);
}
// A folded spot shows one small tag per kind, each with how many of that kind sit there (事 3 · 人 2), the shown
// marker included; a tag opens the list of just that kind, the badge's edge the whole list.
const DC_KINDS = { event: ["事", "◆"], person: ["人", "●"], capital: ["都", "■"], invention: ["器", "⚙"], faith: ["教", "✦"], pass: ["关", "▲"], clan: ["族", "◼"], disaster: ["灾", "≈"], place: ["城", "•"] };
function addGroupBadge(host) {
  const byKind = new Map();
  for (const g of host.group) { if (!byKind.has(g.kind)) byKind.set(g.kind, []); byKind.get(g.kind).push(g); }
  const b = document.createElement("b");
  b.className = "dc-more";
  b.innerHTML = [...byKind].map(([k, l]) => `<b class="dk k-${k}" data-k="${k}">${(DC_KINDS[k] || ["", "•"])[zh() ? 0 : 1]}${l.length}</b>`).join("");
  b.title = host.group.map((g) => g.el.dataset.name).join(" · ");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    const only = e.target.closest("[data-k]")?.dataset.k;
    const list = only ? byKind.get(only) : host.group;
    const kinds = { event: t("events"), capital: t("capitals"), person: t("people_l"), invention: t("inventions"), faith: t("faith"), pass: t("passes"), clan: t("clans"), disaster: t("climate") };
    showCard(host.m.getLngLat(), `<div class="pc-kind">${only ? esc(kinds[only] || "") + " · " : ""}${zh() ? `此处 ${list.length} 项` : `${list.length} here`}</div>
      <ul class="dc-list">${list.map((g, i) => `<li><button data-i="${i}"><span class="dc-ico ${esc(g.el.className.replace(/\b(dc|maplibregl)-\S+/g, ""))}">${(g.el.querySelector("i") || {}).outerHTML || ""}</span>
        <span>${esc(g.el.dataset.name || "")}<small>${esc(kinds[g.kind] || "")}</small></span></button></li>`).join("")}</ul>`);
    popup.getElement().querySelectorAll(".dc-list button").forEach((btn) =>
      btn.addEventListener("click", () => list[+btn.dataset.i].el.click()));
  });
  host.el.appendChild(b);
}
let dcTimer = 0;
function scheduleDeclutter(delay = 0) {
  if (dcTimer) return;
  dcTimer = delay ? setTimeout(() => requestAnimationFrame(declutter), delay) : requestAnimationFrame(declutter);
}

/* ---------- events ---------- */

// Events on the map and in the list: the current era (zoom all/dynasty) or the window (decades),
// limited to those whose level the zoom reveals.
function visibleEvents() {
  const [a, b] = state.zoom === 2 ? state.win : [state.era.start, state.era.end];
  return state.events.filter((ev) => shownEvent(ev) && ev.year >= a && ev.year <= b);
}
// The detail switch (大事 / 要事 / 细目) sets the finest level shown; tags narrow to some categories.
// The open event always stays visible.
function shownEvent(ev) {
  // With a country selected, only its events, from whichever region's list they come (the Korean War for China).
  if (state.sel) { if (!selHas(ev.states, ev.year, ev.year) && ev.id !== state.selected) return false; }
  // Otherwise each region shows its own events; the world view shows all.
  else if (state.mode !== "world" && (ev.region || state.home) !== state.mode && !ev.also?.includes(state.mode)) return false;
  if (ev.id === state.selected) return true;
  return (ev.level || 1) <= state.detail && (!state.cats.length || state.cats.includes(ev.category));
}
// Countries of this period that have events (from each event's `states`), main dynasties first, then by event count.
function eventCountries() {
  const pol = state.layerData?.polities || {}, n = new Map();
  for (const ev of state.events) if (ev.year >= state.era.start && ev.year <= state.era.end)
    for (const k of ev.states || []) n.set(k, (n.get(k) || 0) + 1);
  return [...n].filter(([k]) => pol[k]).sort((a, b) => (pol[b[0]].focus - pol[a[0]].focus) || b[1] - a[1])
    .map(([k, count]) => ({ key: k, count, name: zh() ? pol[k].name_zh || k : k }));
}
const CATS = ["war", "politics", "reform", "rebellion", "diplomacy", "economy", "culture", "science", "society"];
function renderEventFilter() {
  const box = $("ev-filter");
  box.hidden = false;
  const cur = state.sel ? eventCountries().find((c) => state.sel.names.has(c.key))?.key || "" : "";
  const key = `${state.detail}|${state.cats.join()}|${state.lang}|${state.era.id}|${cur}|${state.sel?.id || ""}|${state.layerData ? 1 : 0}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const cs = eventCountries();
  // Row 1: level of detail and (in multi-state periods) the country; row 2: the categories.
  // A country selected on the map that this period's list doesn't name still shows as the choice.
  if (state.sel && !cur) cs.unshift({ key: [...state.sel.names][0], name: selName(), count: state.events.filter((ev) => ev.year >= state.era.start && ev.year <= state.era.end && selHas(ev.states, ev.year, ev.year)).length, picked: true });
  const country = cs.length > 1 ? `<select id="ef-country" class="ef-country" aria-label="${t("country")}"><option value="">${zh() ? "全部国家" : "All countries"}</option>${cs.map((c) =>
      `<option value="${esc(c.key)}" ${c.key === cur || c.picked ? "selected" : ""}>${esc(c.name)}${zh() ? `（${c.count}）` : ` (${c.count})`}</option>`).join("")}</select>` : "";
  box.innerHTML = `<div class="ef-top"><div class="ef-levels" role="group" aria-label="${t("detail")}">${t("levels").map((l, i) =>
      `<button data-lv="${i + 1}" aria-pressed="${state.detail === i + 1}">${l}</button>`).join("")}</div>${country}</div>
    <div class="ef-cats"><button class="chip" data-cat="" aria-pressed="${!state.cats.length}">${t("allCats")}</button>${CATS.map((c) =>
      `<button class="chip cat-${c}" data-cat="${c}" aria-pressed="${state.cats.includes(c)}">${t("cat")[c]}</button>`).join("")}</div>`;
  box.querySelectorAll("[data-lv]").forEach((b) => b.addEventListener("click", () => setEventFilter(+b.dataset.lv, state.cats)));
  $("ef-country")?.addEventListener("change", (e) => {
    if (!state.sel?.names.has(e.target.value)) selectCountry(e.target.value || null);
  });
  box.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.cat;
    setEventFilter(state.detail, !c ? [] : state.cats.includes(c) ? state.cats.filter((x) => x !== c) : [...state.cats, c]);
  }));
}
function setEventFilter(detail, cats) {
  state.detail = detail;
  state.cats = cats;
  try { localStorage.setItem("atlas-events", JSON.stringify({ detail, cats })); } catch {}
  buildEventMarkers();
  refreshTimeline();
  renderLedger();
}

function buildEventMarkers() {
  markers.events.forEach((m) => m.remove());
  markers.events.clear();
  if (!state.era) return;
  for (const ev of visibleEvents()) {
    const el = document.createElement("div");
    el.className = "mk-event" + ((ev.level || 1) > 1 ? " minor" : "");
    el.appendChild(document.createElement("i"));
    // While current, the marker names its place (马邑, not 马邑（今山西朔州）): it sits on the city, whose own label it hides.
    const where = document.createElement("span");
    where.textContent = (tx(ev, "place") || "").split(/[（(,，]/)[0].trim();
    if (where.textContent) el.appendChild(where);
    el.title = `${fmtYear(ev.year, ev.circa)} · ${titleOf(ev)}`;
    el.dataset.name = `${fmtYear(ev.year, ev.circa)} ${titleOf(ev)}`;
    el.addEventListener("click", (e) => { e.stopPropagation(); openStory(ev.id); });
    markers.events.set(ev.id, new maplibregl.Marker({ element: el }).setLngLat([ev.lon, ev.lat]));
  }
}

// An event stays "active" through its end year, or for a short window scaled to the visible span.
function isActive(ev, y) {
  const len = state.zoom === 2 ? state.win[1] - state.win[0] : state.era.end - state.era.start;
  const span = Math.max(state.zoom === 2 ? 1 : 2, Math.round(len / 60));
  return y >= ev.year && y <= (ev.endYear ?? ev.year + span);
}

function renderEventStates() {
  scheduleDeclutter();
  // The open event has a marker even when the detail filter leaves it out of the list (a level-3 story opened from a city).
  if (state.selected && !markers.events.has(state.selected) && state.events.some((e) => e.id === state.selected)) buildEventMarkers();
  for (const [id, m] of markers.events) {
    const ev = state.events.find((x) => x.id === id);
    const happened = ev.year <= state.year;
    // Only events current at this year (and the one opened) stay on the map; the list keeps the rest.
    if (isActive(ev, state.year) || id === state.selected) m.addTo(map); else m.remove();
    const el = m.getElement();
    const active = isActive(ev, state.year) || ev.id === state.selected;
    el.classList.toggle("active", active);
    el.classList.toggle("open", ev.id === state.selected);
    el.classList.toggle("past", happened && !active);
  }
  document.querySelectorAll(".ev").forEach((btn) => {
    const ev = state.events.find((x) => x.id === btn.dataset.id);
    btn.classList.toggle("future", ev.year > state.year);
  });
}

// Names of rivers, mountains, plains and seas; they don't change with the year.
// Which Yellow River course and which old shorelines belong to the current year; the modern lower river only from 1855.
const inYears = (y) => ["all", ["<=", ["get", "from"], y], [">", ["get", "to"], y]];
function renderOldGeo() {
  if (!map?.getLayer("old-river")) return;
  const y = state.year, vis = state.showGeo ? "visible" : "none";
  map.setFilter("old-river", ["all", ["==", ["get", "kind"], "river"], inYears(y)]);
  map.setFilter("old-coast", ["all", ["==", ["get", "kind"], "coast"], inYears(y)]);
  for (const id of ["old-river", "old-coast"]) map.setLayoutProperty(id, "visibility", vis);
  const modern = ["any", ["!", ["has", "from"]], ["<=", ["get", "from"], y]];
  map.setFilter("rivers", ["all", ["<=", ["get", "rank"], 5], modern]);
  map.setFilter("rivers-minor", ["all", [">", ["get", "rank"], 5], modern]);
  document.querySelectorAll(".mk-geo[data-from]").forEach((el) => (el.hidden = y < +el.dataset.from));
  (markers.oldgeo || []).forEach((m) => m.remove());
  markers.oldgeo = [];
  if (!state.showGeo || !state.oldGeo) return;
  for (const f of state.oldGeo) {
    const p = f.properties;
    if (y < p.from || y >= p.to) continue;
    const el = document.createElement("div");
    el.className = "mk-geo g-" + (p.kind === "coast" ? "coast" : "river") + " old";
    el.textContent = nameOf(p);
    el.title = tx(p, "note");
    el.addEventListener("click", (e) => { e.stopPropagation(); showCard(p.label, `<h4>${esc(nameOf(p))}</h4><p class="pc-meta">${fmtYear(p.from)} – ${p.to > state.range.end ? (zh() ? "今" : "today") : fmtYear(p.to)}</p><p>${esc(tx(p, "note"))}</p><p class="pc-meta">${t("drafted")}</p>`); });
    markers.oldgeo.push(new maplibregl.Marker({ element: el }).setLngLat(p.label).addTo(map));
  }
  scheduleDeclutter();
}

function renderGeo() {
  scheduleDeclutter();
  (markers.geo || []).forEach((m) => m.remove());
  markers.geo = [];
  if (!state.showGeo) return;
  for (const f of state.geo) {
    const el = document.createElement("div");
    el.className = "mk-geo g-" + f.kind + (f.vertical && zh() ? " vertical" : "") + (f.minzoom ? " detail" : "");
    // Upright names: one character per line.
    if (f.vertical && zh()) el.innerHTML = [...nameOf(f)].map(esc).join("<br>");
    else el.textContent = nameOf(f);
    if (f.minzoom) el.dataset.minzoom = f.minzoom;
    if (f.from) { el.dataset.from = f.from; el.hidden = state.year < f.from; }
    markers.geo.push(new maplibregl.Marker({ element: el }).setLngLat([f.lon, f.lat]).addTo(map));
  }
}

// City card: the city's whole life as a bar (one segment per name and role, ticks for its events, a line at the
// current year), then the events of the segment open now. Segments are the places sharing the city id (xian-0…6).
const cityLife = (p) => state.places.filter((q) => cityId(q) === cityId(p)).sort((a, b) => a.from - b.from);
const lifeEnd = (y) => Math.min(y, 1912);
function placeCard(p) {
  const modern = zh() ? p.modern_zh || p.modern : p.modern;
  const now = modern && modern !== (zh() ? p.name_zh : p.name) ? (zh() ? `今${modern}` : `modern ${modern}`) : "";
  const span = (q) => `${fmtYear(q.from, true)} – ${q.to >= 1912 ? (zh() ? "清末" : "1912") : fmtYear(q.to, true)}`;
  const life = cityLife(p), all = cityEvents(p);
  const lo = life[0].from, hi = lifeEnd(Math.max(...life.map((q) => q.to))), w = Math.max(1, hi - lo);
  const x = (y) => ((Math.min(Math.max(y, lo), hi) - lo) / w * 100).toFixed(2);
  const segs = life.map((q) => {
    const pc = (lifeEnd(q.to) - q.from) / w * 100;
    return `<button type="button" class="seg r-${q.rank}${q === p ? " on" : ""}" data-seg="${esc(q.id)}" style="left:${x(q.from)}%;width:${pc.toFixed(2)}%"
      title="${esc(nameOf(q))} · ${esc(t("pranks")[q.rank] || "")} · ${span(q)}">${pc > 13 ? esc(nameOf(q)) : ""}</button>`;
  }).join("");
  const ticks = all.filter((ev) => ev.year >= lo && ev.year <= hi)
    .map((ev) => `<i class="${ev.level === 1 ? "l1" : ""}" style="left:${x(ev.year)}%"></i>`).join("");
  const ranks = [...new Set(life.map((q) => q.rank))];
  const bar = life.length > 1 || all.length ? `<div class="pc-citylife" style="--now:${x(state.year)}%">
      <div class="pc-bar">${segs}<b class="pc-now" title="${fmtYear(state.year)}"></b></div><div class="pc-ticks">${ticks}</div>
      <div class="pc-axis"><span>${fmtYear(lo)}</span><span>${hi >= 1912 ? (zh() ? "清末" : "1912") : fmtYear(hi)}</span></div>
      ${ranks.length > 1 ? `<div class="pc-legend">${ranks.map((r) => `<span><i class="r-${r}"></i>${esc(t("pranks")[r] || "")}</span>`).join("")}</div>` : ""}</div>` : "";
  const here = all.filter((ev) => ev.year >= p.from && ev.year <= p.to), top = here.filter((ev) => ev.level === 1);
  const chips = top.length && top.length < here.length
    ? `<span class="pc-cf" role="group"><button type="button" data-cf="top" aria-pressed="true">${t("cityTop")}</button><button type="button" data-cf="all" aria-pressed="false">${t("cityAll")}</button></span>` : "";
  const list = here.length ? `<p class="pc-works"><b>${t("cityHere")(here.length, all.length)}</b>${chips}</p>
    <div class="pc-evwrap${chips ? " top" : ""}">${eventButtons(here, (ev) => ev.level === 1)}</div>` : all.length ? `<p class="pc-meta">${t("cityNone")(all.length)}</p>` : "";
  return `<div class="pc-kind">${esc(t("pranks")[p.rank] || "")} · ${span(p)}</div>
    <h4>${esc(nameOf(p))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? p.name : p.name_zh)}</span></h4>
    ${now ? `<p class="pc-meta">${esc(now)}</p>` : ""}${tx(p, "note") ? `<p>${esc(tx(p, "note"))}</p>` : ""}
    ${bar}${list}<div class="pc-gaz" data-gaz="c:${esc(cityId(p))}"></div><p class="pc-meta">${t("drafted")}</p>`;
}
// Reverse index from each event's `places` (city ids) and `people` (person ids), filled by tools/link_events.py,
// so city and person cards list their events as soon as new events carry those fields.
const cityId = (p) => p.id.replace(/-\d+$/, "");
function eventIndex(field) {
  const key = "_idx_" + field;
  if (!state[key]) {
    state[key] = new Map();
    for (const ev of state.events) for (const k of ev[field] || []) {
      if (!state[key].has(k)) state[key].set(k, []);
      state[key].get(k).push(ev);
    }
  }
  return state[key];
}
const cityEvents = (p) => eventIndex("places").get(cityId(p)) || [];
const personEvents = (p) => eventIndex("people").get(p.id) || [];
function eventButtons(evs, now) {
  return `<ul class="pc-battles pc-events">${evs.map((ev) =>
    `<li><button type="button" data-ev="${esc(ev.id)}" class="${now(ev) ? "now" : ""}${ev.id === state.selected ? " sel" : ""}"><span>${fmtYear(ev.year)}</span> ${esc(zh() ? ev.title_zh || ev.title : ev.title)}</button></li>`).join("")}</ul>`;
}
// A capital marker lists the events of the city at the same spot (within ~35 km).
function capitalEvents(c) {
  const near = state.places.filter((p) => Math.hypot(p.lon - c.lon, p.lat - c.lat) < 0.35)
    .sort((a, b) => Math.hypot(a.lon - c.lon, a.lat - c.lat) - Math.hypot(b.lon - c.lon, b.lat - c.lat));
  const p = near.find((p) => c.from <= p.to && c.to >= p.from) || near[0];
  return p ? placeEventList({ ...p, from: c.from, to: c.to }) : "";
}
function placeEventList(p) {
  const evs = cityEvents(p);
  if (!evs.length) return "";
  return `<p class="pc-works"><b>${t("cityEvents")(evs.length)}</b></p>${eventButtons(evs, (ev) => ev.year >= p.from && ev.year <= p.to)}`;
}
function renderPlaces() {
  scheduleDeclutter();
  markers.places.forEach((m) => m.remove());
  markers.places = [];
  if (!state.showPlaces) return;
  for (const p of state.places) {
    if (state.year < p.from || state.year > p.to || (state.sel && !selContains(p.lon, p.lat))) continue;
    const el = document.createElement("div");
    el.className = "mk-place r-" + p.rank + (p.rank === "capital" ? " capital" : "");
    el.innerHTML = zh() ? `<i></i><span>${esc(p.name_zh)}</span>` : `<i></i><span>${esc(p.name)} <em>${esc(p.name_zh)}</em></span>`;
    el.title = zh() ? `${p.name_zh}（今${p.modern_zh || p.modern}）` : `${p.name} (modern ${p.modern})`;
    el.addEventListener("click", (e) => { e.stopPropagation(); showCard([p.lon, p.lat], placeCard(p)); });
    markers.places.push(new maplibregl.Marker({ element: el, anchor: "left", offset: [-4, 0] }).setLngLat([p.lon, p.lat]).addTo(map));
  }
}

/* ---------- ledger: event list and story view ---------- */

const TABS = ["tours", "events", "rulers", "people"];
function renderLedger() {
  if (state.layout) { applyLayout(); renderExNav(); }
  if (!state.era) return;
  syncAuto();
  $("ev-filter").hidden = true;
  for (const k of TABS) $("tab-" + k).setAttribute("aria-selected", String(state.tab === k));
  $("rulers").hidden = state.tab !== "rulers";
  $("people").hidden = state.tab !== "people";
  $("tour-tab").hidden = state.tab !== "tours";
  if (state.tab !== "events") {
    hideEventPic(true);
    $("story").hidden = $("ev-list").hidden = true;
    return state.tab === "rulers" ? renderRulers() : state.tab === "people" ? renderPeopleTab() : renderToursTab();
  }
  if (state.reading && state.selected) return renderStory();
  hideEventPic(true);
  $("story").hidden = true;
  $("ev-list").hidden = false;
  renderList();
}

/* ---------- ledger: the same year in every region ---------- */

// Over the timeline: a few headline events from other regions near the current year, one per region, so links
// across civilisations show while scrubbing. Click one to read it (the map moves there); × hides the strip.
let stripKey = "";
// The strip's reach (同时期的…): the world (one headline per other region), the area group, the region (one per
// country), or the neighbours of the selected country (or of the period's main state). Chosen from a menu on its
// head, remembered as atlas-wscope; a reach that doesn't apply here falls back to the next wider one.
const WS_SCOPES = ["near", "region", "group", "world"];
let wsScope = "world";
try { wsScope = localStorage.getItem("atlas-wscope") || "world"; } catch {}
function stripAnchor() {
  const feats = state.shownBorders?.features || [];
  const names = state.sel ? selNames() : new Set(feats.filter((f) => f.properties.focus && f.properties.kind !== "state").map((f) => f.properties.name));
  const own = feats.filter((f) => names.has(f.properties.name));
  return own.length ? { names, own } : null;
}
// A state's display name: from the map shown now, else from any map seen this visit.
function polityLabel(name) {
  let f = state.shownBorders?.features.find((x) => x.properties.name === name);
  if (!f?.properties.name_zh) for (const fc of Object.values(state.borders || {})) { f = fc?.features?.find((x) => x.properties.name === name && x.properties.name_zh); if (f) break; }
  if (f) return zh() ? f.properties.name_zh || name : f.properties.label_en || name;
  // Not on any map loaded yet: the country table's Chinese name for it.
  return (zh() && state.countries?.spans?.[name]?.[0]?.[2]) || name;
}
// States on the map whose land comes within about half a degree of the anchor's.
function neighbourNames(anchor) {
  const cell = (x, y) => `${Math.floor(x * 2)},${Math.floor(y * 2)}`, grid = new Set();
  const each = (g, fn) => { const walk = (c) => (typeof c[0] === "number" ? fn(c) : c.forEach(walk)); walk(g.coordinates); };
  for (const f of anchor.own) each(f.geometry, ([x, y]) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) grid.add(cell(x + i / 2, y + j / 2)); });
  const out = new Set();
  for (const f of state.shownBorders.features) {
    const n = f.properties.name;
    if (anchor.names.has(n) || out.has(n) || !f.geometry) continue;
    let hit = false;
    each(f.geometry, ([x, y]) => { if (!hit && grid.has(cell(x, y))) hit = true; });
    if (hit) out.add(n);
  }
  return out;
}
const groupOf = (rid) => (state.groups || []).find((g) => g.regions.includes(rid));
// The reaches that make sense here, narrowest first, each with its menu label.
function stripScopes() {
  const here = state.mode, r = state.regionById?.[here], g = groupOf(here), anchor = stripAnchor(), out = [];
  const nm = (o) => (o ? (zh() ? o.short_zh || o.name_zh || o.name : o.short || o.name) : "");
  if (anchor) out.push({ id: "near", label: t("wsNear")(polityLabel(anchor.own[0].properties.name)), head: t("wsNearShort"), anchor });
  if (r) out.push({ id: "region", label: nm(r) });
  if (g && g.regions.filter((id) => id !== here && state.regionById[id]).length) out.push({ id: "group", label: nm(g) });
  out.push({ id: "world", label: t("wsWorld") });
  return out;
}
function renderWorldStrip() {
  const box = $("world-strip");
  let off = false;
  try { off = localStorage.getItem("atlas-wstrip") === "0"; } catch {}
  if (off || !state.regions?.length || state.tour || cmp.on) { box.hidden = true; stripKey = ""; return; }
  const y = state.year, here = state.mode;
  const key = `${y}|${here}|${state.lang}|${wsScope}|${state.snapshot}|${state.sel?.id || ""}`;
  if (key === stripKey) return;
  stripKey = key;
  const scopes = stripScopes();
  // The chosen reach, or the next wider one that applies here.
  const want = WS_SCOPES.indexOf(wsScope);
  const sc = scopes.find((s) => WS_SCOPES.indexOf(s.id) >= want) || scopes[scopes.length - 1];
  const win = Math.max(10, Math.min(40, Math.round((state.era?.end - state.era?.start || 100) / 8)));
  const g = groupOf(here);
  // Each pick is keyed by what it stands for: a region (world, group) or a state (region, neighbours).
  let keyOf;
  if (sc.id === "world") keyOf = (ev) => { const r = ev.region || "china"; return r === here ? null : r; };
  else if (sc.id === "group") keyOf = (ev) => { const r = ev.region || "china"; return r !== here && g.regions.includes(r) ? r : null; };
  else {
    const anchor = sc.anchor || stripAnchor(), mine = anchor?.names || new Set();
    const near = sc.id === "near" ? neighbourNames(anchor) : null;
    keyOf = (ev) => {
      if (sc.id === "region" && (ev.region || "china") !== here) return null;
      const st = (ev.states || []).filter((n) => !mine.has(n) && (!near || near.has(n)));
      if (!st.length || (ev.states || []).some((n) => mine.has(n)) && sc.id === "near") return null;
      return "s:" + st[0];
    };
  }
  const best = new Map();
  for (const ev of state.events) {
    if (ev.level > 2 || Math.abs(ev.year - y) > win) continue;
    const k = keyOf(ev);
    if (!k) continue;
    const score = ev.level * win + Math.abs(ev.year - y);
    if (!best.has(k) || score < best.get(k).score) best.set(k, { ev, k, score });
  }
  const picks = [...best.values()].sort((a, b) => a.score - b.score).slice(0, 4).sort((a, b) => a.ev.year - b.ev.year);
  box.hidden = false;
  const head = `<button type="button" class="ws-head" aria-haspopup="menu" aria-expanded="false">${esc(t("wsHead")(sc.head || sc.label))}<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>`;
  box.dataset.scope = sc.id;
  box.innerHTML = head + (picks.length ? picks.map(({ ev, k }) => {
    const r = state.regionById[ev.region || "china"];
    const who = k.startsWith("s:") ? polityLabel(k.slice(2)) : r ? (zh() ? r.short_zh || r.name_zh : r.short || r.name) : "";
    return `<button type="button" data-ev="${esc(ev.id)}" style="--rc:${esc(r?.seal || r?.color || "#888")}" title="${esc(tx(ev, "summary"))}"><i></i><b>${esc(who)}</b><span>${fmtYear(ev.year)}</span> ${esc(zh() ? ev.title_zh || ev.title : ev.title)}</button>`;
  }).join("") : `<span class="ws-none">${esc(t("wsNone"))}</span>`) + `<button type="button" class="ws-x" aria-label="${esc(t("hideStrip"))}" title="${esc(t("hideStrip"))}">×</button>`;
}
function toggleStripPop(open) {
  const pop = $("ws-pop"), btn = $("world-strip").querySelector(".ws-head");
  open ??= pop.hidden;
  pop.hidden = !open || !btn;
  btn?.setAttribute("aria-expanded", !pop.hidden);
  if (pop.hidden) return;
  const cur = $("world-strip").dataset.scope;
  // Widest first, the levels joined by a thin line like a path down the hierarchy.
  pop.innerHTML = stripScopes().reverse().map((s, i) => `<button type="button" role="menuitemradio" aria-checked="${s.id === cur}" data-scope="${s.id}"><i aria-hidden="true"></i><b>${esc(s.label)}</b><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.3 2.2L9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>`).join("");
  if (pop.parentNode !== document.body) document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.left = `${r.left}px`;
  pop.style.top = `${Math.max(8, r.top - 6 - pop.offsetHeight)}px`;
}

// Regions in their groups (东亚: 中国, 朝鲜半岛, 日本; 欧洲: 欧洲), as data/regions.json `groups` lists them; regions in
// no group (a data pack's) come last. A group is only for finding regions: the timeline belongs to regions.
function regionGroups() {
  const used = new Set(), out = [];
  for (const g of state.groups || []) {
    const rs = g.regions.map((id) => state.regionById[id]).filter(Boolean);
    rs.forEach((r) => used.add(r.id));
    if (rs.length) out.push([g, rs]);
  }
  const rest = state.regions.filter((r) => !used.has(r.id));
  return rest.length ? [...out, [null, rest]] : out;
}
function regionEra(r, y) { return r.eras.find((e) => y >= e.start && y <= e.end); }
// One region in this year, opened under its row in the region menu: who ruled, the nearest big events and its
// countries (click one to select it).
function regionDetail(r, y) {
  const evs = state.events.filter((ev) => ((ev.region || "china") === r.id || ev.also?.includes(r.id)) && Math.abs(ev.year - y) <= 30)
    .sort((a, b) => Math.abs(a.year - y) - Math.abs(b.year - y) || a.level - b.level).slice(0, 3).sort((a, b) => a.year - b.year);
  return `<p class="wd-rulers"></p>${countryChips(r)}` + (evs.length
    ? `<ul class="wd-ev">${evs.map((ev) => `<li><button type="button" data-ev="${esc(ev.id)}"><span>${fmtYear(ev.year)}</span> ${esc(zh() ? ev.title_zh || ev.title : ev.title)}</button></li>`).join("")}</ul>`
    : `<p class="wd-none">${t("noWorldEv")}</p>`);
}
// The main countries with a ruler this year, filled in when the region's layer file arrives.
function fillRegionRulers(p, r, y) {
  const era = regionEra(r, y);
  if (!era?.layers) return;
  loadLayers(era).then((L) => {
    const pol = L.polities || {};
    const names = Object.keys(L.rulers || {}).sort((a, b) => !!pol[b]?.focus - !!pol[a]?.focus);
    const out = [];
    for (const n of names) {
      const x = (L.rulers[n] || []).findLast((x) => y >= x.from && y <= x.to);
      if (x) out.push(`${esc(zh() ? pol[n]?.name_zh || n : n)}：${esc(rulerText(x)[0])}`);
      if (out.length === 3) break;
    }
    p.innerHTML = out.join(" · ");
  });
}
// A region's countries this year as chips: the first eight, the rest behind a "more" button.
function countryChips(r) {
  const cs = regionCountries(r);
  if (!cs.length) return "";
  const chip = (p, i) => `<button type="button" class="chip${i >= 8 ? " extra" : ""}" data-country="${esc(p.name)}" aria-pressed="${selNames().has(p.name)}">${esc(zh() ? p.name_zh || p.name : p.label_en || p.name)}</button>`;
  return `<div class="wd-countries">${cs.map(chip).join("")}${cs.length > 8 ? `<button type="button" class="wd-more" data-n="${cs.length - 8}">${esc(t("sel").more(cs.length - 8))}</button>` : ""}</div>`;
}
function goRegion(id) {
  const reg = state.regionById[id];
  if (!reg) return;
  // Going to another region on purpose lets go of a country selected elsewhere.
  if (state.sel && selRegion() !== id) selectCountry(null);
  setMode(id);
  if (reg.polygon?.length) map.fitBounds(polyBounds(reg.polygon), { padding: { top: 120, bottom: 140, left: 60, right: innerWidth > 720 ? 380 : 60 }, maxZoom: 5, duration: 1400 });
  renderLedger();
}

// Region switcher: the globe chip in the era panel names the region the timeline follows; its menu jumps anywhere.
function renderRegionBtn() {
  const r = state.regionById[state.mode];
  $("region-name").textContent = r ? (zh() ? r.short_zh || r.name_zh : r.short || r.name) : t("allWorld");
  $("region-btn").hidden = state.regions.length < 2;
}
const stripOff = () => { try { return localStorage.getItem("atlas-wstrip") === "0"; } catch { return false; } };
function toggleRegionPop(open) {
  const pop = $("region-pop"), btn = $("region-btn");
  open ??= pop.hidden;
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", open);
  if (!open) return;
  const y = state.year;
  const row = (id, color, name, sub, full = name) => `<button type="button" role="menuitem" data-r="${esc(id)}" title="${esc(full)}" class="${id === state.mode ? "here" : ""}" style="--rc:${esc(color)}"><i></i><b>${esc(name)}</b><span>${esc(sub)}</span></button>`;
  // 全球 and compare lead (the list runs past one screen on phones); then each group of regions, its name in a
  // narrow column on the left, its regions two to a row.
  const pill = (cls, id, icon, label, sub = "") => `<button type="button" role="menuitem" class="rp-pill ${cls}${id === state.mode ? " here" : ""}"${id ? ` data-r="${id}"` : ` id="rp-cmp"`}>${icon}<b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</button>`;
  pop.innerHTML = `<div class="rp-top">${pill("rp-world", "world", `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4"/></svg>`, t("allWorld"), fmtYear(y))}`
    + `${pill("rp-cmp", "", `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="5.5" height="10" rx="1"/><rect x="9" y="3" width="5.5" height="10" rx="1"/></svg>`, t("cmp").one)}</div>`
    + regionGroups().map(([g, rs]) => `<div class="rp-grp"><h6>${esc(g ? (zh() ? g.name_zh : g.short || g.name) : t("packs")).replace("与", "<br>")}</h6><div class="rp-items">${rs.map((r) => {
      const era = regionEra(r, y);
      // The row goes to the region; its ▸ opens this year's rulers, events and countries there underneath.
      return `<div class="rp-reg">${row(r.id, r.color || "#888", regionShort(r), era ? nameOf(era) : "", nameOf(r))}<button type="button" class="rp-x" data-x="${esc(r.id)}" aria-expanded="false" aria-label="${esc(t("rpMore"))}" title="${esc(t("rpMore"))}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg></button></div>`;
    }).join("")}</div></div>`).join("")
    + `<p class="rp-foot">${esc(t("sel").hint)}</p>` + (stripOff() ? `<button type="button" class="chip ws-on" id="ws-on">${esc(t("showStrip"))}</button>` : "");
  $("rp-cmp").addEventListener("click", () => { toggleRegionPop(false); openCompare(); });
  $("ws-on")?.addEventListener("click", () => {
    try { localStorage.removeItem("atlas-wstrip"); } catch {}
    $("ws-on").remove();
    renderWorldStrip();
  });
  pop.querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => {
    toggleRegionPop(false);
    if (b.dataset.r !== "world") return goRegion(b.dataset.r);
    setMode("world");
    map.flyTo({ center: [60, 30], zoom: innerWidth <= 720 ? 0.6 : 1.4, pitch: 0, bearing: 0, duration: 1400 });
    renderLedger();
  }));
  // One region open at a time; the block spans the group's width under its row (the grid backfills the other column).
  pop.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") !== "true";
    pop.querySelectorAll(".rp-detail").forEach((d) => d.remove());
    pop.querySelectorAll("[data-x]").forEach((x) => x.setAttribute("aria-expanded", "false"));
    if (!open) return;
    b.setAttribute("aria-expanded", "true");
    const r = state.regionById[b.dataset.x], d = document.createElement("div");
    d.className = "rp-detail";
    d.dataset.region = r.id;
    d.style.setProperty("--rc", r.color || "#888");
    b.parentElement.after(d);
    fillRegionDetail(d, r);
    d.scrollIntoView({ block: "nearest" });
  }));
}
// An open region's box in the menu for the current year.
function fillRegionDetail(d, r) {
  const y = state.year;
  d.innerHTML = regionDetail(r, y);
  fillRegionRulers(d.querySelector(".wd-rulers"), r, y);
  d.querySelectorAll("[data-country]").forEach((c) => c.addEventListener("click", () => {
    toggleRegionPop(false);
    state.sel?.names.has(c.dataset.country) ? selectCountry(null) : selectCountry(c.dataset.country, { fly: true });
  }));
  d.querySelector(".wd-more")?.addEventListener("click", (e) => {
    const ul = e.target.closest(".wd-countries"), on = ul.classList.toggle("open");
    e.target.textContent = on ? t("sel").less : t("sel").more(+e.target.dataset.n);
  });
  d.querySelectorAll("[data-ev]").forEach((c) => c.addEventListener("click", () => { toggleRegionPop(false); openStory(c.dataset.ev); }));
}
// While the menu is open the timeline can move under it: each region's period, the year and the open box follow.
function refreshRegionPop() {
  const pop = $("region-pop");
  if (pop.hidden) return;
  const y = state.year;
  const w = pop.querySelector('.rp-world span');
  if (w) w.textContent = fmtYear(y);
  pop.querySelectorAll(".rp-reg [data-r]").forEach((b) => {
    const era = regionEra(state.regionById[b.dataset.r], y);
    b.querySelector("span").textContent = era ? nameOf(era) : "";
  });
  // The box is rebuilt once the year rests, not on every step of a drag.
  clearTimeout(refreshRegionPop.timer);
  refreshRegionPop.timer = setTimeout(() => {
    const d = pop.querySelector(".rp-detail");
    if (d && !pop.hidden) fillRegionDetail(d, state.regionById[d.dataset.region]);
  }, 200);
}

function setLean(on, remember) {
  state.lean = on;
  document.querySelector(".era").classList.toggle("lean", on);
  if (innerWidth > 720) $("era-more").setAttribute("aria-expanded", String(!on));
  if (remember) try { localStorage.setItem("atlas-lean", on ? "1" : "0"); } catch {}
}

/* ---------- compare: a second map of another region at the same year, side by side (top and bottom on phones) ---------- */

// Two kinds: another region at the same year ("region"), or the same view at another year ("time"), the two
// cameras moving together.
const cmpYear = () => (cmp.kind === "time" ? cmp.year : state.year);
function openCompare(id, kind = cmp.kind || "region") {
  cmp.kind = kind;
  if (kind === "time") {
    cmp.region = state.regionById[state.mode] || state.regionById[state.home] || state.regions[0];
    // Start one period back (or forward from the first).
    const eras = cmp.region.eras, i = eras.findIndex((e) => state.year >= e.start && state.year <= e.end);
    const other = eras[i - 1] || eras[i + 1] || eras[0];
    if (cmp.year == null || cmp.yearRegion !== cmp.region.id) cmp.year = Math.round((other.start + other.end) / 2) || 1;
    cmp.yearRegion = cmp.region.id;
  } else cmp.region = state.regionById[id] || (cmp.region?.id !== state.mode && cmp.region) ||
    state.regionById[state.mode === "china" ? "europe" : "china"] || state.regions.find((r) => r.id !== state.mode);
  if (!cmp.region) return;
  if (!cmp.on) { cmp.wasLean = state.lean; setLean(true); }
  cmp.on = true;
  document.body.classList.add("comparing");
  $("map2").hidden = $("cmp-card").hidden = false;
  map.resize();
  if (!cmp.map) {
    cmp.map = new maplibregl.Map({ container: "map2", style: buildStyle(), center: [10, 45], zoom: 3, minZoom: 1.2, maxZoom: 9, attributionControl: false });
    cmp.map.on("load", () => {
      applyLook(cmp.map);
      if (!state.showGeo) for (const l of ["rivers", "rivers-minor", "lakes", "lakes-line"]) cmp.map.setLayoutProperty(l, "visibility", "none");
      cmp.loaded = true;
      compareTerrain();
      fitCompare();
      updateCompare(true);
    });
    let t0;
    cmp.map.on("move", () => { clearTimeout(t0); t0 = setTimeout(declutterCompare, 120); syncCamera(cmp.map, map); });
    map.on("move", () => syncCamera(map, cmp.map));
    cmp.map.on("moveend", declutterCompare);
  } else cmp.map.resize();
  fitCompare();
  setTimeout(() => cmp.loaded && declutterCompare(), 300);
  updateCompare(true);
}
function closeCompare() {
  cmp.on = false;
  setLean(!!cmp.wasLean);
  document.body.classList.remove("comparing");
  $("map2").hidden = $("cmp-card").hidden = true;
  cmp.popup?.remove();
  map.resize();
}
// In "time" mode the two maps show the same place: whichever is moved, the other follows (flat, centre and zoom).
// With "sync view" on, also rotation and tilt (and the second map gets the same 3D relief).
function syncCamera(from, to) {
  if (!cmp.on || cmp.kind !== "time" || !cmp.sync || cmp.syncing || !to) return;
  cmp.syncing = true;
  to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch(), padding: from.getPadding(), ...(from.getCenterElevation ? { elevation: from.getCenterElevation() } : {}) });
  if (from.terrain && to.terrain) to.terrain.exaggeration = from.terrain.exaggeration;
  cmp.syncing = false;
}
function compareTerrain() {
  if (!cmp.loaded) return;
  const want = cmp.kind === "time" && cmp.sync && !!map.terrain;
  if (want && !cmp.map.terrain) cmp.map.setTerrain({ source: "dem-terrain", exaggeration: map.terrain.exaggeration });
  else if (!want && cmp.map.terrain) { cmp.map.setTerrain(null); cmp.map.easeTo({ pitch: 0, bearing: 0, duration: 300 }); }
}
function fitCompare() {
  const r = cmp.region;
  if (cmp.kind === "time") { if (cmp.map) { cmp.syncing = false; compareTerrain(); syncCamera(map, cmp.map); } return; }
  compareTerrain();
  if (!cmp.map || !r?.polygon?.length) return;
  const phone = innerWidth <= 720;
  cmp.map.fitBounds(polyBounds(r.polygon), { padding: { top: phone ? 90 : 150, bottom: phone ? 110 : 130, left: 30, right: 30 }, maxZoom: 5, duration: 0 });
}
async function updateCompare(force) {
  if (!cmp.on) return;
  const r = cmp.region, y = cmpYear(), era = regionEra(r, y);
  renderCompareCard(era);
  if (!cmp.loaded || !era) return;
  const spec = bordersKey(era, y, r.id), key = spec.key + "|" + state.lang;
  if (key === cmp.key && !force) return renderCompareEvents(era);
  cmp.key = key;
  const gj = await bordersFor(spec);
  if (cmp.key !== key) return;
  cmp.map.getSource("borders")?.setData(gj);
  cmp.marks.forEach((m) => m.remove());
  cmp.marks = [];
  for (const f of gj.features) {
    const p = f.properties;
    if (!p.label || (!p.focus && (p.area < (p.name_zh ? 6 : 25) || p.nolabel))) continue;
    const el = document.createElement("div");
    el.className = "mk-polity" + (p.focus ? " focus" : p.name_zh ? " neighbour" : "");
    if (zh()) el.innerHTML = p.name_zh ? esc(p.name_zh) : `<small>${esc(p.name)}</small>`;
    else el.innerHTML = `<span>${esc(p.name)}</span>`;
    const m = new maplibregl.Marker({ element: el }).setLngLat(p.label).addTo(cmp.map);
    Object.assign(m, { focus: !!p.focus, area: p.area || 0, lat: p.label[1] });
    cmp.marks.push(m);
  }
  renderCompareEvents(era);
  requestAnimationFrame(() => requestAnimationFrame(declutterCompare)); // once the new labels are laid out
}
// Country names on the second map: main states first, then by size; small or overlapping names hide.
function declutterCompare() {
  const ppd = (512 * 2 ** cmp.map.getZoom()) / 360, kept = [];
  for (const m of [...cmp.marks].sort((a, b) => b.focus - a.focus || b.area - a.area)) {
    const el = m.getElement();
    el.classList.remove("dc-hide");
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const onScreen = m.area * ppd * ppd * Math.cos((m.lat * Math.PI) / 180);
    if ((!m.focus && onScreen < r.width * r.height * 2.5) || kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 2 && r.bottom > k.top - 2))
      el.classList.add("dc-hide");
    else kept.push(r);
  }
}
// The region's events nearest the year (major ones first), as numbered dots on the second map and a list on its card.
function compareEvents(era) {
  const r = cmp.region, y = cmpYear();
  return state.events.filter((ev) => ((ev.region || state.home) === r.id || ev.also?.includes(r.id)) && (ev.level || 1) <= 2 && Math.abs(ev.year - y) <= 40)
    .sort((a, b) => Math.abs(a.year - y) - Math.abs(b.year - y) || a.level - b.level).slice(0, 4).sort((a, b) => a.year - b.year);
}
function renderCompareEvents(era) {
  cmp.evMarks?.forEach((m) => m.remove());
  cmp.evMarks = compareEvents(era).map((ev, i) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "cmp-dot";
    el.textContent = i + 1;
    el.title = evTitleText(ev);
    el.addEventListener("click", (e) => { e.stopPropagation(); compareEventPopup(ev); });
    return new maplibregl.Marker({ element: el }).setLngLat([ev.lon, ev.lat]).addTo(cmp.map);
  });
}
const evTitleText = (ev) => zh() ? ev.title_zh || ev.title : ev.title;
function compareEventPopup(ev) {
  cmp.popup?.remove();
  cmp.popup = new maplibregl.Popup({ className: "atlas-pop", maxWidth: "300px", offset: 14, focusAfterOpen: false }).setLngLat([ev.lon, ev.lat])
    .setHTML(`<div class="pc-kind">${fmtYear(ev.year, ev.circa)} · ${esc(tx(ev, "place"))}</div><h4>${esc(evTitleText(ev))}</h4><p>${esc(tx(ev, "summary"))}</p>`)
    .addTo(cmp.map);
}
function renderCompareCard(era) {
  const box = $("cmp-card"), r = cmp.region, C = t("cmp"), y = cmpYear(), time = cmp.kind === "time";
  const opts = state.regions.map((x) => `<option value="${esc(x.id)}"${x === r ? " selected" : ""}>${esc(zh() ? x.short_zh || x.name_zh : x.short || x.name)}</option>`).join("");
  const evs = era ? compareEvents(era) : [];
  const kindBtn = (k, label) => `<button type="button" data-kind="${k}" aria-pressed="${cmp.kind === k}">${esc(label)}</button>`;
  // "time": pick a period of this region, then a year inside it.
  const picker = time
    ? `<select id="cmp-era" aria-label="${esc(C.period)}">${r.eras.map((e) => `<option value="${esc(e.id)}"${e === era ? " selected" : ""}>${esc(nameOf(e))}</option>`).join("")}</select>`
    : `<select id="cmp-pick" aria-label="${esc(C.pick)}">${opts}</select>`;
  const syncBtn = time ? `<button type="button" class="chip cmp-sync" id="cmp-sync" aria-pressed="${cmp.sync}">${esc(C.sync)}</button>` : "";
  const slider = time && era ? `<input type="range" id="cmp-year" min="${era.start}" max="${era.end}" value="${y}" aria-label="${esc(C.year)}">` : "";
  box.innerHTML = `<div class="cmp-top"><div class="cmp-kind">${kindBtn("region", C.place)}${kindBtn("time", C.time)}</div>
      <button type="button" class="chip search-open" id="cmp-close" aria-label="${esc(C.close)}" title="${esc(C.close)}">×</button></div>
    <div class="cmp-top">${picker}${syncBtn}</div>${slider}
    <div class="cmp-era"><b>${esc(era ? nameOf(era) : "")}</b><span>${fmtYear(y)}</span></div>
    <p class="cmp-rulers" id="cmp-rulers"></p>
    ${evs.length ? `<ol class="cmp-ev">${evs.map((ev, i) => `<li><button type="button" data-ev="${esc(ev.id)}"><i>${i + 1}</i><span>${fmtYear(ev.year, ev.circa)}</span> ${esc(evTitleText(ev))}</button></li>`).join("")}</ol>`
      : `<p class="cmp-none">${esc(C.none)}</p>`}`;
  $("cmp-sync")?.addEventListener("click", () => { cmp.sync = !cmp.sync; compareTerrain(); syncCamera(map, cmp.map); renderCompareCard(era); });
  $("cmp-pick")?.addEventListener("change", (e) => { cmp.region = state.regionById[e.target.value]; cmp.key = ""; fitCompare(); updateCompare(true); });
  $("cmp-era")?.addEventListener("change", (e) => { const x = r.eras.find((x) => x.id === e.target.value); cmp.year = Math.round((x.start + x.end) / 2) || x.start; updateCompare(); });
  $("cmp-year")?.addEventListener("input", (e) => { cmp.year = +e.target.value || (e.target.value < 0 ? -1 : 1); box.querySelector(".cmp-era span").textContent = fmtYear(cmp.year); });
  $("cmp-year")?.addEventListener("change", () => updateCompare());
  box.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.kind !== cmp.kind) { cmp.key = ""; openCompare(null, b.dataset.kind); } }));
  $("cmp-close").addEventListener("click", closeCompare);
  box.querySelectorAll("[data-ev]").forEach((b) => b.addEventListener("click", () => {
    const ev = state.events.find((x) => x.id === b.dataset.ev);
    cmp.map?.flyTo({ center: [ev.lon, ev.lat], zoom: Math.max(cmp.map.getZoom(), 4.5), duration: 900 });
    compareEventPopup(ev);
  }));
  // Who ruled there: the main countries with a ruler this year.
  if (era?.layers) loadLayers(era).then((L) => {
    if (cmp.region !== r || cmpYear() !== y || !$("cmp-rulers")) return;
    const pol = L.polities || {};
    const names = Object.keys(L.rulers || {}).sort((a, b) => !!pol[b]?.focus - !!pol[a]?.focus);
    const out = [];
    for (const n of names) {
      const x = (L.rulers[n] || []).findLast((x) => y >= x.from && y <= x.to);
      if (x) out.push(`${esc(zh() ? pol[n]?.name_zh || n : n)}：${esc(rulerText(x)[0])}`);
      if (out.length === 2) break;
    }
    $("cmp-rulers").innerHTML = out.join(" · ");
  });
}

/* ---------- ledger: rulers of one country; picking one narrows the timeline to the reign ---------- */

function rulerPolities() {
  const L = state.layerData;
  if (!L?.rulers) return [];
  const pol = L.polities || {};
  return Object.keys(L.rulers).filter((n) => L.rulers[n].length)
    .map((n, i) => ({ n, i, focus: !!pol[n]?.focus, zh: pol[n]?.name_zh || "" }))
    .sort((a, b) => b.focus - a.focus || a.i - b.i);
}
function renderRulers() {
  const box = $("rulers");
  const ps = rulerPolities();
  if (!ps.length) {
    box.innerHTML = `<p class="rl-empty">${t("noRulers")}</p>`;
    box.dataset.key = "";
    $("ev-count").textContent = "";
    return;
  }
  // A selected country shows its own rulers.
  const own = state.sel && ps.find((p) => selNames().has(p.n));
  if (own && state.rulerPolity !== own.n && box.dataset.sel !== state.sel.id) state.rulerPolity = own.n;
  box.dataset.sel = state.sel?.id || "";
  if (!ps.some((p) => p.n === state.rulerPolity)) {
    // Default: the main country ruling this year, as in the Five Dynasties the dynasty of the moment.
    state.rulerPolity = (ps.find((p) => p.focus && rulerAt(p.n, state.year)) || ps.find((p) => rulerAt(p.n, state.year)) || ps[0]).n;
  }
  const reigns = state.layerData.rulers[state.rulerPolity];
  $("ev-count").textContent = t("rulerCount")(reigns.length);
  const key = `${state.era.id}|${state.rulerPolity}|${state.lang}`;
  if (box.dataset.key !== key || box._data !== state.layerData) {
    box.dataset.key = key;
    box._data = state.layerData;
    const label = (p) => (zh() ? p.zh || p.n : p.n + (p.zh ? ` · ${p.zh}` : ""));
    box.innerHTML = `<label class="rl-pick"><span>${t("country")}</span><select id="rl-select">${ps.map((p) =>
        `<option value="${esc(p.n)}"${p.n === state.rulerPolity ? " selected" : ""}>${esc(label(p))}</option>`).join("")}</select></label>
      <p class="rl-hint">${t("scopeHint")}</p>
      <ol class="rl-list">${reigns.map((r, i) => {
        const [a, b] = rulerText(r);
        return `<li><button class="rl" data-i="${i}"><span class="rl-years">${fmtYear(r.from, r.circa)}<br>${fmtYear(r.to)}</span>
          <span class="rl-name">${esc(a)}</span>${b ? `<span class="rl-sub">${esc(b)}</span>` : ""}<span class="rl-len">${t("reignLen")(r.to - r.from + 1)}${checkMark(r)}</span></button></li>`;
      }).join("")}</ol>`;
    $("rl-select").addEventListener("change", (e) => { state.rulerPolity = e.target.value; renderRulers(); });
    box.querySelectorAll(".rl").forEach((btn) => btn.addEventListener("click", () => scopeToRuler(state.rulerPolity, +btn.dataset.i)));
    box.dataset.current = "";
  }
  // Mark the reigning ruler and the one the timeline is narrowed to; follow the reigning one as the year moves.
  const cur = reigns.indexOf(rulerAt(state.rulerPolity, state.year));
  box.querySelectorAll(".rl").forEach((btn) => {
    const r = reigns[+btn.dataset.i];
    btn.classList.toggle("current", +btn.dataset.i === cur);
    btn.classList.toggle("future", r.from > state.year);
    btn.classList.toggle("scoped", state.scope?.polity === state.rulerPolity && state.scope.i === +btn.dataset.i);
  });
  if (String(cur) !== box.dataset.current) {
    box.dataset.current = String(cur);
    box.querySelector(".rl.current")?.scrollIntoView({ block: "nearest" });
  }
}
/* ---------- ledger: famous people of the period; picking one flies to where they lived and opens their card ---------- */

const PGROUP = { general: "mil", statesman: "pol", thinker: "cul", poet: "cul", writer: "cul", historian: "cul", scholar: "cul", religious: "cul",
  artist: "art", scientist: "sci", physician: "sci", engineer: "sci", explorer: "sci" };
function renderPeopleTab() {
  const box = $("people");
  const all = (state.layerData?.people || []).filter(selPerson).sort((a, b) => personSpan(a)[0] - personSpan(b)[0]);
  const g = state.peopleGroup || "all";
  const list = g === "all" ? all : all.filter((p) => PGROUP[p.field] === g);
  $("ev-count").textContent = all.length ? t("rulerCount")(list.length) : "";
  if (!all.length) { box.innerHTML = `<p class="rl-empty">${t("noPeople")}</p>`; box.dataset.key = ""; return; }
  const key = `${state.era.id}|${state.lang}|${g}|${state.sel?.id || ""}`;
  if (box.dataset.key !== key || box._data !== state.layerData) {
    box.dataset.key = key;
    box._data = state.layerData;
    box._list = list;
    const groups = ["all", ...["mil", "pol", "cul", "art", "sci"].filter((k) => all.some((p) => PGROUP[p.field] === k))];
    box.innerHTML = `<div class="pp-groups">${groups.map((k) =>
        `<button class="chip" data-g="${k}" aria-pressed="${k === g}">${t("pgroups")[k]}</button>`).join("")}</div>
      <p class="rl-hint">${t("peopleHint")}</p><ol class="rl-list">${list.map((p, i) =>
      `<li><button class="rl pp f-${esc(p.field)}" data-i="${i}"><span class="rl-years">${p.born != null ? fmtYear(p.born, p.circa) : "?"}<br>${p.died != null ? fmtYear(p.died, p.circa) : p.born != null ? (zh() ? "今" : "now") : "?"}</span>
        <span class="rl-name">${esc(nameOf(p))}</span><span class="rl-sub">${esc(tx(p, "known_for"))}</span><span class="rl-len">${state.lifeOf?.has(p.id) ? `<i class="pp-life" title="${esc(t("followLife"))}">▶</i>` : ""}${esc(t("fields")[p.field] || "")}</span></button></li>`).join("")}</ol>`;
    box.querySelectorAll(".rl").forEach((btn) => btn.addEventListener("click", () => focusPerson(box._list[+btn.dataset.i])));
    box.querySelectorAll("[data-g]").forEach((btn) => btn.addEventListener("click", () => { state.peopleGroup = btn.dataset.g; renderPeopleTab(); }));
    box._fresh = true;
  }
  // Alive this year in normal colour, not yet born dimmed.
  box.querySelectorAll(".rl").forEach((btn) => {
    const [a, b] = personSpan(box._list[+btn.dataset.i]);
    btn.classList.toggle("current", state.year >= a && state.year <= b);
    btn.classList.toggle("future", a > state.year);
  });
  // A new list opens at the people alive this year.
  if (box._fresh) { box._fresh = false; const cur = box.querySelector(".rl.current"); if (cur) box.scrollTop = cur.parentElement.offsetTop - box.querySelector(".rl-list").offsetTop; }
}
async function focusPerson(p) {
  stop();
  // Move the year into their lifetime (nearest year to now, kept inside this period) so their marker shows.
  const [a, b] = personSpan(p);
  const y = Math.min(state.era.end, Math.max(state.era.start, Math.min(b, Math.max(a, state.year))));
  if (y !== state.year) {
    if (state.zoom && (y < state.win[0] || y > state.win[1])) { state.scope = null; state.win = windowFor(state.zoom, y); refreshTimeline(); }
    await setYear(y);
  }
  // Someone with a life journey: their 足迹 framed whole, the card where they were this year.
  if (state.lifeBy?.has(p.id)) {
    await showTrail(p, { fit: true });
    map.once("moveend", () => showCard(personAt(p), personCard(p)));
    return;
  }
  map.flyTo({ center: [p.lon, p.lat], zoom: Math.min(Math.max(map.getZoom(), 5), 6), pitch: state.show3d ? 45 : 0, duration: 1400, essential: true });
  map.once("moveend", () => showCard([p.lon, p.lat], personCard(p)));
}
async function scopeToRuler(polity, i) {
  stop();
  const r = state.layerData.rulers[polity][i];
  const a = Math.max(state.range.start, r.from), b = Math.min(state.range.end, Math.max(r.from, r.to));
  state.zoom = 2;
  state.win = [a, b];
  state.selected = null;
  state.reading = false;
  await setYear(Math.min(b, Math.max(a, state.era.start)));
  state.scope = { polity, i, label: rulerText(r)[0] };
  refreshTimeline();
}

function renderList() {
  renderEventFilter();
  const list = $("ev-list");
  const evs = visibleEvents();
  $("ev-count").textContent = state.zoom === 2 ? t("countWin")(evs.length) : t("count")(evs.length, nameOf(state.era));
  list.innerHTML = evs.length || state.mode === state.home || state.mode === state.pack?.manifest.id ? "" : `<li class="ev-empty">${t("noRegionEvents")}</li>`;
  for (const ev of evs) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "ev" + (ev.year > state.year ? " future" : "") + (ev.id === state.selected ? " selected" : "") + ((ev.level || 1) > 1 ? " minor" : "");
    btn.dataset.id = ev.id;
    btn.innerHTML = `<span class="ev-year">${fmtYear(ev.year, ev.circa)}</span><span class="ev-title">${esc(titleOf(ev))}</span>` +
      `<span class="ev-sub" lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? ev.title : ev.title_zh)}</span>`;
    if (ev.id === state.selected) {
      const d = document.createElement("div");
      d.className = "ev-detail";
      d.innerHTML = `<p>${esc(tx(ev, "summary"))}</p><span class="ev-more">${t("more")}</span>`;
      btn.appendChild(d);
    }
    btn.addEventListener("click", () => openStory(ev.id));
    li.appendChild(btn);
    list.appendChild(li);
  }
  list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

function loadDetails(era) {
  if (!era.layers || era.worldMaps) return Promise.resolve({});
  if (!state.details[era.id]) state.details[era.id] = loadJSON(`data/details/${era.id}.json`).catch(() => ({}));
  return state.details[era.id];
}

async function openStory(id) {
  state.reading = true;
  state.tab = "events";
  $("ledger").classList.remove("collapsed");
  $("ledger-toggle").textContent = t("hide");
  await selectEvent(id);
}

async function renderStory() {
  const ev = state.events.find((e) => e.id === state.selected);
  const box = $("story");
  $("ev-list").hidden = true;
  box.hidden = false;
  const evs = visibleEvents();
  const i = evs.findIndex((e) => e.id === ev.id);
  const prev = evs[i - 1], next = evs[i + 1];
  const when = ev.endYear ? `${fmtYear(ev.year, ev.circa)} – ${fmtYear(ev.endYear)}` : fmtYear(ev.year, ev.circa);
  const cat = t("cat")[ev.category] || ev.category;
  $("ev-count").textContent = i >= 0 ? `${i + 1} / ${evs.length}` : "";
  box.innerHTML = `
    <nav class="story-nav">
      <button class="chip" data-go="back">← ${$("app").classList.contains("tour-reading") ? t("tourBack") : t("back")}</button>
      <span class="story-step">
        <button class="zbtn" data-go="prev" ${prev ? "" : "disabled"} aria-label="${t("prev")}" title="${prev ? esc(titleOf(prev)) : ""}">‹</button>
        <button class="zbtn" data-go="next" ${next ? "" : "disabled"} aria-label="${t("next")}" title="${next ? esc(titleOf(next)) : ""}">›</button>
      </span>
    </nav>
    <header class="story-head">
      <div class="story-meta"><span class="cat cat-${esc(ev.category)}">${esc(cat)}</span><span class="when">${when}</span></div>
      <h3>${esc(titleOf(ev))}</h3>
      <div class="story-sub" lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? ev.title : ev.title_zh)}</div>
      <button class="story-place" data-go="map"><i></i>${esc(tx(ev, "place"))}</button>
    </header>
    ${illuSlot("e:" + ev.id)}${illuSlot("a:" + ev.id)}
    <p class="story-lede">${esc(tx(ev, "summary"))}</p>
    <div class="story-body"><p class="muted">${t("loading")}</p></div>`;
  box.scrollTop = 0;
  fillIllus(box);
  showEventPic(ev.id);
  box.onclick = (e) => {
    // Any picture in the story opens large (its credit link still goes to Commons).
    const pic = !e.target.closest("a") && e.target.closest("figure.illu[data-illu]");
    if (pic) pic.dataset.illu.startsWith("a:") ? showEventPic(ev.id, true) : showIlluLarge(pic.dataset.illu);
    const go = e.target.closest("[data-go]")?.dataset.go;
    if (go === "back") {
      state.reading = false; $("app").classList.remove("tour-reading"); renderLedger();
      if (state.tour && immersivePref()) setImmersive(true, false); // back to a tour that was immersive
    }
    if (go === "prev" && prev) openStory(prev.id);
    if (go === "next" && next) openStory(next.id);
    if (go === "map") flyToEvent(ev);
    const link = e.target.closest("[data-link]");
    if (link) {
      const it = linkTags.items[+link.dataset.link];
      if (it.field) focusPerson(it);
      else { map.flyTo({ center: [it.lon, it.lat], zoom: Math.max(map.getZoom(), 5), duration: 1200, essential: true }); map.once("moveend", () => showCard([it.lon, it.lat], placeCard(it))); }
    }
  };
  const home = (ev.region || "china") === "china" && state.chinaEras.find((e) => ev.year >= e.start && ev.year <= e.end);
  const all = home ? await loadDetails(home) : {};
  if (state.selected !== ev.id || !state.reading) return;
  const d = all[ev.id];
  const body = box.querySelector(".story-body");
  const layer = home ? await loadLayers(home) : {};
  if (state.selected !== ev.id || !state.reading) return;
  const tags = linkTags(ev, layer);
  if (!d) { body.innerHTML = tags + `<p class="muted">${t("noStory")}</p>` + checkNote(ev) + links(ev, d); return; }
  const story = (zh() ? d.story_zh : d.story) || d.story || [];
  let html = story.map((p) => `<p>${esc(p)}</p>`).join("");
  if (d.quote?.zh) {
    html += `<blockquote><p class="q-zh" lang="zh-CN">${esc(d.quote.zh)}</p>` +
      (!zh() && d.quote.en ? `<p class="q-en">${esc(d.quote.en)}</p>` : "") +
      (d.quote.from ? `<cite>${esc(d.quote.from)}</cite>` : "") + `</blockquote>`;
  }
  const army = layer.armies?.[ev.id];
  if (army) html += `<section class="forces"><h4>${t("forces")}</h4>${armiesHTML(army)}</section>`;
  const why = zh() ? d.why_zh || d.why : d.why;
  if (why) html += `<section class="why"><h4>${t("why")}</h4><p>${esc(why)}</p></section>`;
  if (d.people?.length) {
    html += `<section class="people"><h4>${t("people")}</h4><ul>` + d.people.map((p) =>
      `<li><b>${esc(zh() ? p.name_zh || p.name : p.name)}</b>` +
      `<span>${esc(zh() ? p.role_zh || p.role : p.role)}${!zh() && p.name_zh ? ` · <span lang="zh-CN">${esc(p.name_zh)}</span>` : ""}</span></li>`).join("") +
      `</ul></section>`;
  }
  body.innerHTML = tags + html + checkNote(ev) + links(ev, d);
}
// The event's linked city and people (ev.places / ev.people) as chips that open their cards with all their events.
function linkTags(ev, layer) {
  const people = (ev.people || []).map((id) => (layer.people || []).find((p) => p.id === id)).filter(Boolean);
  const cities = (ev.places || []).map((id) => {
    const all = state.places.filter((p) => cityId(p) === id);
    // The name in use that year, else the nearest in time (Beijing after 1912 is 北京, not 蓟).
    const gap = (p) => (ev.year < p.from ? p.from - ev.year : ev.year > p.to ? ev.year - p.to : 0);
    return [...all].sort((a, b) => gap(a) - gap(b))[0];
  }).filter(Boolean);
  if (!people.length && !cities.length) return "";
  linkTags.items = [...cities, ...people];
  return `<p class="story-tags">${cities.map((p, i) => `<button class="chip tag-city" data-link="${i}">◆ ${esc(nameOf(p))}</button>`).join("")}` +
    people.map((p, i) => `<button class="chip tag-person" data-link="${cities.length + i}">${esc(nameOf(p))}</button>`).join("") + `</p>`;
}

// Wikipedia's search jumps straight to the article when the title exists and falls back to
// search results when it doesn't, so a slightly wrong title still lands somewhere useful.
function wikiLink(url) {
  const m = url && url.match(/^https:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/);
  if (!m) return url;
  const title = decodeURIComponent(m[2]).replace(/_/g, " ");
  return `https://${m[1]}.wikipedia.org/w/index.php?search=${encodeURIComponent(title)}`;
}

// Fact-check mark (tools/fact_check.py → apply_facts.py): checked, corrected (with what it was), doubtful, or not checked.
function checkNote(x) {
  const c = x?.check, s = c?.s || "none", L = t("fc");
  const note = c ? tx(c, "n") : "";
  const icon = { ok: "✓", fixed: "✎", doubt: "?", none: "·" }[s];
  const line = (cls, ic, label, n) => `<p class="fc fc-${cls}"><b>${ic}</b> ${esc(label)}${n ? `${zh() ? "：" : ": "}${esc(n)}` : ""}</p>`;
  // Events also carry the summary review (`sum`).
  const m = x?.sum;
  return line(s, icon, L[s], note) + (m ? line(m.s, { ok: "✓", fixed: "✎", doubt: "?" }[m.s], t("sm")[m.s], tx(m, "n")) : "");
}
function checkMark(x) {
  const s = x?.check?.s;
  if (!s || s === "ok") return s ? `<span class="fc-mk fc-ok" title="${esc(t("fc").ok)}">✓</span>` : "";
  return `<span class="fc-mk fc-${s}" title="${esc(t("fc")[s] + (tx(x.check, "n") ? ": " + tx(x.check, "n") : ""))}">${s === "fixed" ? "✎" : "?"}</span>`;
}
function links(ev, d) {
  const zhUrl = wikiLink(d?.source_zh || ev.source_zh), enUrl = wikiLink(ev.source);
  const main = zh() ? zhUrl || enUrl : enUrl || zhUrl;
  const r = refLink(ev.refs);
  if (r) return `<p class="story-links">` + ev.refs.map((ref) => `<a href="${esc(refLink(ref).href)}" title="${esc(r.label)}" target="_blank" rel="noopener">${esc(refLabel(ref))} ↗</a>`).join("") + `</p>`;
  if (!main) return "";
  const other = zhUrl && enUrl ? (zh() ? enUrl : zhUrl) : null;
  return `<p class="story-links"><a href="${esc(main)}" target="_blank" rel="noopener">${t("wiki")} ↗</a>` +
    (other ? `<a href="${esc(other)}" target="_blank" rel="noopener">${t("wikiOther")} ↗</a>` : "") + `</p>`;
}

function flyToEvent(ev) {
  map.flyTo({ center: [ev.lon, ev.lat], zoom: Math.min(Math.max(map.getZoom(), 4.6), 5.5), pitch: state.show3d ? 50 : 0, duration: 1600, essential: true });
}

async function selectEvent(id) {
  stop();
  const ev = state.events.find((e) => e.id === id);
  state.selected = id;
  state.closedArmies.delete(id);
  // An event of another region: the timeline switches to that region's periods.
  if (!state.tour && !ev.also?.includes(state.mode)) setMode(ev.region || "china");
  // An event outside the decades window: move the window to it.
  if (state.zoom === 2 && (ev.year < state.win[0] || ev.year > state.win[1])) {
    state.scope = null;
    state.win = windowFor(state.zoom, ev.year);
    refreshTimeline();
  }
  await setYear(ev.year);
  renderArmies();
  renderLedger();
  flyToEvent(ev);
  emit("event", { id, event: ev });
}

async function goToEra(era) {
  stop();
  // A period of another region: switch the timeline to it and fly there.
  const r = state.regionById[era.region];
  const fly = r && setMode(r.id);
  state.selected = null;
  state.reading = false;
  state.scope = null;
  if (state.zoom) state.win = windowFor(state.zoom, era.start);
  await setYear(era.start);
  refreshTimeline();
  const b = focusBounds() || (fly && polyBounds(r.polygon));
  if (b) {
    const cam = map.cameraForBounds(b, { padding: { top: 120, bottom: 140, left: 60, right: innerWidth > 720 ? 380 : 60 } });
    if (cam) map.flyTo({ ...cam, zoom: Math.min(cam.zoom, 5), pitch: state.show3d ? 45 : 0, bearing: -6, duration: 1600, essential: true });
  }
}

/* ---------- guided tours: data/tours.json, a camera path through years with narration ---------- */
let tours = null;
// Life journeys (data/lives.json): one tour per person, `person` set, its stops the places of their life.
// state.lifeOf maps a person id to their journey's id, for the "follow their life" button on person cards.
let lives = null;
const loadLives = () => lives || (lives = (state.pack?.only ? Promise.resolve([]) : loadJSON("data/lives.json").catch(() => []))
  .then((l) => { state.lifeOf = new Map(l.map((tr) => [tr.person, tr.id])); state.lifeBy = new Map(l.map((tr) => [tr.person, tr])); return l; }));
// Where a life had got to by a year: the index of its last stop at or before it (the first stop before birth).
const lifeIdx = (life, y) => { let k = 0; life.steps.forEach((s, j) => { if (s.year <= y) k = j; }); return k; };

/* ---------- 足迹: a person's whole life journey on the map, driven by the timeline ----------
   All stops and legs are drawn at once: the way already travelled solid, the rest faint and dashed, each stop named
   with its year. A gold dot marks where they were in the year on the timeline and glides along the leg when the year
   passes the next stop, so playing or dragging the timeline walks them through their life. The card under the map
   tells what happened at the current stop; ‹ › step from stop to stop. */
const trail = { life: null, p: null, k: -1, anim: 0, labels: [] };
function trailSrc() {
  if (!map.getSource("trail")) {
    map.addSource("trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("trail-now", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const kind = (k) => ["==", ["get", "kind"], k];
    const before = map.getLayer("tour-past") ? "tour-past" : undefined;
    map.addLayer({ id: "trail-ahead", type: "line", source: "trail", filter: kind("ahead"), layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#8a5a12", "line-width": 2.2, "line-dasharray": [1.5, 2], "line-opacity": 0.7 } }, before);
    map.addLayer({ id: "trail-casing", type: "line", source: "trail", filter: kind("done"), layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#5a3a08", "line-width": 6.5, "line-opacity": 0.55 } }, before);
    map.addLayer({ id: "trail-done", type: "line", source: "trail", filter: kind("done"), layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#f0b429", "line-width": 3.5 } }, before);
    map.addLayer({ id: "trail-stops", type: "circle", source: "trail", filter: kind("stop"),
      paint: { "circle-radius": ["case", ["==", ["get", "past"], 1], 5, 4], "circle-color": ["case", ["==", ["get", "past"], 1], "#f0b429", "#fffaf0"],
        "circle-stroke-color": "#8a5a12", "circle-stroke-width": 1.5, "circle-opacity": 0.95 } }, before);
    map.addLayer({ id: "trail-now-halo", type: "circle", source: "trail-now",
      paint: { "circle-radius": 18, "circle-color": "#f0b429", "circle-opacity": 0.35, "circle-blur": 0.5 } }, before);
    map.addLayer({ id: "trail-now", type: "circle", source: "trail-now",
      paint: { "circle-radius": 9, "circle-color": "#f0b429", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } }, before);
  }
  return map.getSource("trail");
}
// Show a person's 足迹 (or switch it off with null). `fit` frames the whole journey.
async function showTrail(person, { fit = false } = {}) {
  cancelAnimationFrame(trail.anim);
  trail.labels.forEach((m) => m.remove());
  trail.labels = [];
  const life = person && (await loadLives(), state.lifeBy?.get(person.id || person));
  trail.life = life || null;
  trail.p = life ? (typeof person === "object" ? person : null) : null;
  trail.k = -1;
  trail.pin = null;
  $("app").classList.toggle("trailing", !!life);
  if (!life) {
    $("trail").hidden = true;
    if (map.getSource("trail")) { map.getSource("trail").setData({ type: "FeatureCollection", features: [] }); map.getSource("trail-now").setData({ type: "FeatureCollection", features: [] }); }
    renderPeople();
    return;
  }
  if (state.tour) endTour();
  const reg = tourRegion(life);
  if (state.mode !== reg) setMode(reg);
  // Into their life: the nearest year of it.
  const y = Math.min(life.end, Math.max(life.start, state.year));
  if (y !== state.year) {
    if (state.zoom && !inWindow(y)) { state.scope = null; state.win = windowFor(state.zoom, y); refreshTimeline(); }
    await setYear(y);
  }
  // Each place is named once, with all its years (长安 742·754).
  const byPlace = new Map();
  life.steps.forEach((s, j) => {
    const key = s.at.map((v) => v.toFixed(1)).join(",");
    if (!byPlace.has(key)) byPlace.set(key, { at: s.at, s, idx: [] });
    byPlace.get(key).idx.push(j);
  });
  for (const g of byPlace.values()) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "trail-lab";
    el.dataset.idx = g.idx.join(",");
    el.innerHTML = `<b>${g.idx.map((j) => esc(fmtYear(life.steps[j].year))).join(" · ")}</b> ${esc(stopPlace(g.s) || "")}`;
    el.addEventListener("click", (e) => { e.stopPropagation(); trailGo(g.idx.find((j) => j > trail.k) ?? g.idx[0]); });
    trail.labels.push(new maplibregl.Marker({ element: el, anchor: "left", offset: [12, 0] }).setLngLat(g.at).addTo(map));
  }
  updateTrail(true);
  if (fit) {
    const b = new maplibregl.LngLatBounds();
    life.steps.forEach((s) => b.extend(s.at));
    const wide = innerWidth > 720;
    const cam = map.cameraForBounds(b, { padding: { top: wide ? 110 : 150, bottom: wide ? 260 : 300, left: wide ? 80 : 30, right: wide ? 420 : 30 } });
    if (cam) map.flyTo({ ...cam, zoom: Math.min(cam.zoom, 6.5), pitch: state.show3d ? 30 : 0, bearing: 0, duration: 1600, essential: true });
  }
}
// Redraw for the current year. The dot glides along the leg when the year has moved on by one stop.
function updateTrail(first) {
  const life = trail.life;
  if (!life || !map.getSource("trail") && !trailSrc()) return;
  const k = trail.pin?.year === state.year ? trail.pin.k : lifeIdx(life, state.year), was = trail.k;
  const born = state.year >= life.start;
  if (k === was && !first) return trailCard();
  trail.k = k;
  const legs = life.steps.slice(1).map((s, j) => [j + 1, arcLeg(life.steps[j].at, s.at)]);
  const feats = legs.map(([j, pts]) => ({ type: "Feature", properties: { kind: j <= k && born ? "done" : "ahead" }, geometry: lineGeom(pts) }));
  life.steps.forEach((s, j) => feats.push({ type: "Feature", properties: { kind: "stop", past: j <= k && born ? 1 : 0 }, geometry: { type: "Point", coordinates: s.at } }));
  trailSrc().setData({ type: "FeatureCollection", features: feats });
  for (const m of trail.labels) {
    const idx = m.getElement().dataset.idx.split(",").map(Number);
    m.getElement().classList.toggle("now", idx.includes(k) && born);
    m.getElement().classList.toggle("ahead", !born || idx.every((j) => j > k));
  }
  const dot = (c) => map.getSource("trail-now").setData({ type: "FeatureCollection", features: born ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }] : [] });
  cancelAnimationFrame(trail.anim);
  const leg = k === was + 1 && !first && legs[k - 1] && unwrapLine(legs[k - 1][1]);
  if (!leg || matchMedia("(prefers-reduced-motion: reduce)").matches) dot(life.steps[k].at);
  else {
    const t0 = performance.now(), dur = state.playing ? 600 : 1000;
    const tick = (now) => {
      if (trail.life !== life || trail.k !== k) return;
      const f = Math.min(1, Math.max(0, (now - t0) / dur)), g = 1 - (1 - f) ** 3;
      const x = g * (leg.length - 1), i = Math.min(leg.length - 2, Math.floor(x)), u = x - i;
      const c = [leg[i][0] + (leg[i + 1][0] - leg[i][0]) * u, leg[i][1] + (leg[i + 1][1] - leg[i][1]) * u];
      dot([((c[0] + 540) % 360) - 180, c[1]]);
      if (f < 1) trail.anim = requestAnimationFrame(tick);
    };
    trail.anim = requestAnimationFrame(tick);
  }
  trailCard();
}
function trailCard() {
  const life = trail.life, box = $("trail");
  if (!life) return;
  const k = trail.k, s = life.steps[k], n = life.steps.length;
  const before = state.year < life.start, after = state.year > life.end && state.year > (trail.p?.died ?? life.end);
  const name = trail.p ? nameOf(trail.p) : tx(life, "title");
  const key = `${life.id}|${k}|${before}|${after}|${state.lang}`;
  box.hidden = false;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const dots = life.steps.map((x, j) => `<button type="button" class="tr-dot${j < k ? " past" : j === k && !before ? " now" : ""}" data-j="${j}" title="${esc(fmtYear(x.year))} ${esc(stopPlace(x) || "")}" aria-label="${esc(fmtYear(x.year))} ${esc(stopPlace(x) || "")}"></button>`).join("");
  const text = before ? t("trailBefore")(fmtYear(life.start)) : after ? t("trailAfter") : tx(s, "text").replace(/^[^:：，,]{1,14}?(年，|: )/, "");
  box.innerHTML = `<div class="tour-head"><span class="tour-title">◉ ${esc(name)} · ${esc(t("trail"))}</span><span class="tour-count">${before ? "" : `${k + 1}/${n}`}</span><button type="button" class="zbtn tour-close" data-tr="x" aria-label="${esc(t("close"))}">×</button></div>
    <div class="tr-dots">${dots}</div>
    <p>${before ? "" : `<b class="tour-year">${esc(fmtYear(s.year))} · ${esc(stopPlace(s) || "")}</b>`}<span>${esc(text)}</span></p>
    <div class="tour-ctl"><button type="button" class="chip" data-tr="prev"${k <= 0 && !after ? " disabled" : ""}>‹ ${esc(t("trailPrev"))}</button>
      ${s.event && !before ? `<button type="button" class="chip" data-tr="story">${esc(t("tourStory"))}</button>` : ""}
      <button type="button" class="chip" data-tr="tour">▶ ${esc(t("followLife"))}</button>
      <button type="button" class="chip tour-next" data-tr="next"${k >= n - 1 && !before ? " disabled" : ""}>${esc(t("trailNext"))} ›</button></div>
    <p class="tr-note">${esc(t("drafted"))}</p>`;
}
// Step to a stop: its year on the timeline, the camera on the place.
async function trailGo(j) {
  const life = trail.life, s = life?.steps[j];
  if (!s) return;
  stop();
  if (state.zoom && !inWindow(s.year)) { state.scope = null; state.win = windowFor(state.zoom, s.year); refreshTimeline(); }
  // Two stops in one year: the timeline can't tell them apart, so the stop is pinned while the year stays.
  trail.pin = { year: s.year, k: j };
  await setYear(s.year);
  if (trail.k !== j) { trail.pin = { year: s.year, k: j }; updateTrail(); }
  const z = Math.min(Math.max(map.getZoom(), (s.zoom || 6) - 0.5), 7);
  map.easeTo({ center: s.at, zoom: z, duration: 1100, essential: true });
}
// The atlas's own tours and the pack's (marked with the pack's region), or the pack's alone.
const loadTours = () => tours || (tours = Promise.all([
  state.pack?.only ? [] : Promise.all([loadJSON("data/tours.json").catch(() => []), loadLives()]).then(([a, b]) => [...a, ...b]),
  state.pack?.manifest.data.tours ? packFile("tours").then((l) => l.map((tr) => ({ ...tr, region: state.pack.manifest.id }))).catch(() => []) : [],
]).then(([a, b]) => [...a, ...b]));
const tourRegion = (tr) => tr.region || state.home;
const regionEras = (id) => state.regionById[id]?.eras || state.chinaEras;
// The 导览 tab: this period's tours first, then the rest grouped by period.
const tourEra = (tr) => tr.era || regionEras(tourRegion(tr)).find((e) => e.start <= tr.start && tr.start <= e.end)?.id;
// A tour also shows under every period its years reach into, and under any listed in `also` (官渡 under 三国).
const tourIn = (tr, era) => tourEra(tr) === era.id || (tr.also || []).includes(era.id) || (tr.start <= era.end && tr.end >= era.start);
function tourItem(tr, era) {
  const on = state.tour?.id === tr.id;
  const home = era && tourEra(tr) !== era.id ? regionEras(tourRegion(tr)).find((e) => e.id === tourEra(tr)) : null;
  return `<button type="button" class="tour-item${on ? " on" : ""}${tr.person ? " life" : ""}" data-tour="${tr.id}"><b>${esc(tx(tr, "title"))}</b><span>${fmtYear(tr.start)}–${fmtYear(tr.end)} · ${t("tourSteps")(tr.steps.length)}${home ? ` · ${esc(nameOf(home))}` : ""}</span><small>${esc(tx(tr, "summary"))}</small></button>`;
}
async function renderToursTab() {
  let list = await loadTours();
  if (state.tab !== "tours") return;
  const box = $("tour-tab");
  // This region's tours for the period on screen, then its other periods, then the other regions.
  const reg = state.mode === "world" ? null : state.era.region || state.mode;
  const lifeList = list.filter((tr) => tr.person);
  list = list.filter((tr) => !tr.person);
  const here = list.filter((tr) => reg && tourRegion(tr) === reg && tourIn(tr, state.era)).sort((a, b) => a.start - b.start);
  // Lives of people of this region who were alive in this period.
  const livesHere = lifeList.filter((tr) => reg && tourRegion(tr) === reg && tr.start <= state.era.end && tr.end >= state.era.start).sort((a, b) => a.start - b.start);
  $("ev-count").textContent = t("tourCount")(here.length);
  const key = `${state.mode}|${state.era.id}|${state.lang}|${state.tour?.id || ""}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  let html = `<p class="rl-hint">${t("tourHint")}</p>`;
  html += here.length ? here.map((tr) => tourItem(tr, state.era)).join("") : `<p class="rl-empty">${t("noTours")}</p>`;
  if (livesHere.length) html += `<h5 class="tour-lives">${esc(t("livesHere"))}</h5>` + livesHere.map((tr) => tourItem(tr)).join("");
  const group = (title, groups) => {
    groups = groups.filter(([, l]) => l.length);
    if (!groups.length) return "";
    const n = groups.reduce((k, [, l]) => k + l.length, 0);
    return `<details class="tour-more" data-g="${esc(title)}"${box.querySelector(`details[data-g="${title}"]`)?.open ? " open" : ""}><summary>${esc(title)}${zh() ? "（" : " ("}${n}${zh() ? "）" : ")"}</summary>` +
      groups.map(([h, l]) => `<h5>${esc(h)}</h5>` + l.map((tr) => tourItem(tr)).join("")).join("") + `</details>`;
  };
  if (reg) html += group(t("toursOther"), regionEras(reg).filter((e) => e.id !== state.era.id).map((e) => [nameOf(e), list.filter((tr) => tourRegion(tr) === reg && tourEra(tr) === e.id)]));
  html += group(t("livesAll"), [...new Set(lifeList.map(tourRegion))].map((id) => [nameOf(state.regionById[id] || { name: id }), lifeList.filter((tr) => tourRegion(tr) === id).sort((a, b) => a.start - b.start)]));
  for (const r of state.regions) if (r.id !== reg) {
    const l = list.filter((tr) => tourRegion(tr) === r.id).sort((a, b) => a.start - b.start);
    html += group(nameOf(r), regionEras(r.id).map((e) => [nameOf(e), l.filter((tr) => tourEra(tr) === e.id)]));
  }
  box.innerHTML = html + `<p class="tour-note">${t("drafted")}</p>`;
}
// A country's story, built on the spot from what the atlas knows about it: it opens on the country as first mapped,
// stops at its key events (all level-1 events, topped up with level-2 ones spread over its years, about 18 in all),
// and closes on its last map (or today). Borders morph between stops.
function countryTour() {
  const c = state.sel;
  if (!c) return null;
  const evs = state.events.filter((ev) => ev.year >= c.from && ev.year <= c.to && selHas(ev.states, ev.year, ev.year)).sort((a, b) => a.year - b.year);
  let pick = evs.filter((ev) => ev.level === 1);
  // Top up with level-2 events, each time into the longest stretch of years with no stop yet, so long quiet
  // centuries get a stop too instead of the extras bunching where events are dense.
  const more = evs.filter((ev) => ev.level === 2), shut = new Set();
  for (let room = 18 - pick.length; room > 0 && more.length; room--) {
    const ys = [c.from, ...pick.map((ev) => ev.year), Math.min(c.to, 2026)].sort((a, b) => a - b);
    let best = null;
    for (let j = 1; j < ys.length; j++) {
      const [a, b] = [ys[j - 1], ys[j]], mid = (a + b) / 2, key = `${a}|${b}`;
      if (shut.has(key) || (best && b - a <= best.len)) continue;
      const ev = more.filter((e) => e.year > a && e.year < b).sort((x, y) => Math.abs(x.year - mid) - Math.abs(y.year - mid))[0];
      if (ev) best = { len: b - a, ev }; else shut.add(key);
    }
    if (!best) break;
    pick.push(best.ev);
    more.splice(more.indexOf(best.ev), 1);
  }
  if (pick.length > 30) pick = Array.from({ length: 30 }, (_, j) => pick[Math.floor((j * pick.length) / 30)]);
  pick = [...new Set(pick)].sort((a, b) => a.year - b.year || a.level - b.level);
  if (pick.length < 2) return null;
  const first = c.spans[0]?.[0] ?? c.from, last = c.spans.at(-1)?.[1] ?? c.to;
  const from = Math.max(c.from, Math.min(first, pick[0].year)), to = Math.min(c.to, last);
  const name = c.name, name_zh = c.name_zh || c.name;
  const steps = [
    { year: from, fit: true, layers: ["rulers", "capitals"],
      text: `${name} ${c.dated ? "is founded" : "appears on the map"}.`, text_zh: `${name_zh}${c.dated ? "立国" : "出现在地图上"}。` },
    ...pick.map((ev) => ({ year: ev.year, at: [ev.lon, ev.lat], zoom: 5.2, event: ev.id, layers: ev.layers,
      text: `${ev.title}. ${ev.summary}`, text_zh: `${ev.title_zh}：${ev.summary_zh}` })),
  ];
  const ends = c.to >= 2026 ? { text: `${name} today.`, text_zh: `${name_zh}延续至今。` } : { text: `The end of ${name}.`, text_zh: `${name_zh}的终结。` };
  if (to > pick.at(-1).year || c.to >= 2026) steps.push({ year: Math.max(to, pick.at(-1).year), fit: true, layers: ["rulers"], ...ends });
  return state.genTour = { id: "country:" + c.id, region: c.region || selRegion(), path: false, morph: true, start: from, end: steps.at(-1).year,
    title: `The story of ${name}`, title_zh: `${name_zh}的故事`, summary: "", summary_zh: "", steps };
}
async function startTour(id, i = 0, auto = false) {
  const tr = id === state.genTour?.id ? state.genTour : (await loadTours()).find((x) => x.id === id);
  if (!tr) return;
  stop(); closeSearch();
  if (trail.life) showTrail(null);
  await illuSet("ai");
  state.tour = { id, tr, i: 0, auto };
  applyLayout();
  syncMusic();
  setMode(tourRegion(tr));
  $("tour").hidden = false;
  $("app").classList.add("touring");
  if (immersivePref()) setImmersive(true, false);
  if (state.tab === "tours") renderToursTab();
  await tourStep(Math.max(0, Math.min(i, tr.steps.length - 1)));
}
async function tourStep(i) {
  const tour = state.tour;
  if (!tour) return;
  const { tr } = tour;
  clearTimeout(tour.timer);
  $("app").classList.remove("tour-reading");
  tour.i = i;
  const s = tr.steps[i];
  drawTourPath(tour, i);
  tourCard();
  narrateStep(tour, i);
  syncMusic();
  state.selected = s.event || null;
  state.reading = false;
  if (state.zoom && !inWindow(s.year)) { state.scope = null; state.win = windowFor(state.zoom, s.year); refreshTimeline(); }
  emit("tour-step", { id: tour.id, index: i, step: s, steps: tr.steps, path: !!tr.path });
  // Redrawing the map and lists for the new year takes a moment; doing it in the flight's first frames made the camera
  // stall and then jump. So the year, battle cards and list change first and the flight starts after, unless the year's data is still
  // loading, in which case the flight leaves without waiting for it.
  const year = setYear(s.year).then(() => {
    if (state.tour !== tour || tour.i !== i) return;
    tourHighlight(s);
    renderArmies();
    renderLedger();
  });
  if (s.at) {
    const padding = tourPadding();
    await Promise.race([year, new Promise((r) => setTimeout(r, 400))]);
    if (state.tour !== tour || tour.i !== i) return;
    map.flyTo({ center: s.at, zoom: s.zoom ?? 4.8, pitch: state.show3d ? s.pitch ?? 48 : 0, bearing: s.bearing ?? -8,
      padding, duration: 2600, essential: true });
  }
  await year;
  // A step with `fit` frames the selected country as the map draws it that year (a country's story opens and closes so).
  if (s.fit && state.tour === tour && tour.i === i) {
    const b = [...selNames()].map(countryBounds).find(Boolean);
    if (b) map.fitBounds(b, { padding: tourPadding(), maxZoom: 6, pitch: state.show3d ? 30 : 0, bearing: 0, duration: 2200 });
  }
  saveView();
  // Autoplay moves on once the map has arrived and the narration (if any) has finished, else after a reading pause.
  // The map's arrival counts, or 4 s at most: a hidden page (a locked phone) pauses the flight but not the narration.
  if (tour.auto) Promise.race([new Promise((r) => map.once("moveend", r)), sleep(4000)]).then(async () => {
    if (state.tour !== tour || !tour.auto || tour.i !== i) return;
    if (narr.done) { await narr.done; if (state.tour === tour && tour.auto && tour.i === i) tour.timer = setTimeout(() => tourNext(), 1500); }
    else tour.timer = setTimeout(() => tourNext(), 3000 + tx(s, "text").length * (zh() ? 110 : 45));
  });
}
// Light up every state on the current map that the step's caption names (齐 in "齐桓公任用管仲"), or the step's own
// "highlight" list. The period's own dynasty (唐 on a Tang map) is left out: it would light up the whole map.
// Everyday words that happen to contain a one-character state name (随后, 时代, 清楚, 越过, 卫青 …) are taken out first.
const HL_STOP = /随后|随即|随着|跟随|伴随|唐代|宋代|时代|朝代|年代|古代|近代|后代|历代|世代|一代|五代|取代|代表|代替|替代|代价|交代|周游|周围|周边|四周|庄周|苏秦|秦岭|长安西|大理寺|陈兵|陈列|陈述|金字|金银|黄金|金属|金箔|金印|金牌|金人|韩非|韩信|清楚|痛楚|桥梁|栋梁|夏天|夏季|越过|越来越|超越|穿越|翻越|跨越|越南|整齐|一齐|齐心|齐全|晋升|晋见|辽阔|蔡伦|曹操|卫青|卫兵|守卫|保卫|护卫|侍卫|卫所|自卫|郑和|郑成功|魏征|赵匡胤/g;
function tourHighlight(s) {
  const gj = state.borders[state.snapshot];
  let names = [];
  const text = s ? s.text_zh.replace(HL_STOP, "") : "";
  if (s && gj) {
    const own = [state.era.name_zh, state.era.glyph];
    names = (gj.features || []).map((f) => f.properties.name_zh).filter((n) => n && !own.includes(n) &&
      (s.highlight ? s.highlight.includes(n) : n.split(/\s*[·(（)）]\s*/).some((part) => part && text.includes(part))));
  }
  const filter = ["in", ["get", "name_zh"], ["literal", [...new Set(names)]]];
  for (const id of ["hl-fill", "hl-line"]) if (map.getLayer(id)) map.setFilter(id, filter);
}
function captionLead(text) {
  const m = zh() ? text.match(/^([^，。：:,]{0,18}?\d+[^，。：:,]{0,8}?)[，：:,]\s*/) || text.match(/^(约?前?\d+年)()/)
    : text.match(/^([^:.]{0,40}?\d[^:.]{0,30}?):\s*/);
  return m ? [m[1], text.slice(m[0].length)] : [null, text];
}
function tourCard() {
  const tour = state.tour;
  if (!tour) return;
  const { tr, i } = tour, s = tr.steps[i];
  const box = $("tour");
  box.querySelector(".tour-title").textContent = tx(tr, "title");
  box.querySelector(".tour-count").textContent = `${i + 1} / ${tr.steps.length}`;
  // Captions usually open with their own date ("前685年，…", "About 139 BC: …"); show that as the red label instead of repeating it.
  const [when, rest] = captionLead(tx(s, "text"));
  box.querySelector(".tour-year").textContent = when || fmtYear(s.year);
  box.querySelector(".tour-text").textContent = rest;
  box.querySelector(".tour-story").hidden = !s.event;
  const r = refLink(s.ref), a = box.querySelector(".tour-ref");
  a.hidden = !r;
  if (r) { a.href = r.href; a.title = r.label; a.textContent = `${refLabel(r.ref)} ↗`; }
  box.querySelector(".tour-prev").disabled = i === 0;
  box.querySelector(".tour-next").textContent = i === tr.steps.length - 1 ? t("tourEnd") : t("tourNext");
  box.querySelector(".tour-auto").textContent = tour.auto ? t("tourPause") : t("tourPlay");
  box.querySelector(".tour-bar i").style.width = ((i + 1) / tr.steps.length) * 100 + "%";
  placeTourPic();
  syncTourTop();
}
// Free screen rectangles for a floating picture, clear of the panels in `els` and above `bottom`: the column between the
// side panels, and the full width below them. A panel wider than 60% of the screen (phone bars and sheets) only limits
// the top or bottom.
function freeRects(els, bottom, gap = 10, edge = 8) {
  let top = edge, colL = edge, colR = innerWidth - edge, below = edge;
  for (const el of els) {
    const r = el?.getBoundingClientRect();
    if (!r || !r.width || !r.height || getComputedStyle(el).display === "none" || r.top >= bottom) continue;
    if (r.width > innerWidth * 0.6) {
      if (r.top + r.height / 2 < innerHeight / 2) top = Math.max(top, r.bottom + gap); else bottom = Math.min(bottom, r.top - gap);
    } else {
      below = Math.max(below, r.bottom + gap);
      if (r.left + r.width / 2 < innerWidth / 2) colL = Math.max(colL, r.right + gap); else colR = Math.min(colR, r.left - gap);
    }
  }
  return [{ l: colL, r: colR, t: top, b: bottom }, { l: edge, r: innerWidth - edge, t: Math.max(top, below), b: bottom }];
}
// The biggest picture of the given aspect ratio that fits one of the rectangles, taking at most `share` of its height.
function fitPic(rects, ratio, share, maxW, maxH) {
  let best = null;
  for (const q of rects) {
    const w = Math.min(q.r - q.l, Math.min((q.b - q.t) * share, maxH) * ratio, maxW);
    if (w > 0 && (!best || w > best.w)) best = { ...q, w, h: w / ratio };
  }
  return best;
}
// The step's AI picture floats above the tour card, as large as the free space allows, taking at most about half
// the height above the card; tourPadding() keeps the map's focus in the space left over.
// A floating picture fades out, changes (`change` swaps its content and returns where it goes, or null to stay hidden),
// and fades back in once the new image has loaded. A newer change cancels an older one still waiting.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const placeBox = (box, at) => Object.assign(box.style, { left: at.x + "px", top: at.y + "px", width: at.w + "px", height: at.h + "px" });
async function fadePic(box, change) {
  const tok = (box.fadeTok = (box.fadeTok || 0) + 1);
  if (!box.hidden) { box.classList.add("fade-out"); await sleep(300); if (box.fadeTok !== tok) return; }
  const at = await change();
  if (box.fadeTok !== tok) return;
  if (!at) { box.hidden = true; box.classList.remove("fade-out"); return; }
  box.classList.add("fade-out");
  placeBox(box, at);
  box.hidden = false;
  const img = box.querySelector("img");
  if (img && !img.complete) await Promise.race([new Promise((r) => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }), sleep(1500)]);
  if (box.fadeTok !== tok) return;
  if (!img || (img.complete && !img.naturalWidth)) { box.hidden = true; box.classList.remove("fade-out"); return; } // could not be fetched
  void box.offsetWidth; // apply the transparent start first, so removing the class transitions
  box.classList.remove("fade-out");
}
// Where the step's AI picture goes above the tour card, or null when it does not fit. Worked out at once (tourPadding
// needs it before the flight starts), while the picture itself fades in a moment later.
function tourPicRect(im) {
  const card = $("tour").getBoundingClientRect();
  // Immersive mode folds the panels away, so the picture takes most of the screen above the card.
  const p = state.immersive ? fitPic(freeRects([], card.top - 10, 10, 16), im.w / im.h, 0.8, 1200, 800)
    : fitPic(freeRects([document.querySelector(".era"), $("ledger")], card.top - 10), im.w / im.h, 0.5, 560, 360);
  if (!p || p.h < 80) return null;
  const mid = Math.min(Math.max(card.left + card.width / 2, p.l + p.w / 2), p.r - p.w / 2);
  return { x: mid - p.w / 2, y: p.b - p.h, w: p.w, h: p.h };
}
function placeTourPic() {
  const box = $("tour-pic"), tour = state.tour, s = tour?.tr.steps[tour.i];
  // A step shows its event's picture, or else one painted for the step itself (tools/ai_prompts.json "tour.<tour id>.<step>").
  const idx = illuSets.aiReady, key = s?.event ? "a:" + s.event : s ? `a:tour.${tour.id}.${tour.i}` : "";
  const im = !EMBED && s && state.showAI && idx?.images[idx.keys[key]];
  const at = im ? tourPicRect(im) : null;
  box.rect = at;
  if (at && box.dataset.key === key + state.lang && !box.hidden) return placeBox(box, at);
  box.dataset.key = at ? key + state.lang : "";
  fadePic(box, async () => {
    if (!at) return null;
    box.innerHTML = illuSlot(key);
    await fillIllus(box);
    return at;
  });
}
// An opened event's AI picture is shown large in the middle of the free map area, with a close button. Closed, it
// stays closed for that event until the story is left; the small copy in the story opens it again.
const eventPic = { key: null, closed: null };
function eventPicRect(im) {
  // Above the timeline; in immersive mode (timeline hidden) above the tour card.
  const rail = document.querySelector(".rail").getBoundingClientRect(), tour = $("tour").getBoundingClientRect();
  const bottom = (rail.height ? rail.top : tour.height ? tour.top : innerHeight) - 10;
  const ratio = im.w / im.h;
  let p = fitPic(freeRects([document.querySelector(".era"), $("ledger")], bottom, 16), ratio, 0.8, 900, 600);
  // Too little room between the panels: cover them instead, centred over the map, until it is closed.
  if (!p || p.w < Math.min(480, innerWidth * 0.6)) p = fitPic([{ l: 8, r: innerWidth - 8, t: 8, b: bottom }], ratio, 0.75, 900, 600);
  return p && p.h >= 100 ? { x: (p.l + p.r - p.w) / 2, y: (p.t + p.b - p.h) / 2, w: p.w, h: p.h } : null;
}
async function showEventPic(id, force) {
  const box = $("event-pic"), key = "a:" + id;
  if (force) eventPic.closed = null;
  if (EMBED || !state.showAI || eventPic.closed === key) return hideEventPic();
  const idx = await illuSet("ai"), im = idx.images[idx.keys[key]];
  if (!im || state.selected !== id || !state.reading) return hideEventPic();
  const at = eventPicRect(im);
  if (!at) return hideEventPic();
  box.classList.toggle("manual", !!force); // opened by a click: shown even over the immersive reading card
  // Rebuilt when the language changes too, for the picture's description.
  if (eventPic.key === key + state.lang && !box.hidden) return placeBox(box, at);
  eventPic.key = key + state.lang;
  fadePic(box, async () => {
    box.querySelector(".ep-fig").innerHTML = illuSlot(key);
    await fillIllus(box);
    return at;
  });
}
// A Wikimedia picture opens in the same viewer: the packed thumbnail at once, then a sharp copy from Commons when it
// arrives (if Commons can't be reached, the thumbnail stays).
const commonsLarge = (url) => {
  const m = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:(.+)$/.exec(url || "");
  return m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1]}?width=1280` : null;
};
async function showIlluLarge(key) {
  const box = $("event-pic"), idx = await illuSet("img"), im = idx.images[idx.keys[key]];
  const at = im && eventPicRect(im);
  if (!at) return;
  eventPic.key = key + state.lang;
  box.classList.add("manual");
  fadePic(box, async () => {
    box.querySelector(".ep-fig").innerHTML = illuSlot(key);
    await fillIllus(box);
    const img = box.querySelector("img"), big = commonsLarge(im.url);
    if (img && big) { const hi = new Image(); hi.onload = () => { if (img.isConnected) img.src = big; }; hi.src = big; }
    return at;
  });
}
function hideEventPic(forget) {
  const box = $("event-pic");
  if (forget) { eventPic.closed = null; eventPic.key = null; }
  else if (box.hidden) return;
  fadePic(box, () => null);
}
// Keep the spot clear of the tour card at the bottom and the ledger on the right.
function tourPadding() {
  if (EMBED) return { top: 50, bottom: 30, left: 30, right: 30 };
  const phone = innerWidth <= 720;
  const card = $("tour").offsetHeight || 160;
  const pic = $("tour-pic").rect;
  if (state.immersive) return { top: 20, bottom: innerHeight - (pic ? pic.y : $("tour").getBoundingClientRect().top) + 20, left: 30, right: 30 };
  if (pic) {
    const b = innerHeight - pic.y + 30;
    return phone ? { top: 60, bottom: b, left: 20, right: 20 } : { top: 60, bottom: b, left: Math.min(380, innerWidth * 0.26), right: Math.min(380, innerWidth * 0.26) };
  }
  return phone ? { top: 60, bottom: card + 40, left: 20, right: 20 } : { top: 60, bottom: card + 60, left: Math.min(380, innerWidth * 0.26), right: Math.min(380, innerWidth * 0.26) };
}
function tourNext() {
  const tour = state.tour;
  if (!tour) return;
  if (tour.i < tour.tr.steps.length - 1) tourStep(tour.i + 1);
  else endTour();
}
function tourPause() {
  const tour = state.tour; if (!tour) return;
  tour.auto = false; clearTimeout(tour.timer);
  stopNarration();
  $("tour").querySelector(".tour-auto").textContent = t("tourPlay");
}
// 沉浸 (immersive): during a tour, every panel but the tour card folds away and the step's picture grows. The choice is
// remembered for the next tour; reading the story or ending the tour leaves it.
// How far the tour card's top is from the bottom of the screen: the immersive reading card ends just above it.
const syncTourTop = () => document.documentElement.style.setProperty("--tour-top", innerHeight - $("tour").getBoundingClientRect().top + "px");
const immersivePref = () => { try { return !EMBED && localStorage.getItem("atlas-immersive") === "1"; } catch { return false; } };
function setImmersive(on, remember = true) {
  state.immersive = on;
  $("app").classList.toggle("immersive", on);
  $("tour").querySelector(".tour-immersive").setAttribute("aria-pressed", String(on));
  if (remember) try { localStorage.setItem("atlas-immersive", on ? "1" : "0"); } catch {}
  if (!state.tour) return;
  placeTourPic();
  syncTourTop();
  map.easeTo({ padding: tourPadding(), duration: 600 }); // keep the step's spot in view in the space that is left
}
function endTour() {
  if (!state.tour) return;
  setImmersive(false, false);
  clearTimeout(state.tour.timer);
  state.tour = null;
  applyLayout();
  stopNarration();
  syncMusic();
  $("tour").hidden = true;
  $("tour-pic").rect = null; $("tour-pic").dataset.key = ""; fadePic($("tour-pic"), () => null);
  $("app").classList.remove("touring", "tour-reading");
  if (state.tab === "tours") renderToursTab();
  map.getSource("tour")?.setData({ type: "FeatureCollection", features: [] });
  tourLine.leg = null; drawTourLine();
  tourHighlight(null);
  emit("tour-end", {});
  syncAuto();
  renderArmies();
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  saveView();
}
// A leg of a journey is drawn as a gentle bow, not a ruler line: a quadratic curve bent to the left of travel by
// about a seventh of its length (at most 6°), taking the short way round the dateline.
function arcLeg(a, b, n = 40) {
  let bx = b[0];
  if (bx - a[0] > 180) bx -= 360; else if (a[0] - bx > 180) bx += 360;
  const k = Math.max(0.2, Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180));
  const dx = (bx - a[0]) * k, dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 0.02) return [a, b];
  const bend = Math.min(len / 7, 6);
  const cx = (a[0] + bx) / 2 - (dy / len) * bend / k, cy = (a[1] + b[1]) / 2 + (dx / len) * bend;
  const pts = [];
  for (let j = 0; j <= n; j++) {
    const t = j / n, u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * cx + t * t * bx;
    pts.push([((x + 540) % 360) - 180, u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
  }
  return pts;
}
// The journey so far: legs already travelled as a dotted trail, the leg into this stop as a solid line that draws
// itself while the camera flies, with an arrowhead at its tip, and the stops as rings (this one filled).
// The trail and stops are map layers, set once per stop. The leg being drawn is an SVG overlay re-projected on every
// rendered frame, so line and arrow move exactly with the map instead of waiting for the map to re-tile new data.
const tourLine = { svg: null, top: null, leg: null, f: 0, hooked: false, places: [], span: "" };
// The place a stop is at (its `place`/`place_zh`), shown by the stop while the tour is there.
const stopPlace = (s) => s && (zh() ? s.place_zh || s.place : s.place || s.place_zh);
function drawTourPath(tour, i) {
  const src = map.getSource("tour");
  if (!src) return;
  const { tr } = tour;
  cancelAnimationFrame(tour.anim);
  const steps = tr.steps.slice(0, i + 1);
  const stops = steps.map((x, k) => x.at && ({ type: "Feature", properties: { kind: "stop", now: k === i ? 1 : 0, n: k + 1 }, geometry: { type: "Point", coordinates: x.at } })).filter(Boolean);
  const legs = tr.path ? steps.slice(1).map((x, k) => arcLeg(steps[k].at, x.at)) : [];
  const past = legs.slice(0, -1).map((pts) => ({ type: "Feature", properties: { kind: "past" }, geometry: lineGeom(pts) }));
  src.setData({ type: "FeatureCollection", features: [...past, ...stops] });
  const leg = legs[legs.length - 1];
  tourLine.leg = leg && unwrapLine(leg);
  // Name the leg's two ends (or just the stop, on a tour without a trail).
  const prev = leg && steps[i - 1], cur = steps[i];
  tourLine.places = [prev && { at: prev.at, name: stopPlace(prev), from: true }, cur.at && { at: cur.at, name: stopPlace(cur) }]
    .filter((p) => p?.name && p.at);
  if (tourLine.places.length === 2 && tourLine.places[0].name === tourLine.places[1].name) tourLine.places.shift();
  // How long the leg took: the stop's own `took`/`took_zh` (e.g. "4个月") if it has one, else the years between the stops.
  tourLine.span = prev ? legSpan(prev, cur) : "";
  if (!leg || matchMedia("(prefers-reduced-motion: reduce)").matches) { tourLine.f = 1; return drawTourLine(); }
  const t0 = performance.now(), dur = 2200;
  const tick = (now) => {
    if (state.tour !== tour || tour.i !== i) return;
    // A frame's timestamp can be a little earlier than t0, so clamp to 0..1.
    const f = Math.min(1, Math.max(0, (now - t0) / dur));
    tourLine.f = 1 - (1 - f) ** 3;
    drawTourLine();
    if (f < 1) tour.anim = requestAnimationFrame(tick);
  };
  tourLine.f = 0;
  drawTourLine();
  tour.anim = requestAnimationFrame(tick);
}
// Longitudes made continuous (no jump at the dateline) so a point can be interpolated along the leg.
function unwrapLine(pts) {
  const out = [pts[0].slice()];
  for (let j = 1; j < pts.length; j++) {
    let x = pts[j][0];
    while (x - out[j - 1][0] > 180) x -= 360;
    while (out[j - 1][0] - x > 180) x += 360;
    out.push([x, pts[j][1]]);
  }
  return out;
}
function legSpan(a, b) {
  const took = zh() ? b.took_zh || b.took : b.took || b.took_zh;
  const n = b.year - a.year;
  if (n === 0) return took || (zh() ? `${fmtYear(b.year)} · 同年` : `${fmtYear(b.year)} · same year`);
  const yrs = took || (zh() ? `${n}年` : `${n} year${n === 1 ? "" : "s"}`);
  return `${fmtYear(a.year)} → ${fmtYear(b.year)} · ${yrs}`;
}
function drawTourLine() {
  const { leg, f, places, span } = tourLine;
  let svg = tourLine.svg, top = tourLine.top;
  if ((!leg && !places.length) || !state.tour) { for (const el of [svg, top]) if (el) el.style.display = "none"; return; }
  if (!svg) {
    svg = tourLine.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "tour-line");
    svg.innerHTML = `<path class="tl-glow"/><path class="tl-line"/><path class="tl-arrow" d="M0 -10 8 7 0 3 -8 7Z"/>`;
    const box = map.getCanvasContainer();
    box.insertBefore(svg, map.getCanvas().nextSibling);
    // The names and the time go on a layer of their own above the map's markers, so a city or event marker can't hide them.
    top = tourLine.top = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    top.setAttribute("class", "tour-line tour-labels");
    top.innerHTML = `<text class="tl-place"/><text class="tl-place"/><text class="tl-span"/>`;
    box.appendChild(top);
  }
  svg.style.display = top.style.display = "";
  // A city marker that already shows the same name right there keeps the map from saying it twice (checked a few
  // times a second, not every frame).
  const now = performance.now();
  if (!(now - (tourLine.dupAt || 0) < 300)) {
    tourLine.dupAt = now;
    const mk = [...document.querySelectorAll(".maplibregl-marker:not(.dc-hide)")].filter((el) => !el.classList.contains("dc-nolabel"));
    for (const p of places) {
      const q = map.project(p.at), box = map.getContainer().getBoundingClientRect();
      p.dup = mk.some((el) => {
        const span = el.querySelector("span");
        if (!span || span.textContent.trim() !== p.name) return false;
        const r = el.getBoundingClientRect();
        return Math.hypot((r.left + r.right) / 2 - box.left - q.x, (r.top + r.bottom) / 2 - box.top - q.y) < 60;
      });
    }
  }
  top.querySelectorAll(".tl-place").forEach((el, k) => {
    const p = places[k];
    el.style.display = p && !p.dup ? "" : "none";
    if (!p) return;
    const q = map.project(p.at);
    el.textContent = p.name;
    el.classList.toggle("from", !!p.from);
    el.setAttribute("x", q.x.toFixed(1));
    el.setAttribute("y", (q.y - 14).toFixed(1));
  });
  const arrow = svg.querySelector(".tl-arrow"), spanEl = top.querySelector(".tl-span");
  spanEl.style.display = "none";
  if (!leg) {
    svg.querySelector(".tl-glow").setAttribute("d", "");
    svg.querySelector(".tl-line").setAttribute("d", "");
    arrow.style.display = "none";
    return;
  }
  const at = (g) => {
    const p = Math.min(1, Math.max(0, g)) * (leg.length - 1), j = Math.min(leg.length - 2, Math.floor(p)), t = p - j;
    return [leg[j][0] + (leg[j + 1][0] - leg[j][0]) * t, leg[j][1] + (leg[j + 1][1] - leg[j][1]) * t];
  };
  const n = Math.max(0, Math.floor(f * (leg.length - 1)));
  const pts = [...leg.slice(0, n + 1), at(f)].map((q) => map.project(q));
  const d = pts.length > 1 && f > 0 ? "M" + pts.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join("L") : "";
  svg.querySelector(".tl-glow").setAttribute("d", d);
  svg.querySelector(".tl-line").setAttribute("d", d);
  // While drawing, the arrowhead leads the line; once there it rests halfway along, clear of the stop's ring.
  // The time sits beside the middle of the leg once the line has passed it; when the middle is off screen (a long leg
  // seen close up), under the destination's name.
  if (span && f >= 0.5) {
    const m = map.project(at(0.5)), a = map.project(at(0.45)), b = map.project(at(0.55));
    const c = map.getContainer(), onScreen = m.x > 60 && m.y > 40 && m.x < c.clientWidth - 60 && m.y < c.clientHeight - 40;
    let x, y;
    if (onScreen) {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, side = ny > 0 ? -1 : 1;
      x = m.x + nx * side * 16; y = m.y + ny * side * 16 + 4;
    } else {
      const d = map.project(leg[leg.length - 1]);
      x = d.x; y = d.y + 26;
    }
    spanEl.textContent = span;
    spanEl.style.display = "";
    spanEl.setAttribute("x", x.toFixed(1));
    spanEl.setAttribute("y", y.toFixed(1));
  }
  const g = f >= 1 ? 0.55 : f;
  if (g <= 0.01) { arrow.style.display = "none"; return; }
  const pa = map.project(at(Math.max(0, g - 0.02))), pb = map.project(at(g));
  arrow.style.display = "";
  arrow.setAttribute("transform", `translate(${pb.x.toFixed(1)} ${pb.y.toFixed(1)}) rotate(${((Math.atan2(pb.x - pa.x, pa.y - pb.y) * 180) / Math.PI).toFixed(1)})`);
}
function addTourLayers() {
  map.addSource("tour", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const line = (kind) => ["==", ["get", "kind"], kind];
  map.addLayer({ id: "tour-past", type: "line", source: "tour", filter: line("past"),
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#b93a26", "line-width": 3, "line-dasharray": [0, 2], "line-opacity": 0.75 } }, map.getLayer("spread-dot") ? "spread-dot" : undefined);
  map.addLayer({ id: "tour-stops", type: "circle", source: "tour", filter: line("stop"),
    paint: { "circle-radius": ["case", ["==", ["get", "now"], 1], 8, 4.5], "circle-color": ["case", ["==", ["get", "now"], 1], "#b93a26", "#fff6f2"],
      "circle-stroke-color": ["case", ["==", ["get", "now"], 1], "#fff6f2", "#b93a26"], "circle-stroke-width": ["case", ["==", ["get", "now"], 1], 2.5, 2] } });
  if (!tourLine.hooked) { tourLine.hooked = true; map.on("render", () => { if (tourLine.leg || tourLine.places.length) drawTourLine(); }); }
}

/* ---------- search: events, people, rulers, cities, periods and years ---------- */

// Everyone and every ruler sits in the per-period layer files; they are loaded on the first search.
let searchIndex = null;
async function buildSearchIndex() {
  const layers = await Promise.all(state.regions.flatMap((r) => r.eras).filter((e) => e.layers).map((e) => loadLayers(e).then((L) => [e, L])));
  const people = [], seen = new Set(), rulers = [];
  for (const [era, L] of layers) {
    for (const p of L.people || []) if (!seen.has(p.id)) { seen.add(p.id); people.push({ p, era }); }
    // A ruler whose reign spans two periods is listed in both layers; keep the first.
    for (const [polity, list] of Object.entries(L.rulers || {})) list.forEach((r, i) => {
      const k = `${r.name_zh || r.name}|${r.from}`;
      if (!seen.has(k)) { seen.add(k); rulers.push({ r, i, polity, era, pz: L.polities?.[polity]?.name_zh }); }
    });
  }
  const cities = new Map();
  for (const c of state.places) { const k = cityId(c); if (!cities.has(k)) cities.set(k, []); cities.get(k).push(c); }
  return { people, rulers, cities: [...cities.values()], tours: await loadTours() };
}
// "755", "755年", "前221", "公元前221年", "-221", "221 BC", "221bce"
function parseYear(q) {
  const m = q.replace(/\s+/g, "").match(/^(公元前|前|-|bc|bce)?(\d{1,4})(年|bc|bce|ce|ad)?$/i);
  if (!m) return null;
  const bc = /^(公元前|前|-|bc|bce)$/i.test(m[1] || "") || /^(bc|bce)$/i.test(m[3] || "");
  const y = bc ? -+m[2] : +m[2];
  return y >= state.range.start && y <= state.range.end ? y : null;
}
function searchResults(q) {
  const low = q.toLowerCase(), has = (...xs) => xs.some((x) => x && String(x).toLowerCase().includes(low));
  const out = [];
  const y = parseYear(q);
  if (y != null) out.push({ g: "time", year: y, title: fmtYear(y), sub: `${nameOf(eraFor(y))} · ${t("jumpYear")}`, go: () => jumpToYear(y) });
  for (const r of state.regions) for (const e of r.eras) if (has(e.name, e.name_zh, e.glyph))
    out.push({ g: "era", year: e.start, title: nameOf(e), sub: `${nameOf(r)} · ${fmtYear(e.since ?? e.start)} – ${fmtYear(e.until ?? e.end)}`, go: () => goToEra(e) });
  if (searchIndex) {
    // Tours named in the title first, then by summary, then by any step that mentions it (which the tour opens at).
    const tm = searchIndex.tours.map((tr) => {
      if (has(tr.title_zh, tr.title)) return [tr, 0, 0];
      if (has(tr.summary_zh, tr.summary)) return [tr, 1, 0];
      const k = tr.steps.findIndex((st) => has(st.text_zh, st.text));
      return [tr, k < 0 ? 9 : 2, k];
    }).filter(([, m]) => m < 9).sort((a, b) => a[1] - b[1] || a[0].start - b[0].start).slice(0, 8);
    for (const [tr, m, k] of tm)
      out.push({ g: "tour", year: m === 2 ? tr.steps[k].year : tr.start, title: tx(tr, "title"),
        sub: m === 2 ? `${t("tourAt")(k + 1)} · ${tx(tr.steps[k], "text").slice(0, zh() ? 28 : 60)}…` : `${fmtYear(tr.start)}–${fmtYear(tr.end)} · ${t("tourSteps")(tr.steps.length)}`,
        go: () => startTour(tr.id, k) });
    for (const { p, era } of searchIndex.people.filter(({ p }) => has(p.name_zh, p.name)).slice(0, 10))
      out.push({ g: "person", year: p.born ?? p.died, title: nameOf(p), sub: `${t("fields")[p.field] || ""} · ${personLife(p)}`, go: () => jumpToPerson(p, era) });
    for (const { r, i, polity, era, pz } of searchIndex.rulers.filter(({ r }) => has(r.name_zh, r.name, r.title_zh, r.title, r.rank_zh)).slice(0, 10))
      out.push({ g: "ruler", year: r.from, title: zh() ? `${r.title_zh || r.title || r.rank_zh || ""} ${r.name_zh || ""}`.trim() : `${r.title || r.name}`,
        sub: `${zh() ? pz || polity : polity} · ${fmtYear(r.from)} – ${fmtYear(r.to)}`, go: () => jumpToRuler(polity, i, era) });
    const found = new Set();
    for (const list of searchIndex.cities.filter((l) => l.some((c) => has(c.name_zh, c.name, c.modern_zh, c.modern))).slice(0, 8)) {
      const c = list.find((c) => has(c.name_zh, c.name)) || list[0];
      found.add(cityId(c));
      out.push({ g: "city", year: c.from, title: nameOf(c), sub: zh() ? `今${c.modern_zh || c.modern}` : `modern ${c.modern}`, go: () => jumpToCity(c) });
    }
    out.push(...gazSearch(has, found));
  }
  // Events named in the title first, then those that only happened at a matching place; key events first.
  const evs = state.events.map((ev) => [ev, has(ev.title_zh, ev.title) ? 0 : has(ev.place_zh, ev.place) ? 1 : 2]).filter(([, m]) => m < 2)
    .sort((a, b) => a[1] - b[1] || (a[0].level || 1) - (b[0].level || 1)).slice(0, 15);
  for (const [ev] of evs) out.push({ g: "event", year: ev.year, title: titleOf(ev), sub: tx(ev, "place"), go: () => openStory(ev.id) });
  return out;
}
let searchHits = [], searchOn = 0;
function renderSearch() {
  const q = $("search-q").value.trim(), box = $("search-results");
  if (!q) { box.innerHTML = ""; searchHits = []; return; }
  searchHits = searchResults(q);
  searchOn = 0;
  if (!searchHits.length) { box.innerHTML = `<p class="empty">${t("noResults")}</p>`; return; }
  let html = "", g = null;
  searchHits.forEach((h, i) => {
    if (h.g !== g) { g = h.g; html += `<h5>${t("sgroups")[g]}</h5>`; }
    html += `<button type="button" data-i="${i}" class="${i === 0 ? "on" : ""}"><span>${h.year != null ? fmtYear(h.year) : ""}</span><b>${esc(h.title)}</b>${h.sub ? `<small>${esc(h.sub)}</small>` : ""}</button>`;
  });
  box.innerHTML = html;
}
// The era panel makes room below the search panel and follows its height as results come and go.
const SEARCH_GAP = 8;
let searchShut = 0, searchSize = null;
function pushEra() {
  const box = $("search"), open = !box.hidden && !box.classList.contains("closing");
  document.documentElement.style.setProperty("--search-push", open ? `${box.offsetHeight + SEARCH_GAP}px` : "0px");
}
async function openSearch() {
  clearTimeout(searchShut);
  $("search").classList.remove("closing");
  $("search").hidden = false;
  if (!searchSize && window.ResizeObserver) (searchSize = new ResizeObserver(pushEra)).observe($("search"));
  pushEra();
  $("search-q").placeholder = t("searchPh");
  $("search-q").focus();
  $("search-q").select();
  gazData();
  if (!searchIndex) { searchIndex = await buildSearchIndex(); renderSearch(); }
}
function closeSearch() {
  const box = $("search");
  if (box.hidden || box.classList.contains("closing")) return;
  box.classList.add("closing");
  pushEra();
  const done = () => { box.hidden = true; box.classList.remove("closing"); };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
  searchShut = setTimeout(done, 200);
}
function pickSearch(i) { const h = searchHits[i]; if (!h) return; closeSearch(); h.go(); }
async function jumpToYear(y) {
  stop();
  state.selected = null; state.reading = false; state.scope = null;
  if (state.zoom && !inWindow(y)) { state.win = windowFor(state.zoom, y); refreshTimeline(); }
  await setYear(y);
  renderLedger();
}
async function jumpToPerson(p, era) {
  setMode(era.region);
  const [a, b] = personSpan(p);
  await jumpToYear(Math.max(era.start, Math.min(era.end, Math.round((a + b) / 2))));
  focusPerson(p);
}
async function jumpToRuler(polity, i, era) {
  // A ruler of another region: switch the timeline there and bring the region into view.
  const reg = state.regionById[era.region];
  if (setMode(era.region) && reg?.polygon?.length)
    map.fitBounds(polyBounds(reg.polygon), { padding: { top: 120, bottom: 140, left: 60, right: innerWidth > 720 ? 380 : 60 }, maxZoom: 5, duration: 1400 });
  const r = (await loadLayers(era)).rulers[polity][i];
  await jumpToYear(Math.max(era.start, Math.min(era.end, r.from)));
  state.layerData = await loadLayers(era);
  state.tab = "rulers";
  state.rulerPolity = polity;
  scopeToRuler(polity, i);
  renderLedger();
}
async function jumpToCity(c) {
  if (state.year < c.from || state.year > c.to) await jumpToYear(Math.max(c.from, state.range.start));
  map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(map.getZoom(), 5), duration: 1200, essential: true });
  map.once("moveend", () => showCard([c.lon, c.lat], placeCard(c)));
}

/* ---------- timeline rail ---------- */

// Floating tag over the rail while dragging: the period (and map snapshot when zoomed in) and the year.
// It lives in the rail, not the (scrollable) track, so it isn't clipped when the track pages sideways.
function showScrubTag(p, y) {
  let tag = $("scrub-tag");
  if (!tag) { tag = document.createElement("div"); tag.id = "scrub-tag"; tag.className = "scrub-tag"; document.querySelector(".rail").appendChild(tag); }
  const era = eraFor(y);
  const snap = state.zoom ? [...era.snapshots].reverse().find((s) => s.from <= y) : null;
  tag.innerHTML = `<b>${esc(nameOf(era))}</b> <span>${fmtYear(y)}</span>` + (snap && tx(snap, "label") ? `<small>${esc(tx(snap, "label"))}</small>` : "");
  tag.hidden = false;
  const t = document.querySelector(".track").getBoundingClientRect(), r = document.querySelector(".rail").getBoundingClientRect();
  const x = t.left + (p / SLIDER_MAX) * t.width - r.left;
  tag.style.left = `clamp(56px, ${x}px, calc(100% - 56px))`;
  document.querySelectorAll(".band.era-band").forEach((b) => b.classList.toggle("scrub", b.dataset.era === era.id));
}
// After a tap on the slim timeline the tag stays a moment, so the period it landed in is named.
let tagTimer = 0;
function flashScrubTag(p, y) {
  showScrubTag(p, y);
  clearTimeout(tagTimer);
  tagTimer = setTimeout(hideScrubTag, 1400);
}
function hideScrubTag() {
  clearTimeout(tagTimer);
  const tag = $("scrub-tag");
  if (tag) tag.hidden = true;
  document.querySelectorAll(".band.scrub").forEach((b) => b.classList.remove("scrub"));
}

function hintText() {
  const h = t("hint")[state.zoom];
  return typeof h === "function" ? h(state.era ? nameOf(state.era) : "") : h;
}

// Era labels sit centred on their band and may spill past it. They are placed current era first, then widest band
// first, skipping any that would overlap one already placed; dragging the rail names the rest.
// Landmark periods named first when space is short (the classic 夏商周 秦汉 唐宋元明清 sequence).
const LANDMARKS = ["tang", "western-han", "ming", "qing", "qin", "northern-song", "yuan", "shang", "western-zhou", "xia", "spring-autumn", "warring-states"];
const rank = (b) => { const i = LANDMARKS.indexOf(b.dataset.era); return i < 0 ? 99 : i; };
function fitBandLabels() {
  const bands = [...document.querySelectorAll("#bands .band")];
  bands.forEach((b) => b.classList.remove("tight"));
  const era = bands.filter((b) => b.classList.contains("era-band"));
  for (const b of bands) if (!era.includes(b)) b.classList.toggle("tight", b.scrollWidth > b.clientWidth + 1);
  if (!era.length) return;
  const track = $("bands").getBoundingClientRect();
  const items = era.map((b) => {
    const r = b.getBoundingClientRect(), w = b.firstElementChild.getBoundingClientRect().width;
    return { b, c: r.left + r.width / 2, w, span: r.width, cur: b.classList.contains("current") };
  }).sort((x, y) => (y.cur - x.cur) || (rank(x.b) - rank(y.b)) || (y.span - x.span));
  // Phones keep wide gaps between names so the rail reads as a few landmarks.
  const gap = innerWidth <= 720 && !pagedRail() ? 7 : 3, placed = [];
  for (const it of items) {
    const a = it.c - it.w / 2 - gap, z = it.c + it.w / 2 + gap;
    const inside = it.c - it.w / 2 >= track.left - 4 && it.c + it.w / 2 <= track.right + 4;
    const fits = inside && (gap < 5 || it.cur || rank(it.b) < 99) && placed.every(([p, q]) => z <= p || a >= q);
    if (fits) placed.push([a, z]);
    it.b.classList.toggle("tight", !fits);
  }
}
// Phones, whole-history view: the track is wider than the screen and pages sideways, so every period gets its name.
const pagedRail = () => state.zoom === 0 && innerWidth <= 720 && !state.railSlim;
function sizeTrack() {
  const view = $("track-view"), track = document.querySelector(".track");
  track.style.width = pagedRail() ? Math.round(view.clientWidth * 3.6) + "px" : "";
}
// Keep the current year in view on a paged track.
function revealYear(smooth) {
  if (!pagedRail()) return;
  const view = $("track-view"), x = (yearToPos(state.year) / SLIDER_MAX) * document.querySelector(".track").offsetWidth;
  const m = view.clientWidth / 5;
  if (x < view.scrollLeft + m || x > view.scrollLeft + view.clientWidth - m)
    view.scrollTo({ left: x - view.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
}
// Slim timeline: a thin strip of periods without names and a row of round years under the slider; the tag names the
// period while pointing, dragging or after a tap. Years are placed coarse to fine, each kept only where it has room,
// so the stretched short periods of the whole-history view get finer numbers than the long ones.
const YEAR_STEPS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
// The button on the timeline shows what it switches to: the full timeline's two rows, or the slim one's single line.
const RAIL_FULL_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="12" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 11.5h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const RAIL_SLIM_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 11v1M8 11v1M11 11v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
function setRailStyleButton() {
  const btn = $("rail-style"), on = !!state.railSlim;
  btn.innerHTML = on ? RAIL_FULL_ICON : RAIL_SLIM_ICON;
  btn.setAttribute("aria-pressed", String(on));
  btn.title = t(on ? "slimOff" : "slimOn");
  btn.setAttribute("aria-label", btn.title);
}
function setRailSlim(on, remember) {
  state.railSlim = on;
  document.querySelector(".rail").classList.toggle("slim", on);
  setRailStyleButton();
  if (remember) try { localStorage.setItem("atlas-rail-slim", on ? "1" : "0"); } catch {}
  hideScrubTag();
  if (state.ready) buildRail();
  if (!$("settings").hidden) renderSettings();
}
function renderYearMarks() {
  const box = $("years");
  box.innerHTML = "";
  const w = box.clientWidth;
  if (!state.railSlim || !w || !state.eras?.length) return;
  const [a, b] = state.zoom ? state.win : [state.eras[0]?.start ?? state.range.start, state.eras.at(-1)?.end ?? state.range.end];
  const placed = [], pad = innerWidth <= 720 ? 10 : 18;
  for (const step of YEAR_STEPS) {
    if (!state.zoom && step < 50) break;
    for (let y = Math.ceil(a / step) * step; y <= b; y += step) {
      if (y === 0) continue;
      const x = (yearToPos(y) / SLIDER_MAX) * w, n = Math.abs(y);
      const s = document.createElement("span");
      s.innerHTML = y > 0 ? n : zh() ? "前" + n : `${n}<small>BCE</small>`;
      s.style.left = x + "px";
      box.appendChild(s);
      const h = s.offsetWidth / 2;
      // The play button's speed badge reaches over the strip's left end.
      if (x - h < 10 || x + h > w || placed.some(([p, q]) => x + h + pad > p && x - h - pad < q)) { s.remove(); continue; }
      placed.push([x - h, x + h]);
    }
  }
}
function buildRail() {
  if (state.dial) buildDial();
  sizeTrack();
  requestAnimationFrame(() => { fitBandLabels(); renderYearMarks(); revealYear(false); });
  const pct = (p) => (p / SLIDER_MAX) * 100;
  const bands = $("bands");
  bands.innerHTML = "";
  if (state.zoom === 0) {
    for (const s of state.scale) {
      const e = s.era;
      const b = document.createElement("button");
      b.className = "band era-band" + (e === state.era ? " current" : "");
      b.dataset.era = e.id;
      b.style.left = pct(s.p0) + "%";
      b.style.width = pct(s.p1 - s.p0) + "%";
      b.innerHTML = `<b>${esc(bandName(e))}</b>`;
      b.title = `${nameOf(e)} ${fmtYear(e.since ?? e.start)} – ${fmtYear(e.until ?? e.end)} · ${t("lasted")(eraYears(e))}`;
      b.addEventListener("click", () => goToEra(e));
      bands.appendChild(b);
      // English names are longer than the Chinese glyphs: fall back to the tiny form, then to nothing (the tooltip has it).
      if (!zh() && b.scrollWidth > b.clientWidth + 1) {
        for (const n of [...(e.tiny || "").split("|"), ""]) { b.firstChild.textContent = n; if (b.scrollWidth <= b.clientWidth + 1) break; }
      }
    }
  } else {
    // Zoomed in: one segment per border snapshot, so each change of the map is one click away.
    const [a, z] = state.win;
    for (const e of state.eras) {
      if (e.end < a || e.start > z) continue;
      e.snapshots.forEach((s, i) => {
        const from = Math.max(s.from, a), to = Math.min((e.snapshots[i + 1]?.from ?? e.end + 1) - 1, z);
        if (to < from) return;
        const b = document.createElement("button");
        b.className = "band snap" + (i === 0 && s.from >= a ? " era-start" : "");
        b.dataset.path = s.borders;
        b.dataset.from = s.from;
        b.style.left = pct(yearToPos(from)) + "%";
        b.style.width = pct(yearToPos(to + 1) - yearToPos(from)) + "%";
        b.innerHTML = (i === 0 && s.from >= a ? `<b>${esc(bandName(e))}</b> ` : "") + `<span>${s.from >= a ? "" : "← "}${fmtYear(s.from)}</span>`;
        b.title = tx(s, "label") || `${nameOf(e)} ${fmtYear(e.since ?? e.start)} – ${fmtYear(e.until ?? e.end)}`;
        b.addEventListener("click", () => { stop(); setYear(from); });
        bands.appendChild(b);
      });
    }
  }
  // The selected country's years, as a gold bar under the bands.
  for (const [a, b] of state.sel?.years || []) {
    const [lo, hi] = state.zoom ? state.win : [state.eras[0]?.start, state.eras.at(-1)?.end];
    if (b < lo || a > hi) continue;
    const bar = document.createElement("div");
    bar.className = "sel-span";
    const p0 = yearToPos(Math.max(a, lo)), p1 = yearToPos(Math.min(b, hi) + 1);
    bar.style.left = pct(p0) + "%";
    bar.style.width = Math.max(0.3, pct(p1 - p0)) + "%";
    bar.title = `${selName()} ${fmtYear(a)} – ${fmtYear(b)}`;
    bands.appendChild(bar);
  }
  const ticks = $("ticks");
  ticks.innerHTML = "";
  for (const ev of state.events) {
    if (!shownEvent(ev) || !inWindow(ev.year)) continue;
    const tk = document.createElement("button");
    tk.className = "tick l" + (ev.level || 1);
    tk.style.left = pct(state.zoom ? (yearToPos(ev.year) + yearToPos(ev.year + 1)) / 2 : yearToPos(ev.year)) + "%";
    tk.title = `${fmtYear(ev.year, ev.circa)} · ${titleOf(ev)}`;
    tk.tabIndex = -1;
    tk.addEventListener("click", () => openStory(ev.id));
    ticks.appendChild(tk);
  }
  // The whole rail runs from the first period to the last (a pack's periods may cover less than the atlas's range).
  const [a, b] = state.zoom ? state.win : [state.eras[0]?.start ?? state.range.start, state.eras.at(-1)?.end ?? state.range.end];
  $("scale-start").textContent = fmtYear(a);
  $("scale-end").textContent = fmtYear(b);
  $("scale-hint").textContent = hintText();
  $("zoom-level").textContent = state.scope ? state.scope.label : t("zooms")[state.zoom];
  $("zoom-level").classList.toggle("scoped", !!state.scope);
  $("zoom-in").disabled = state.zoom === ZOOMS.length - 1;
  $("zoom-out").disabled = state.zoom === 0;
  $("pan-prev").hidden = $("pan-next").hidden = state.zoom === 0;
  $("pan-prev").disabled = !!state.zoom && state.win[0] <= state.range.start;
  $("pan-next").disabled = !!state.zoom && state.win[1] >= state.range.end;
  $("app").dataset.zoom = ZOOMS[state.zoom];
}

// Playback moves through each era (or the zoomed window) in roughly the same time.
/* ---------- background music ---------- */
// One quiet track per period (data/music.json names <DATA_URL>/atlas/music/<file>, made by tools/ai_music.py and
// tools/pack_music.py). It plays during tours and timeline playback while the music switch is on, follows the period
// on screen and crossfades when that changes. Volume goes through Web Audio, because iOS ignores an audio
// element's volume (the R2 files send the CORS header this needs).
const MUSIC_VOL = 0.3, MUSIC_FADE = 1.5;
// In a tour, a step can carry a mood (data/moods.json: {"<tour id>/<step>": sorrow|tension|battle|triumph|journey|serene|
// solemn}, AI-tagged); its track ("mood/<culture>-<mood>", the culture from the tour's region and the step's year: the
// region's early instruments before 500, its later ones after, a modern ensemble from 1840) then plays instead of the
// period's, and the period's comes back on steps without one. Consecutive steps with one mood keep the track playing.
const music = { key: null, track: null, ctx: null, index: null, moods: null };
const moodCulture = (region, year) => year >= 1840 ? (region === "china" ? "china-modern" : "modern")
  : year < 500 ? `${region}-early` : region;
function musicWanted() {
  if (EMBED || !state.music || !(state.tour || state.playing) || !state.era || state.era.region === "world") return null;
  const period = `${state.era.region}/${state.era.id}`, tour = state.tour, s = tour?.tr.steps[tour.i];
  const mood = s && music.moods?.[`${tour.id}/${tour.i}`];
  return mood ? [`mood/${moodCulture(tourRegion(tour.tr), s.year)}-${mood}`, period] : [period];
}
async function syncMusic() {
  if (state.tour && !music.moods) music.moods = await loadJSON("data/moods.json").catch(() => ({}));
  music.index ||= Promise.all([loadJSON("data/music.json").catch(() => ({})), packMedia("music")]).then(([a, p]) => ({ ...a, ...p }));
  const idx = await music.index;
  const want = musicWanted()?.find((k) => idx[k]) || null;
  if (want === music.key) return;
  music.key = want;
  if (music.track) stopTrack(music.track);
  music.track = null;
  const f = want && idx[want]?.f;
  if (!f) return;
  try {
    const ctx = music.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const el = new Audio();
    el.crossOrigin = "anonymous"; el.loop = true; el.preload = "auto"; el.src = mediaSrc("music", f);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
    music.track = { el, gain };
    await el.play();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(narr.done ? MUSIC_VOL * 0.3 : MUSIC_VOL, ctx.currentTime + MUSIC_FADE); // under a voice already speaking, stepped back
  } catch {} // no audio (blocked autoplay, offline): the atlas goes on silently
}
function stopTrack({ el, gain }) {
  const ctx = music.ctx, now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + MUSIC_FADE);
  setTimeout(() => { el.pause(); el.removeAttribute("src"); el.load(); }, MUSIC_FADE * 1000 + 100);
}
// Tour narration: each step's Chinese caption read by a Gemini TTS voice (data/narration.json, tools/ai_narration.py), when
// the 旁白 switch is on. One audio element is reused, because iOS only lets an element that a tap has started play
// again later. A file is used only if it was made from the step's current caption (CRC), so an edited caption falls
// silent rather than reading old words. While a voice speaks, the background music steps back.
const narr = { el: null, index: null, done: null, unlocked: false };
const crc32 = (str) => {
  let c, crc = -1;
  for (const b of new TextEncoder().encode(str)) { c = (crc ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, "0");
};
async function narrateStep(tour, i) {
  stopNarration();
  const s = tour.tr.steps[i];
  if (EMBED || !state.narration || !s?.text_zh) return; // an app embedding the atlas plays its own sound
  narr.index ||= Promise.all([loadJSON("data/narration.json").catch(() => ({})), packMedia("narration")]).then(([a, p]) => ({ ...a, ...p }));
  const n = (await narr.index)[`${tour.id}/${i}`], f = n && n.h === crc32(s.text_zh) && n[state.voice];
  if (!f || state.tour !== tour || tour.i !== i) return;
  const el = narr.el ||= new Audio();
  el.src = mediaSrc("narration", f);
  narr.done = new Promise((r) => { el.onended = el.onerror = r; });
  duckMusic(true);
  narr.done.then(() => duckMusic(false));
  el.play().catch((err) => { console.warn("narration", err); narr.done = null; duckMusic(false); });
}
// Browsers only let audio start from a tap, and the clip starts after the narration list has loaded and the step has
// begun, when that tap no longer counts. So the first tap or key press while narration is on plays a silent sound on the
// shared element, which lets it play later without one.
const SILENT = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA==";
function unlockNarration() {
  if (!state.narration || narr.unlocked) return;
  narr.unlocked = true;
  const el = narr.el ||= new Audio();
  if (el.src && !el.paused) return;
  el.src = SILENT;
  el.play().catch((err) => { if (err.name === "NotAllowedError") narr.unlocked = false; });
}
for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, unlockNarration, { capture: true });
function stopNarration() {
  if (narr.el && !narr.el.paused) narr.el.pause();
  narr.done = null;
  duckMusic(false);
}
function duckMusic(on) {
  const tr = music.track, ctx = music.ctx;
  if (!tr || !ctx) return;
  const now = ctx.currentTime;
  tr.gain.gain.cancelScheduledValues(now);
  tr.gain.gain.setValueAtTime(tr.gain.gain.value, now);
  tr.gain.gain.linearRampToValueAtTime(on ? MUSIC_VOL * 0.3 : MUSIC_VOL, now + 0.6);
}
function setNarration(on, remember = true) {
  state.narration = on;
  for (const b of document.querySelectorAll(".narr-toggle")) b.setAttribute("aria-pressed", String(on));
  for (const b of document.querySelectorAll(".narr-toggle")) {
    const inTour = !!b.closest(".tour-ctl");
    b.querySelector(".music-label").textContent = (inTour ? " " : "") + (on ? (inTour ? "" : t("tourNarr").trim() + " · ") + t("voices")[state.voice] : t("tourNarr").trim());
    b.querySelector(".narr-short").textContent = on ? t("voices")[state.voice].slice(0, 1) : "";
  }
  if (remember) try { localStorage.setItem("atlas-narration", on ? "1" : "0"); localStorage.setItem("atlas-voice", state.voice); } catch {}
  if (state.tour && on) narrateStep(state.tour, state.tour.i); else stopNarration();
  if (!$("settings").hidden) renderSettings();
}
function setMusic(on, remember = true) {
  state.music = on;
  for (const b of document.querySelectorAll(".music-toggle")) b.setAttribute("aria-pressed", String(on));
  if (remember) try { localStorage.setItem("atlas-music", on ? "1" : "0"); } catch {}
  syncMusic();
}
function play() {
  if (state.playing) return stop();
  if (state.year >= state.range.end) setYear(state.range.start);
  state.selected = null;
  state.reading = false;
  $("play-icon").innerHTML = '<path d="M3 2h4v12H3zM9 2h4v12H9z"/>';
  $("play").setAttribute("aria-label", t("pause"));
  const base = state.zoom === 2 ? 450 : 260, tick = Math.max(120, base / state.speed);
  setTimeout(syncMusic, 0); // once state.playing is set
  setTimeout(() => state.layout && applyLayout(), 0);
  state.playing = setInterval(() => {
    if (state.year >= state.range.end) return stop();
    const era = state.era;
    const len = state.zoom === 2 ? state.win[1] - state.win[0] + 1 : era.end - era.start + 1;
    // Fast speeds take bigger steps rather than ticking faster than the map can redraw.
    const step = Math.max(1, Math.round((len / 50) * Math.max(1, (tick * state.speed) / base)));
    let next = Math.min(state.year + step, state.range.end);
    if (next > era.end && era.end >= state.year) next = era.end + 1; // land on the next era's first year
    const hit = state.events.filter((e) => shownEvent(e) && e.year > state.year && e.year <= next).pop();
    if (hit) state.selected = hit.id;
    setYear(next).then(() => { if (hit) renderLedger(); });
  }, tick);
}
// Playback speed: the badge on the play button opens a menu of these.
const SPEEDS = [0.125, 0.25, 0.5, 1, 2, 4, 8];
const speedText = (v) => ({ 0.125: "⅛", 0.25: "¼", 0.5: "½" }[v] || String(v)) + "×";
function setSpeed(v, remember) {
  state.speed = SPEEDS.includes(v) ? v : 1;
  $("speed").textContent = speedText(state.speed);
  if (remember) try { localStorage.setItem("atlas-speed", String(state.speed)); } catch {}
  if (state.playing) { stop(); play(); }
  if (!$("settings").hidden) renderSettings();
}
/* ---------- layouts: how the panels are arranged (html[data-layout], style.css) ---------- */

// The chosen layout is where Atlas rests; 自动布局 changes it for a while: a story being read → 阅读, a tour → 导览,
// playback → 一览. The preview draws the panels on a 56×40 map.
const LAYOUTS = [
  { id: "glance", name: "Glance", name_zh: "一览", svg: '<rect x="3" y="3" width="15" height="5" rx="1"/><rect x="38" y="3" width="15" height="5" rx="1"/><rect x="3" y="34" width="50" height="3" rx="1"/>' },
  { id: "classic", name: "Classic", name_zh: "经典", svg: '<rect x="3" y="3" width="16" height="12" rx="1"/><rect x="38" y="3" width="15" height="24" rx="1"/><rect x="3" y="31" width="50" height="6" rx="1"/>' },
  { id: "reader", name: "Reader", name_zh: "阅读", svg: '<rect x="3" y="3" width="12" height="7" rx="1"/><rect x="33" y="0" width="23" height="40"/><rect x="3" y="33" width="27" height="4" rx="1"/>' },
  { id: "cinema", name: "Cinema", name_zh: "导览", svg: '<rect x="14" y="27" width="28" height="7" rx="1"/><rect x="3" y="36" width="50" height="2" rx="1"/>' },
  { id: "explorer", name: "Explorer", name_zh: "研究", svg: '<rect x="0" y="0" width="13" height="40"/><rect x="43" y="0" width="13" height="40"/><rect x="13" y="35" width="30" height="5"/>' },
];
const PIN_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 1.5h4l-.5 4 2.5 2.5v1.5H8.7L8 15l-.7-5.5H4V8l2.5-2.5z"/></svg>';
const layoutOk = (id) => LAYOUTS.some((l) => l.id === id);
function layoutNow() {
  if (state.immersive) return state.layoutShown || state.layout;
  if (state.autoLayout) {
    if (state.reading) return "reader";
    if (state.tour) return "cinema";
    if (state.playing) return "glance";
  }
  return state.layout;
}
function applyLayout() {
  const L = layoutNow(), root = document.documentElement;
  if (L === state.layoutShown) return;
  // 一览 folds the ledger to its tabs (it can still be opened); leaving it unfolds a ledger it folded.
  if (L === "glance") { state.glanceFolded = !$("ledger").classList.contains("collapsed"); if (state.glanceFolded) foldLedger(true); }
  else if (state.layoutShown === "glance" && state.glanceFolded) { state.glanceFolded = false; foldLedger(false); }
  // Docked panels (阅读's side panel; both 研究 panels) fold with their pins, not by minimising; one that was
  // minimised before opens again so the dock is never an empty column.
  if (L === "reader" || L === "explorer") {
    if ($("ledger").classList.contains("collapsed")) foldLedger(false);
    if (L === "explorer" && state.eraMin) setEraMin(false, true);
  }
  state.layoutShown = L;
  if (L === "classic") root.removeAttribute("data-layout"); else root.dataset.layout = L;
  root.classList.remove("l-peek", "r-peek");
  if (!$("settings").hidden) renderSettings();
  if (typeof sizeRailVars === "function" && state.ready) requestAnimationFrame(sizeRailVars);
  renderEdgeTabs();
}
function foldLedger(c) {
  $("ledger").classList.toggle("collapsed", c);
  $("ledger-toggle").textContent = c ? t("show") : t("hide");
  $("ledger-toggle").setAttribute("aria-expanded", String(!c));
  setMinButton($("ledger-min"), c);
}
function setLayout(id, remember = true) {
  state.layout = layoutOk(id) ? id : "classic";
  if (remember) try { localStorage.setItem("atlas-layout", state.layout); } catch {}
  applyLayout();
  renderLayoutChips();
}
function setAutoLayout(on, remember = true) {
  state.autoLayout = on;
  if (remember) try { localStorage.setItem("atlas-autolayout", on ? "1" : "0"); } catch {}
  applyLayout();
}
// Pins (研究 both panels, 阅读 the side panel): l = era panel, r = side panel. Unpinned panels hide behind a tab on their edge.
function setPins(pins, remember = true) {
  state.pins = { ...state.pins, ...pins };
  const root = document.documentElement;
  root.classList.toggle("l-off", !state.pins.l);
  root.classList.toggle("r-off", !state.pins.r);
  root.classList.remove("l-peek", "r-peek");
  for (const [k, id] of [["l", "pin-l"], ["r", "pin-r"]]) {
    const b = $(id);
    b.setAttribute("aria-pressed", String(state.pins[k]));
    b.title = t(state.pins[k] ? "unpin" : "pin");
    b.setAttribute("aria-label", b.title);
  }
  if (remember) try { localStorage.setItem("atlas-pins", JSON.stringify(state.pins)); } catch {}
  renderEdgeTabs();
}
function renderEdgeTabs() {
  const l = $("edge-l"), r = $("edge-r");
  if (r) r.innerHTML = esc(t(state.tab === "people" ? "people_l" : state.tab));
  if (!l || !state.era) return;
  l.innerHTML = `<span class="sl">${esc((state.era.glyph || "").slice(0, 1))}</span>${esc(zh() ? state.era.name_zh || state.era.glyph : bandName(state.era))}<small>${esc(fmtYear(state.year))}</small>`;
}
const layoutIcon = (id) => `<svg viewBox="-2 -2 60 44" aria-hidden="true"><rect x="-1" y="-1" width="58" height="42" rx="5" fill="none" stroke="currentColor" stroke-width="3"/><g fill="currentColor">${LAYOUTS.find((l) => l.id === id).svg}</g></svg>`;
function renderLayoutChips() {
  const b = $("layout-open");
  if (!b) return;
  const id = layoutOk(state.layout) ? state.layout : "classic", L = LAYOUTS.find((l) => l.id === id), name = (l) => zh() ? l.name_zh : l.name;
  b.innerHTML = layoutIcon(id);
  b.title = `${t("stLayout")}: ${name(L)}`;
  b.setAttribute("aria-label", b.title);
  $("cine-layout").innerHTML = layoutIcon("cinema");
  $("cine-layout").title = t("stLayout");
  $("cine-layout").setAttribute("aria-label", t("stLayout"));
  $("cine-settings").title = t("settings");
  $("cine-settings").setAttribute("aria-label", t("settings"));
}
function toggleLayoutPop(open, anchor) {
  const pop = $("layout-pop");
  if (!pop) return;
  open ??= pop.hidden;
  pop.hidden = !open;
  for (const id of ["layout-open", "cine-layout"]) $(id).setAttribute("aria-expanded", String(open && state.layoutAnchor?.id === id));
  if (!open) return;
  state.layoutAnchor = anchor = anchor || state.layoutAnchor || $("layout-open");
  anchor.setAttribute("aria-expanded", "true");
  pop.innerHTML = LAYOUTS.map((l) => `<button type="button" role="menuitemradio" aria-checked="${l.id === state.layout}" data-lay="${l.id}"><span><i class="lp-pic"><svg viewBox="0 0 56 40" aria-hidden="true">${l.svg}</svg></i><b>${esc(zh() ? l.name_zh : l.name)}</b></span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.3 2.2L9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>`).join("") +
    `<button type="button" class="lp-auto switch" aria-pressed="${state.autoLayout}"><i aria-hidden="true"></i><span>${esc(t("stAutoLayout"))}</span></button>`;
  const r = anchor.getBoundingClientRect(), h = pop.offsetHeight;
  pop.style.position = "fixed";
  pop.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
  pop.querySelector('[aria-checked="true"]')?.focus();
}
function initLayouts() {
  const edge = (side) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `edge-tab ${side}`;
    b.id = `edge-${side}`;
    b.addEventListener("click", (e) => { e.stopPropagation(); document.documentElement.classList.add(`${side}-peek`); });
    $("app").append(b);
  };
  edge("l"); edge("r");
  const pin = (id, where, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pin";
    b.id = id;
    b.innerHTML = PIN_ICON;
    b.addEventListener("click", (e) => { e.stopPropagation(); setPins({ [k]: !state.pins[k] }); });
    where.append(b);
  };
  // Quick layout switch: a chip before the gear showing the current layout, and in 导览 (no panels) two small icons
  // in the map's top-left corner for the layout menu and settings.
  const lb = document.createElement("button");
  lb.type = "button";
  lb.className = "chip search-open layout-open";
  lb.id = "layout-open";
  lb.setAttribute("aria-haspopup", "true");
  lb.setAttribute("aria-expanded", "false");
  lb.addEventListener("click", (e) => { e.stopPropagation(); toggleLayoutPop(undefined, lb); });
  $("settings-open").before(lb);
  const cine = document.createElement("div");
  cine.className = "cine-tools";
  cine.innerHTML = `<button type="button" id="cine-layout" aria-haspopup="true"></button><button type="button" id="cine-settings" aria-haspopup="dialog">${$("settings-open").innerHTML}</button>`;
  $("app").append(cine);
  $("cine-layout").addEventListener("click", (e) => { e.stopPropagation(); toggleLayoutPop(undefined, e.currentTarget); });
  $("cine-settings").addEventListener("click", (e) => { e.stopPropagation(); toggleLayoutPop(false); toggleSettings(); });
  const pop = document.createElement("div");
  pop.className = "lang-pop layout-pop";
  pop.id = "layout-pop";
  pop.setAttribute("role", "menu");
  pop.hidden = true;
  document.body.append(pop);
  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-lay]");
    if (b) { setLayout(b.dataset.lay); return toggleLayoutPop(false); }
    if (e.target.closest(".lp-auto")) { setAutoLayout(!state.autoLayout); toggleLayoutPop(true, state.layoutAnchor); }
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !e.target.closest("#layout-pop")) toggleLayoutPop(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { toggleLayoutPop(false); state.layoutAnchor?.focus(); } });
  pin("pin-l", document.querySelector(".era-corner"), "l");
  pin("pin-r", document.querySelector(".ledger-head"), "r");
  // A panel slid out from its tab folds away again when the map is touched.
  map.on("mousedown", () => document.documentElement.classList.remove("l-peek", "r-peek"));
  map.on("touchstart", () => document.documentElement.classList.remove("l-peek", "r-peek"));
  // Phone 研究: a bottom bar of the side panel's tabs plus the layers.
  const nav = document.createElement("nav");
  nav.className = "ex-nav";
  const ICONS = {
    tours: '<path d="M4 18l5-12 5 8 3-4 3 8z"/>', events: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    rulers: '<path d="M4 17l2-9 4 4 2-6 2 6 4-4 2 9z"/><path d="M4 20h16"/>', people: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
    layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  };
  nav.innerHTML = ["tours", "events", "rulers", "people", "layers"].map((k) => `<button type="button" data-k="${k}" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span>${esc(t(k === "people" ? "people_l" : k === "layers" ? "exLayers" : k))}</span></button>`).join("");
  nav.addEventListener("click", (e) => {
    const k = e.target.closest("[data-k]")?.dataset.k;
    if (!k) return;
    if (k === "layers") return $("era-more").click();
    const open = state.tab === k && !$("ledger").classList.contains("collapsed");
    if (open) return $("ledger-toggle").click();
    $("tab-" + k).click();
  });
  $("app").append(nav);
  try {
    state.layout = localStorage.getItem("atlas-layout");
    state.autoLayout = localStorage.getItem("atlas-autolayout") !== "0";
    state.pins = JSON.parse(localStorage.getItem("atlas-pins") || "null");
  } catch {}
  if (!layoutOk(state.layout)) state.layout = "classic";
  state.autoLayout ??= true;
  if (!state.pins) state.pins = { l: true, r: true };
  setPins(state.pins, false);
  setAutoLayout(state.autoLayout, false);
  renderLayoutChips();
}
function renderExNav() {
  const open = !$("ledger").classList.contains("collapsed");
  document.querySelectorAll(".ex-nav [data-k]").forEach((b) => b.setAttribute("aria-pressed", String(open && b.dataset.k === state.tab)));
}

/* ---------- time dial: the timeline as a puck in the corner that opens into two rings ---------- */

// Outer ring: the periods of the timeline (one sector each, settles on a period's first year when let go). Inner ring:
// years, one turn = 100 years, faster turns go further. The ring turns with the finger: clockwise goes forward in time.
const DIAL_SKINS = [
  { id: "plain", name: "Plain", name_zh: "简洁", o: "#f3f5f4", c: "#1b2226", m: "#b93a26" },
  { id: "luopan", name: "Compass", name_zh: "罗盘", o: "#b07a2e", c: "#1a0f0b", m: "#c0281a" },
  { id: "sundial", name: "Sundial", name_zh: "日晷", o: "#d6ddcf", c: "#4f8a6c", m: "#33493a" },
  { id: "glass", name: "Glass", name_zh: "玻璃", o: "rgba(255,255,255,.35)", c: "rgba(10,14,18,.6)", m: "#7ff0d4" },
  { id: "watch", name: "Watch", name_zh: "表盘", o: "#0d0f11", c: "#25292d", m: "#ff8a1f" },
];
const SVGNS = "http://www.w3.org/2000/svg";
const dial = { el: null, eras: [], key: "", year: 0, open: false, closeT: 0, drag: null, sent: 0, lastIdx: -1 };
const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.append(e); return e; };
const dialStep = () => 360 / dial.eras.length;
const dialIdx = (y) => { for (let i = dial.eras.length - 1; i >= 0; i--) if (y >= dial.eras[i].start) return i; return 0; };
const dialPos = (y) => { const i = dialIdx(y), e = dial.eras[i]; return i + Math.min(1, Math.max(0, (y - e.start) / (e.end - e.start + 1))); };
const dialYearAt = (p) => { p = Math.max(0, Math.min(dial.eras.length - 1e-6, p)); const i = Math.floor(p), e = dial.eras[i]; return e.start + (p - i) * (e.end - e.start + 1); };
const dialLabel = (e) => (zh() ? e.glyph : (e.tiny || e.short || e.name || "").split("|")[0]);
function makeDial() {
  const el = document.createElement("div");
  el.className = "dial small";
  el.id = "dial";
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.innerHTML = `<svg viewBox="-130 -130 260 260" aria-hidden="true"><defs>
    <radialGradient id="g-bronze" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#e2b866"/><stop offset=".55" stop-color="#b07a2e"/><stop offset="1" stop-color="#6b4317"/></radialGradient>
    <radialGradient id="g-bronze2" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#c99a4a"/><stop offset="1" stop-color="#7a501f"/></radialGradient>
    <radialGradient id="g-stone" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#eef2e6"/><stop offset=".7" stop-color="#c9d3c0"/><stop offset="1" stop-color="#a9b6a2"/></radialGradient>
    <radialGradient id="g-jade" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#8fbfa6"/><stop offset="1" stop-color="#3f7a5f"/></radialGradient>
    <linearGradient id="g-shadow" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1d2a22" stop-opacity=".05"/><stop offset="1" stop-color="#1d2a22" stop-opacity=".45"/></linearGradient>
    <radialGradient id="g-steel" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#3a3f44"/><stop offset="1" stop-color="#0d0f11"/></radialGradient></defs>
    <circle r="128" class="d-outer"/><circle r="95" class="d-inner"/><circle r="60" class="d-core"/><g class="deco-under"></g>
    <g class="g-periods"></g><g class="g-ticks"></g>
    <path d="M0 -129 L-6 -138 L6 -138 Z" class="d-notch"/><line x1="0" y1="-95" x2="0" y2="-62" class="d-hair"/><g class="deco-over"></g>
    <text y="-18" class="c-glyph"></text><text y="14" class="c-year"></text><text y="36" class="c-sub"></text></svg>`;
  $("app").append(el);
  const ticks = el.querySelector(".g-ticks");
  for (let k = 0; k < 100; k++) {
    const a = (k * 3.6 * Math.PI) / 180, maj = k % 10 === 0, r0 = maj ? 76 : 86;
    svgEl("line", { x1: r0 * Math.sin(a), y1: -r0 * Math.cos(a), x2: 93 * Math.sin(a), y2: -93 * Math.cos(a), class: maj ? "t-maj" : "t-min" }, ticks);
  }
  el.addEventListener("pointerdown", dialDown);
  el.addEventListener("pointermove", dialMove);
  el.addEventListener("pointerup", dialUp);
  el.addEventListener("pointercancel", dialUp);
  el.addEventListener("focus", () => setDialOpen(true));
  // With a mouse the open dial stays open while the pointer is over it, so periods can be clicked one after another.
  el.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { dial.hover = true; clearTimeout(dial.closeT); } });
  el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { dial.hover = false; scheduleDialClose(); } });
  el.addEventListener("blur", () => scheduleDialClose());
  dial.el = el;
  setDialSkin(state.dialSkin, false);
}
// The period ring is redrawn when the timeline's periods change (another region, a selected country).
function buildDial() {
  if (!dial.el) return;
  const eras = state.eras.filter((e) => e.end >= e.start);
  const key = eras.map((e) => e.id).join("|") + state.lang;
  if (key === dial.key) return drawDial();
  dial.key = key;
  dial.eras = eras;
  const g = dial.el.querySelector(".g-periods"), step = dialStep();
  g.innerHTML = "";
  eras.forEach((e, i) => {
    const a = (-i * step * Math.PI) / 180, b = ((-i + 0.5) * step * Math.PI) / 180, x = 112 * Math.sin(a), y = -112 * Math.cos(a);
    svgEl("line", { x1: 97 * Math.sin(b), y1: -97 * Math.cos(b), x2: 127 * Math.sin(b), y2: -127 * Math.cos(b), class: "p-sep" }, g);
    svgEl("text", { x, y, class: "p-lab", transform: `rotate(${-i * step} ${x} ${y})` }, g).textContent = dialLabel(e);
  });
  drawDial();
}
// give: degrees the ring is pushed past either end (it moves a third as far, like a rubber band).
function drawDial(y = state.year, give = 0) {
  if (!dial.el || !dial.eras.length) return;
  dial.year = y;
  const yr = Math.round(y), i = dialIdx(yr), e = dial.eras[i], step = dialStep();
  // The current period's name sits centred under the pointer; only while the period ring itself is turned does it
  // slide continuously (a period is centred halfway through, so letting go at its start keeps it centred).
  dial.rot = dial.drag?.gear === "era" && dial.drag.moved >= 3 ? (dialPos(y) - 0.5) * step : i * step;
  dial.el.querySelector(".g-periods").setAttribute("transform", `rotate(${dial.rot + give / 3})`);
  dial.el.querySelector(".g-ticks").setAttribute("transform", `rotate(${y * 3.6 + give / 3})`);
  dial.el.querySelectorAll(".p-lab").forEach((t, k) => t.classList.toggle("on", k === i));
  const [num] = fmtYearParts(yr);
  dial.el.querySelector(".c-glyph").textContent = e.glyph;
  dial.el.querySelector(".c-year").textContent = num;
  dial.el.querySelector(".c-sub").textContent = t(state.playing ? "dialTapStop" : "dialTap");
  dial.el.setAttribute("aria-label", t("dialLabel"));
  dial.el.setAttribute("aria-valuemin", dial.eras[0].start);
  dial.el.setAttribute("aria-valuemax", dial.eras.at(-1).end);
  dial.el.setAttribute("aria-valuenow", yr);
  dial.el.setAttribute("aria-valuetext", `${nameOf(e)} ${fmtYear(yr)}`);
  if (dial.drag && dial.lastIdx !== -1 && i !== dial.lastIdx) try { navigator.vibrate?.(8); } catch {}
  dial.lastIdx = i;
}
function setDialOpen(on) {
  dial.open = on;
  dial.el.style.setProperty("--s", on ? 1 : 0.34);
  dial.el.classList.toggle("small", !on);
}
function scheduleDialClose() {
  clearTimeout(dial.closeT);
  if (!state.playing && !dial.drag && !dial.hover) dial.closeT = setTimeout(() => { if (document.activeElement !== dial.el || !state.playing) setDialOpen(false); }, 2200);
}
// While turning, the dial shows each year at once; the map follows a few times a second (on touch screens only when
// let go, as with the timeline's slider).
const dialCoarse = matchMedia("(pointer: coarse)");
function dialTo(y) {
  const a = dial.eras[0].start, b = dial.eras.at(-1).end;
  y = Math.max(Math.max(a, state.range.start), Math.min(Math.min(b, state.range.end), y));
  drawDial(y);
  const now = performance.now();
  if (!dialCoarse.matches && now - dial.sent > 160 && Math.round(y) !== state.year) { dial.sent = now; setYear(Math.round(y)); }
}
function dialCentre() { const r = dial.el.getBoundingClientRect(); return { x: r.right - 130, y: r.bottom - 130 }; }
function dialDown(ev) {
  const wasOpen = dial.open;
  clearTimeout(dial.closeT);
  setDialOpen(true);
  try { dial.el.setPointerCapture(ev.pointerId); } catch {}
  const c = dialCentre(), d = Math.hypot(ev.clientX - c.x, ev.clientY - c.y);
  const a = Math.atan2(ev.clientX - c.x, c.y - ev.clientY);
  dial.drag = { c, gear: !wasOpen ? "year" : d < 60 ? "core" : d < 95 ? "year" : "era", a, a0: a, t: performance.now(), moved: 0, over: 0, pos: dialIdx(state.year) + 0.5 };
  if (dial.drag.gear !== "core" && state.playing) stop();
}
function dialMove(ev) {
  const dr = dial.drag;
  if (!dr) return;
  const a = Math.atan2(ev.clientX - dr.c.x, dr.c.y - ev.clientY);
  let da = ((a - dr.a) * 180) / Math.PI;
  if (da > 180) da -= 360;
  if (da < -180) da += 360;
  // (Touch events can arrive in bursts; a floor on the gap keeps a burst from reading as a flick.)
  const now = performance.now(), speed = (Math.abs(da) / Math.max(16, now - dr.t)) * 1000;
  dr.a = a; dr.t = now; dr.moved += Math.abs(da);
  if (dr.moved < 3) return;
  if (dr.gear === "era") {
    const end = dial.eras.length - 1e-6, w = dialEdge(dr, da, dr.pos <= 0, dr.pos >= end);
    if (w === "held") return;
    dr.pos = w > 0 ? 0 : w < 0 ? end : Math.max(0, Math.min(end, dr.pos + da / dialStep()));
    dialTo(dialYearAt(dr.pos));
  } else if (dr.gear !== "core" || dr.moved > 12) {
    if (dr.gear === "core") { dr.gear = "year"; if (state.playing) stop(); }
    const [lo, hi] = dialEnds(), w = dialEdge(dr, da, dial.year <= lo + 0.01, dial.year >= hi - 0.01);
    if (w === "held") return;
    dialTo(w > 0 ? lo : w < 0 ? hi : dial.year + (da / 3.6) * (1 + Math.max(0, speed - 250) / 120));
  }
}
const dialEnds = () => [Math.max(dial.eras[0].start, state.range.start), Math.min(dial.eras.at(-1).end, state.range.end)];
// Past either end the dial resists: the ring only gives a little, and turned on through 45° it wraps round to
// the other end. Returns "held" while resisting, 1 to wrap from the end to the start, -1 the other way, else 0.
const DIAL_WRAP = 45;
function dialEdge(dr, da, atStart, atEnd) {
  if (dr.over > 0 || (atEnd && da > 0)) dr.over = Math.max(0, dr.over + da);
  else if (dr.over < 0 || (atStart && da < 0)) dr.over = Math.min(0, dr.over + da);
  else return 0;
  if (Math.abs(dr.over) < DIAL_WRAP) { drawDial(dial.year, dr.over); return "held"; }
  const w = Math.sign(dr.over);
  dr.over = 0;
  try { navigator.vibrate?.(15); } catch {}
  return w;
}
function dialUp() {
  const dr = dial.drag;
  if (!dr) return;
  dial.drag = null;
  if (dr.moved < 3 && dr.gear === "core") { play(); drawDial(); }
  // A click (or tap) on a period in the outer ring goes to its start.
  else if (dr.moved < 3 && dr.gear === "era") {
    const n = dial.eras.length, step = dialStep();
    const i = ((Math.round((dial.rot - (dr.a0 * 180) / Math.PI) / step) % n) + n) % n;
    setYear(Math.max(state.range.start, Math.min(state.range.end, dial.eras[i].start)));
  }
  else if (dr.gear === "era" && dr.moved >= 3) setYear(dial.eras[Math.min(dial.eras.length - 1, Math.floor(dr.pos))].start);
  else if (dr.moved >= 3) setYear(Math.round(dial.year));
  if (dr.over) drawDial();
  scheduleDialClose();
}
function setDialSkin(id, remember = true) {
  if (!DIAL_SKINS.some((d) => d.id === id)) id = "luopan";
  state.dialSkin = id;
  if (remember) try { localStorage.setItem("atlas-dial-skin", id); } catch {}
  if (!dial.el) return;
  dial.el.dataset.skin = id;
  const under = dial.el.querySelector(".deco-under"), over = dial.el.querySelector(".deco-over");
  under.innerHTML = over.innerHTML = "";
  if (id === "luopan") {
    for (const r of [124, 99, 91, 66]) svgEl("circle", { r, class: "lp-ring" }, under);
    for (let k = 0; k < 24; k++) { const a = (k * 15 * Math.PI) / 180; svgEl("circle", { cx: 63.5 * Math.sin(a), cy: -63.5 * Math.cos(a), r: 1.3, class: "lp-dot" }, under); }
    svgEl("path", { d: "M0 -127 L6 -136 L0 -146 L-6 -136 Z", fill: "#c0281a", stroke: "#3b2508", "stroke-width": ".8" }, over);
    svgEl("path", { d: "M0 -95 L4 -78 L0 -62 L-4 -78 Z", fill: "#c0281a" }, over);
  } else if (id === "sundial") {
    svgEl("path", { d: "M0 -60 L-26 -128 A128 128 0 0 1 26 -128 Z", class: "sd-shadow" }, under);
    svgEl("path", { d: "M-3 -60 L0 -95 L3 -60 Z", class: "sd-gnomon" }, over);
  } else if (id === "watch") {
    for (let k = 0; k < 120; k++) { const a = (k * 3 * Math.PI) / 180; svgEl("line", { x1: 128 * Math.sin(a), y1: -128 * Math.cos(a), x2: 131 * Math.sin(a), y2: -131 * Math.cos(a), class: "wt-knurl" }, under); }
    svgEl("circle", { cx: 0, cy: -137, r: 5, class: "wt-lume" }, over);
  }
}
// The dial takes the timeline's place (its speed lives in settings); the bar comes back as it was, full or slim.
function setDial(on, remember) {
  state.dial = on;
  if (on && !dial.el) makeDial();
  $("app").classList.toggle("dial-mode", on);
  if (dial.el) dial.el.hidden = !on;
  if (on) { buildDial(); setDialOpen(false); }
  if (remember) try { localStorage.setItem("atlas-dial", on ? "1" : "0"); } catch {}
  sizeRailVars();
}
const dialPreview = (d) => `<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="19" fill="${d.o}" stroke="rgba(0,0,0,.25)"/><circle r="12.5" fill="none" stroke="rgba(0,0,0,.15)"/><circle r="8" fill="${d.c}"/><path d="M0 -19 L-2.5 -23 L2.5 -23Z" fill="${d.m}"/><line y1="-12" y2="-8" stroke="${d.m}" stroke-width="1.5"/></svg>`;

/* ---------- settings: one panel for how Atlas looks and behaves (the 图层 panel keeps the layers) ---------- */

const seg = (items, cur) => items.map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(label)}</button>`).join("");
// Fills the parts that are drawn from state; the switches and chips moved here keep their own handlers.
function renderSettings() {
  $("st-ver").textContent = `Atlas v${APP_VERSION}`;
  $("st-styles").innerHTML = UI_STYLES.map((u) => `<button type="button" data-v="${u.id}" aria-pressed="${u.id === state.ui}"><i style="${u.preview}"><b></b></i>${esc(zh() ? u.name_zh : u.name)}</button>`).join("");
  $("st-laybtn").innerHTML = seg(LAY_BTNS.map((k) => [k, t("layBtns")[k]]), state.layBtn);
  $("st-laypos").innerHTML = seg(LAY_POS.map((k) => [k, t("layPos")[k]]), state.layPos);
  $("st-rail").innerHTML = seg([["full", t("stFull")], ["slim", t("stSlim")], ["dial", t("stDial")]], state.dial ? "dial" : state.railSlim ? "slim" : "full");
  $("st-dials").hidden = !state.dial;
  $("st-dials").innerHTML = DIAL_SKINS.map((d) => `<button type="button" data-v="${d.id}" aria-pressed="${d.id === state.dialSkin}">${dialPreview(d)}${esc(zh() ? d.name_zh : d.name)}</button>`).join("");
  $("st-speed").innerHTML = seg(SPEEDS.map((v) => [v, speedText(v)]), state.speed);
  $("st-narr").innerHTML = seg([["off", t("stOff")], ...Object.entries(t("voices"))], state.narration ? state.voice : "off");
  $("st-lang").innerHTML = seg(LANGS.map((l) => [l.id, l.name]), state.lang);
  $("st-wstrip").setAttribute("aria-pressed", String(!stripOff()));
}
// Beside the era panel on wide screens (over it when there is no room), a bottom sheet on phones (CSS).
function toggleSettings(open) {
  const box = $("settings"), btn = $("settings-open");
  open ??= box.hidden;
  if (open === !box.hidden) return;
  box.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("settings-open", open);
  if (!open) { toggleLookPop(false); togglePanelPop(false); return; }
  toggleRegionPop(false);
  renderSettings();
  renderPanelChip();
  // Beside the era panel; in 导览, where it is hidden, under the small settings icon on the map.
  let r = document.querySelector(".era").getBoundingClientRect();
  if (!r.width) { const c = $("cine-settings").parentNode.getBoundingClientRect(); r = { left: c.left, right: c.left - 12, top: c.bottom + 8 }; }
  const room = innerWidth - r.right - 12 >= box.offsetWidth + 16;
  box.style.left = `${room ? r.right + 12 : r.left}px`;
  box.style.top = `${r.top}px`;
  box.focus({ preventScroll: true });
}
function resetSettings() {
  setLayout("classic");
  setAutoLayout(true);
  setPins({ l: true, r: true });
  setUIStyle("classic");
  setPanel({ color: "auto", op: null });
  state.flat3d = false;
  setLook(lookOrder()[0]);
  if (!state.show3d) $("t-3d").click();
  if (!state.showAI) $("t-ai").click();
  setRailSlim(false, true);
  setDial(false, true);
  setDialSkin("luopan");
  setLayButtons({ btn: "icon", pos: "group" }, false);
  try { localStorage.removeItem("atlas-laybtn"); localStorage.removeItem("atlas-laypos"); } catch {}
  setSpeed(1, true);
  setMusic(false);
  setNarration(false);
  try { localStorage.removeItem("atlas-wstrip"); } catch {}
  renderWorldStrip();
  renderSettings();
}
function initSettings() {
  $("settings-open").addEventListener("click", (e) => { e.stopPropagation(); toggleSettings(); });
  $("settings-close").addEventListener("click", () => toggleSettings(false));
  $("st-reset").addEventListener("click", resetSettings);
  const on = (id, fn) => $(id).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { fn(b.dataset.v); renderSettings(); } });
  on("st-styles", (v) => setUIStyle(v));
  on("st-laybtn", (v) => setLayButtons({ btn: v }));
  on("st-laypos", (v) => setLayButtons({ pos: v }));
  on("st-rail", (v) => { setDial(v === "dial", true); if (v !== "dial") setRailSlim(v === "slim", true); });
  on("st-dials", (v) => { setDialSkin(v); setDialOpen(true); scheduleDialClose(); });
  on("st-speed", (v) => setSpeed(+v, true));
  on("st-narr", (v) => { if (v === "off") return setNarration(false); state.voice = v; setNarration(true); });
  on("st-lang", (v) => { if (v !== state.lang) setLang(v); });
  $("st-wstrip").addEventListener("click", () => {
    try { if (stripOff()) localStorage.removeItem("atlas-wstrip"); else localStorage.setItem("atlas-wstrip", "0"); } catch {}
    renderWorldStrip();
    renderSettings();
  });
  // A click outside closes it, except in the colour and style menus it opens.
  document.addEventListener("click", (e) => {
    // (A segment button pressed here is redrawn before the click reaches the document, so it is no longer in the page.)
    if (!$("settings").hidden && e.target.isConnected && !e.target.closest("#settings, #look-pop, #panel-pop, #settings-open, #cine-settings")) toggleSettings(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || $("settings").hidden || !$("look-pop").hidden || !$("panel-pop").hidden) return;
    toggleSettings(false);
    $("settings-open").focus();
  });
  addEventListener("resize", () => toggleSettings(false));
}
// Minimised panels leave the map to itself: the era panel shrinks to its seal, name and year; the side panel to its
// tabs. The button turns into a restore button.
const MIN_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const MAX_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
function setMinButton(btn, min) {
  btn.innerHTML = min ? MAX_ICON : MIN_ICON;
  btn.setAttribute("aria-expanded", String(!min));
  btn.title = t(min ? "restore" : "minimise");
  btn.setAttribute("aria-label", btn.title);
}
function toggleSpeedPop(open) {
  const pop = $("speed-pop");
  open ??= pop.hidden;
  pop.hidden = !open;
  $("speed").setAttribute("aria-expanded", String(open));
  if (!open) return;
  pop.innerHTML = `<b>${esc(t("speed"))}</b>` + [...SPEEDS].reverse().map((v) =>
    `<button type="button" role="menuitemradio" data-speed="${v}" aria-checked="${v === state.speed}">${speedText(v)}</button>`).join("");
  pop.querySelector('[aria-checked="true"]')?.focus();
}
// The timeline folds down to its play button (and the button that brings it back).
// A drawer handle with a chevron, not the −/□ of the era panel: beside the timeline's zoom buttons a − read as zoom out.
const CHEVRON = (up) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${up ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function setRailButton(min) {
  const btn = $("rail-min");
  btn.innerHTML = CHEVRON(min);
  btn.setAttribute("aria-expanded", String(!min));
  btn.title = t(min ? "railShow" : "railHide");
  btn.setAttribute("aria-label", btn.title);
}
function setRailMin(on, remember) {
  state.railMin = on;
  document.querySelector(".rail").classList.toggle("min", on);
  $("app").classList.toggle("rail-folded", on);
  setRailButton(on);
  if (on) toggleSpeedPop(false);
  if (remember) try { localStorage.setItem("atlas-rail-min", on ? "1" : "0"); } catch {}
}
function setEraMin(on, remember) {
  state.eraMin = on;
  document.querySelector(".era").classList.toggle("min", on);
  setMinButton($("era-min"), on);
  if (on) { toggleRegionPop(false); toggleSettings(false); }
  if (remember) try { localStorage.setItem("atlas-era-min", on ? "1" : "0"); } catch {}
}
// Panels below the timeline's top edge use its size; with the dial a phone keeps a strip for the puck instead.
function sizeRailVars() {
  const rail = document.querySelector(".rail"), st = document.documentElement.style;
  st.setProperty("--rail-h", (state.dial ? 0 : rail.offsetHeight) + "px");
  st.setProperty("--rail-w", (state.dial ? 0 : rail.offsetWidth) + "px");
}
function stop() {
  clearInterval(state.playing);
  state.playing = null;
  if (state.layout) applyLayout();
  syncMusic();
  $("play-icon").innerHTML = '<path d="M4 2l10 6-10 6z"/>';
  $("play").setAttribute("aria-label", t("play"));
  if (state.dial) { drawDial(); scheduleDialClose(); }
}

function set3d(on, already = false) {
  if (!already) {
    state.show3d = on;
    $("t-3d").setAttribute("aria-pressed", String(on));
  }
  state.terrainExag = null;
  if (!map) return;
  if (on) setTerrainForZoom(); else map.setTerrain(null);
  map.easeTo({ pitch: on ? 52 : 0, duration: 800 });
}
function toggle(btnId, key, fn) {
  $(btnId).setAttribute("aria-pressed", String(state[key]));
  $(btnId).addEventListener("click", () => {
    state[key] = !state[key];
    $(btnId).setAttribute("aria-pressed", String(state[key]));
    try { localStorage.setItem("atlas-toggles", JSON.stringify({ show3d: state.show3d, showNeighbours: state.showNeighbours, showPlaces: state.showPlaces, showGeo: state.showGeo, showAI: state.showAI })); } catch {}
    fn();
  });
}

// Where the visitor was (year, timeline zoom, ledger tab, camera) is saved as they go and restored on the next visit.
let saveTimer = 0;
function saveView() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!map) return;
    const c = map.getCenter();
    const view = { year: state.year, zoom: state.zoom, win: state.win, tab: state.tab, country: state.sel ? [[...selNames(), ...state.sel.names][0], state.year] : null,
      cam: { center: [+c.lng.toFixed(3), +c.lat.toFixed(3)], zoom: +map.getZoom().toFixed(2), pitch: Math.round(map.getPitch()), bearing: Math.round(map.getBearing()) } };
    try { localStorage.setItem(viewKey(), JSON.stringify(view)); } catch {}
  }, 500);
}

// Each pack remembers its own view.
const viewKey = () => (state.pack ? `atlas-view:${state.pack.manifest.id}` : "atlas-view");
// A link to the current view: #y=year&c=lng,lat,zoom,pitch,bearing&t=tab&e=open event&l=en
function viewHash() {
  const c = map.getCenter();
  const q = new URLSearchParams();
  q.set("y", state.year);
  q.set("c", [c.lng.toFixed(2), c.lat.toFixed(2), map.getZoom().toFixed(1), Math.round(map.getPitch()), Math.round(map.getBearing())].join(","));
  if (state.tab !== "events") q.set("t", state.tab);
  if (state.reading && state.selected) q.set("e", state.selected);
  if (state.tour) { q.set("tour", state.tour.id); q.set("s", state.tour.i + 1); }
  if (state.lang !== "zh") q.set("l", state.lang);
  return q.toString();
}
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const y = parseInt(q.get("y"), 10);
  if (!q.has("y") || isNaN(y)) return q.get("tour") ? { tour: q.get("tour"), step: +q.get("s") || 1 } : null;
  const v = { year: y, tab: q.get("t") || "events", sel: q.get("e"), tour: q.get("tour"), step: +q.get("s") || 1, lang: q.get("l") };
  const c = (q.get("c") || "").split(",").map(Number);
  if (c.length === 5 && c.every((x) => !isNaN(x))) v.cam = { center: [c[0], c[1]], zoom: c[2], pitch: c[3], bearing: c[4] };
  return v;
}
async function shareView() {
  const url = location.href.split("#")[0] + "#" + viewHash();
  let ok = false;
  // Phones get the system share sheet.
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title: document.title, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); ok = true; } catch {}
  const box = $("share-box");
  box.hidden = false;
  box.querySelector("span").textContent = ok ? t("linkCopied") : t("linkCopy");
  const inp = box.querySelector("input");
  inp.value = url;
  if (!ok) { inp.focus(); inp.select(); }
  clearTimeout(shareView.timer);
  shareView.timer = setTimeout(() => (box.hidden = true), ok ? 2500 : 15000);
}
function loadView() {
  let v = null, tg = null;
  try { v = JSON.parse(localStorage.getItem(viewKey()) || "null"); tg = JSON.parse(localStorage.getItem("atlas-toggles") || "null"); } catch {}
  if (tg) for (const k of ["show3d", "showNeighbours", "showPlaces", "showGeo", "showAI"]) if (typeof tg[k] === "boolean") state[k] = tg[k];
  // A shared link wins over the remembered view. The address is then cleaned, so a bookmark or a Home Screen
  // icon made later opens the site as usual (the share button builds a link to the current view).
  const link = readHash();
  if (location.hash) try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  if (link?.tour) state.pendingTour = [link.tour, link.step - 1];
  if (link && typeof link.year === "number") {
    v = { ...link, zoom: 0 };
    if (link.sel && state.events.some((e) => e.id === link.sel)) { state.selected = link.sel; state.reading = true; state.fromLink = true; }
  }
  if (!v || typeof v.year !== "number") return null;
  state.year = Math.max(state.range.start, Math.min(state.range.end, Math.round(v.year)));
  if ([1, 2].includes(v.zoom) && Array.isArray(v.win) && v.win[0] <= state.year && state.year <= v.win[1]) { state.zoom = v.zoom; state.win = v.win; }
  if (TABS.includes(v.tab)) state.tab = v.tab;
  if (Array.isArray(v.country) && typeof v.country[0] === "string") state.pendingCountry = v.country;
  return v.cam && Array.isArray(v.cam.center) ? v.cam : null;
}

// The app's version is the cache-busting number index.html loads this script with (app.js?v=117).
const APP_VERSION = new URL(document.currentScript?.src || location.href).searchParams.get("v") || "dev";
// Installing: iPhone and iPad have no install prompt, so a card explains Share → Add to Home Screen. Other
// browsers that offer one (beforeinstallprompt) get an install button on the same card. Not in embeds, the
// preview, or when already running as the app; "don't show again" is remembered.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IPAD = IOS && !/iPhone|iPod/.test(navigator.userAgent);
const STANDALONE = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const CAN_INSTALL = !STANDALONE && !EMBED && location.protocol === "https:" && !/claude(usercontent)?\.(ai|com)$/.test(location.hostname);
let installPrompt = null;
let installReady = false;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; if (installReady) maybeInstallCard(); });
function maybeInstallCard(force) {
  if (!CAN_INSTALL || !(IOS || installPrompt)) return;
  if (!force) {
    try { if (localStorage.getItem("atlas-install") === "0" || sessionStorage.getItem("atlas-install-seen")) return; } catch {}
  }
  const card = $("install");
  if (!card || !card.hidden) return;
  const I = t("install");
  const share = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v8.5M5 4.5l3-3 3 3M4.5 7H3.5v7h9V7h-1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  card.innerHTML = `<img src="docs/img/app-180.png" alt="" width="40" height="40"><div><b>${esc(I.title)}</b><p>${esc(I.why)}</p>` +
    (IOS ? `<ol><li>${I.step1(IPAD, share, /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent))}</li><li>${esc(I.step2)}</li></ol>` : "") +
    `<div class="in-btns">${installPrompt ? `<button type="button" class="chip on" id="in-go">${esc(I.go)}</button>` : ""}` +
    `<button type="button" class="chip" id="in-ok">${esc(I.ok)}</button><button type="button" class="in-never" id="in-never">${esc(I.never)}</button></div></div>`;
  card.hidden = false;
  const close = () => { card.hidden = true; try { sessionStorage.setItem("atlas-install-seen", "1"); } catch {} };
  $("in-ok").onclick = close;
  $("in-never").onclick = () => { try { localStorage.setItem("atlas-install", "0"); } catch {} close(); };
  if ($("in-go")) $("in-go").onclick = async () => { close(); installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; };
}

// Home Screen app: a service worker keeps what has been viewed for offline use (not inside embeds or the preview).
if ("serviceWorker" in navigator && location.protocol === "https:" && !/[?&]embed=1/.test(location.search) && !location.hostname.endsWith("claude.ai") && !location.hostname.endsWith("claudeusercontent.com"))
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

async function init() {
  try { const l = localStorage.getItem("atlas-lang"); if (langOk(l)) state.lang = l; } catch {}
  try { const f = JSON.parse(localStorage.getItem("atlas-events") || "null"); if (f) { state.detail = f.detail || 2; state.cats = f.cats || []; } } catch {}
  try { state.look = lookId(localStorage.getItem("atlas-look")) || state.look; } catch {}
  const qs = lookId(new URLSearchParams(location.search).get("style"));
  if (qs) state.look = qs;
  const q = new URLSearchParams(location.search).get("lang");
  if (langOk(q)) state.lang = q;
  const hl = new URLSearchParams(location.hash.slice(1)).get("l");
  if (langOk(hl)) state.lang = hl;
  // A link pasted into the same tab only changes the hash: start again from it.
  addEventListener("hashchange", () => { if (map && location.hash.length > 1) location.reload(); });
  const formatOk = checkDataFormat();
  if (PACK_URL) {
    state.pack = await openPack(PACK_URL);
    state.selected = null;
    // A pack shown alone can bring its own base map (manifest `basemap`, see docs/custom-data.md#base-map).
    const B = state.pack.only && state.pack.manifest.basemap;
    if (B) {
      const abs = (p) => p && new URL(p, state.pack.url).href.replace(/%7B/g, "{").replace(/%7D/g, "}");
      state.basemap = { ...B, dem: B.dem && { ...B.dem, tiles: abs(B.dem.tiles) }, imagery: B.imagery && { ...B.imagery, tiles: abs(B.imagery.tiles) } };
      if (!looks()[state.look]) state.look = lookOrder()[0];
      if (!B.dem) state.show3d = false;
    }
  }
  applyLang();
  loadLives().then(() => { if (state.tab === "people") renderPeopleTab(); });
  const plugins = importPlugins();
  plugins.forEach((p) => p.catch(() => {}));  // reported once the map is up
  const pack = state.pack?.manifest, only = state.pack?.only;
  const [eras, events, places, packEras, packEvents] = await Promise.all([
    only ? { eras: [] } : loadJSON("data/eras.json"), only ? [] : loadJSON("data/events.json"), only ? [] : loadJSON("data/places.json"),
    pack && packFile("eras"), pack && packFile("events"), formatOk,
  ]);
  // The atlas's own overlays (population, faith, inventions, passes, roads, clans, walls, exchange) stay out of a pack shown alone.
  if (!only) {
    state.overlays = await loadJSON("data/overlays.json").catch(() => state.overlays);
    state.passes = await loadJSON("data/passes.json").catch(() => []);
    state.roads = await loadJSON("data/roads.json").catch(() => []);
    state.clans = await loadJSON("data/clans.json").catch(() => []);
    state.walls = await loadJSON("data/walls.json").catch(() => []);
    state.climate = await loadJSON("data/climate.json").catch(() => null);
    state.exchange = await loadJSON("data/exchange.json").catch(() => state.exchange);
  }
  const offEarth = state.basemap?.earth === false;
  // Off Earth, the landscape names come from the pack (basemap.labels, same shape as data/geo/features.json).
  state.geo = offEarth ? (state.basemap.labels ? await fetch(new URL(state.basemap.labels, state.pack.url)).then((r) => r.json()).catch(() => []) : [])
    : await loadJSON("data/geo/features.json").catch(() => []);
  state.oldGeo = offEarth ? [] : (await loadJSON("data/geo/old-rivers.geojson").catch(() => ({ features: [] }))).features;
  const [regions, worldIndex] = await Promise.all([
    loadJSON("data/regions.json").catch(() => ({ regions: [] })), offEarth ? [] : loadJSON("data/world/index.json").catch(() => [])]);
  if (!only) setupRegions(eras, regions.regions, worldIndex);
  state.groups = regions.groups || [];
  if (pack) {
    addPack(pack, packEras, worldIndex, only);
    for (const ev of packEvents) ev.region = pack.id;
    events.push(...packEvents);
    state.year = pack.region?.view?.year ?? packEras.eras[0]?.start ?? state.year;
  }
  if (only) {
    // The per-period layers (rulers, armies, people...) and the atlas's overlays are not part of a pack yet.
    for (const el of document.querySelectorAll(".era-layers .chip.layer, #tab-rulers, #tab-people")) el.hidden = true;
    if (!places.length) $("t-places").hidden = true;
    if (offEarth) { $("t-neighbours").hidden = true; if (!state.geo.length) $("t-geo").hidden = true; }
    if (state.basemap && !state.basemap.dem) $("t-3d").hidden = true;
    for (const g of document.querySelectorAll(".era-layers .lg")) g.hidden = ![...g.querySelectorAll(".chip")].some((c) => !c.hidden);
  }
  state.events = events.sort((a, b) => a.year - b.year || (a.level || 1) - (b.level || 1));
  state.places = places;
  if (!only) state.countries = await loadJSON("data/countries.json").catch(() => null);
  buildScale();
  const cam = loadView();
  if (state.basemap && !state.basemap.dem) state.show3d = false;
  if (looks()[state.look]?.flat && state.show3d) { state.show3d = false; state.flat3d = true; }
  if (only && !["events", "tours"].includes(state.tab)) state.tab = "events";

  const style = buildStyle();
  applyLook(null);
  map = new maplibregl.Map({
    container: "map",
    style,
    center: cam?.center || pack?.region?.view?.center || [108, 33.5], zoom: cam?.zoom ?? pack?.region?.view?.zoom ?? 3.7, pitch: state.show3d ? cam?.pitch ?? 52 : 0, bearing: cam?.bearing ?? -8,
    maxPitch: 65, minZoom: 1.6, maxZoom: 9.5,
    attributionControl: false,
  });
  // The flat styles' coast is already in the style; don't fetch it again when the look is applied on load.
  if (typeof style.sources.land.data === "string") map._landLoaded = true;
  // Full screen takes the whole app (panels included); browsers without the Fullscreen API (iPhone Safari) get none.
  if (document.fullscreenEnabled) {
    const fs = new maplibregl.FullscreenControl({ container: $("app") });
    map.addControl(fs, "bottom-left");
    fs._fullscreenButton?.setAttribute("title", t("fullscreen"));
  }
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true,
    customAttribution: `<b>Atlas v${esc(APP_VERSION)}</b> · data format ${FORMAT}` + (CAN_INSTALL && IOS ? ` · <a href="#" id="attr-install">${esc(t("install").title)}</a>` : "") + " · " + (offEarth ? "" : "Terrain: Mapzen/AWS Terrain Tiles · Borders: Cliopatria/Seshat (CC BY 4.0), historical-basemaps (GPL-3.0)") + (state.basemap?.attribution ? ` · ${esc(state.basemap.attribution)}` : "") + (pack?.attribution ? ` · ${esc(pack.attribution)}` : "") }), "bottom-left");
  // MapLibre opens the compact attribution on wide screens; start it folded to the "i" button.
  const foldAttribution = () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  map.once("load", foldAttribution);
  map.once("idle", foldAttribution);
  document.addEventListener("click", (e) => { if (e.target.id === "attr-install") { e.preventDefault(); maybeInstallCard(true); } });
  // The install card waits until the map has been on screen a little while.
  setTimeout(() => { installReady = true; maybeInstallCard(); }, 8000);
  map.on("move", () => scheduleDeclutter(120));
  map.on("click", "road-hit", (e) => {
    const r = state.roads.find((x) => x.id === e.features[0]?.properties.id);
    if (r) showCard(e.lngLat, roadCard(r));
  });
  map.on("click", "wall-hit", (e) => {
    const w = state.walls.find((x) => x.id === e.features[0]?.properties.id);
    if (w) showCard(e.lngLat, wallCard(w));
  });
  map.on("mouseenter", "wall-hit", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "wall-hit", () => (map.getCanvas().style.cursor = ""));
  map.on("click", "admin-dot", (e) => {
    const x = state.admin?.items[e.features[0]?.properties.i];
    if (x) openAdmin(x);
  });
  map.on("mouseenter", "admin-dot", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "admin-dot", () => (map.getCanvas().style.cursor = ""));
  map.on("mouseenter", "road-hit", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "road-hit", () => (map.getCanvas().style.cursor = ""));
  // The timeline follows the region in view, except while a country is selected: then it stays on that country's
  // region (its periods and events) until the selection is cleared, and the card offers the way back to it.
  map.on("moveend", () => { if (state.adminShown?.length) renderAdminLabels(); scheduleDeclutter(); saveView(); if (!state.tour && state.ready) setMode(state.sel ? selRegion() : detectRegion()); renderSelCard(); });
  map.on("zoomend", setTerrainForZoom);
  map.on("load", async () => {
    setTerrainForZoom();
    applyLook();
    renderGeo();
    // Switches remembered from the last visit that the style starts with on.
    if (!state.showNeighbours) for (const id of ["neighbour-fill", "neighbour-line"]) map.setLayoutProperty(id, "visibility", "none");
    if (!state.showGeo) for (const id of ["rivers", "rivers-minor", "lakes", "lakes-line"]) map.setLayoutProperty(id, "visibility", "none");
    addTourLayers();
    if (state.pack) await startPlugins(plugins);
    setMode(detectRegion(), true);
    renderRegionBtn();
    state.ready = true;
    await setYear(state.year);
    if (state.pendingCountry && state.countries) selectCountry(state.pendingCountry[0], { year: state.pendingCountry[1] });
    buildRail();
    renderLedger();
    if (state.pendingTour) startTour(...state.pendingTour);
    const ev = state.events.find((e) => e.id === state.selected);
    if (ev && !state.fromLink) map.easeTo({ center: [ev.lon - 4, ev.lat - 3], duration: 0 });
  });

  // Dragging the rail (slider, era bands or ticks) shows a tag with the period and year under the finger.
  // On touch screens the map moves when the finger lifts; with a mouse the slider still updates live.
  const coarse = matchMedia("(pointer: coarse)").matches;
  $("slider").addEventListener("input", (e) => {
    stop();
    const y = posToYear(+e.target.value);
    showScrubTag(+e.target.value, y);
    if (!coarse && y !== state.year) setYear(y, { fromSlider: true });
  });
  $("slider").addEventListener("change", (e) => {
    const y = posToYear(+e.target.value);
    if (state.railSlim) flashScrubTag(+e.target.value, y); else hideScrubTag();
    if (y !== state.year) setYear(y, { fromSlider: true });
  });
  const track = document.querySelector(".track"), view = $("track-view");
  let scrub = null;
  const posAt = (x) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(SLIDER_MAX - 1e-6, ((x - r.left) / r.width) * SLIDER_MAX)); };
  // The thumb follows the finger (setting value fires no input event); the map waits for the drop.
  const scrubTo = (x) => { const p = posAt(x); scrub.year = posToYear(p); $("slider").value = p; showScrubTag(p, scrub.year); };
  // Near either edge of a paged track the view scrolls on its own, faster the closer the finger is to the edge.
  const edgeScroll = () => {
    if (!scrub || !scrub.moved) return;
    const r = view.getBoundingClientRect(), zone = 36;
    const v = scrub.lastX < r.left + zone ? -(r.left + zone - scrub.lastX) : scrub.lastX > r.right - zone ? scrub.lastX - (r.right - zone) : 0;
    if (v && view.scrollWidth > view.clientWidth) { view.scrollLeft += v * 0.5; scrubTo(scrub.lastX); }
    scrub.raf = requestAnimationFrame(edgeScroll);
  };
  track.addEventListener("pointerdown", (e) => {
    // With a mouse on the whole-width rail the native slider handles its own drags.
    if (e.target === $("slider") && !pagedRail()) return;
    scrub = { x: e.clientX, lastX: e.clientX, id: e.pointerId, moved: false, onButton: !!e.target.closest(".band, .tick") };
  });
  addEventListener("pointermove", (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    scrub.lastX = e.clientX;
    if (!scrub.moved && Math.abs(e.clientX - scrub.x) < 6) return;
    if (!scrub.moved) { scrub.moved = true; stop(); try { track.setPointerCapture(e.pointerId); } catch {} scrub.raf = requestAnimationFrame(edgeScroll); }
    scrubTo(e.clientX);
  });
  addEventListener("pointerup", (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const s = scrub; scrub = null;
    cancelAnimationFrame(s.raf);
    if (!s.moved) {
      // A tap on the slider line jumps there; a tap on a band or tick keeps its own click.
      if (!s.onButton) {
        const p = posAt(e.clientX);
        setYear(posToYear(p));
        if (state.railSlim) flashScrubTag(p, posToYear(p));
      }
      return;
    }
    hideScrubTag();
    // Swallow the click that follows the drag, so the band under the finger doesn't also fire.
    addEventListener("click", (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true });
    setTimeout(() => setYear(s.year), 0);
  });
  // With a mouse, the slim timeline names the period under the pointer.
  track.addEventListener("pointermove", (e) => {
    if (scrub || coarse || e.pointerType !== "mouse" || !state.railSlim || e.buttons) return;
    const p = posAt(e.clientX);
    showScrubTag(p, posToYear(p));
  });
  track.addEventListener("pointerleave", () => { if (!scrub && state.railSlim && !coarse) hideScrubTag(); });
  addEventListener("pointercancel", () => {
    if (scrub) cancelAnimationFrame(scrub.raf);
    scrub = null; hideScrubTag();
    $("slider").value = yearToPos(state.year);
  });
  $("play").addEventListener("click", play);
  $("zoom-in").addEventListener("click", () => setZoom(state.zoom + 1));
  $("zoom-out").addEventListener("click", () => setZoom(state.zoom - 1));
  $("pan-prev").addEventListener("click", () => pan(-1));
  $("pan-next").addEventListener("click", () => pan(1));
  // Scrolling over the rail zooms it, around the year under the pointer when zooming in.
  let wheelAt = 0;
  document.querySelector(".track").addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    if (Date.now() - wheelAt < 350) return;
    wheelAt = Date.now();
    const r = e.currentTarget.getBoundingClientRect();
    const y = posToYear(((e.clientX - r.left) / r.width) * SLIDER_MAX);
    setZoom(state.zoom + (e.deltaY < 0 ? 1 : -1), e.deltaY < 0 ? y : state.year);
  }, { passive: false });
  $("world-strip").addEventListener("click", (e) => {
    if (e.target.closest(".ws-head")) { e.stopPropagation(); return toggleStripPop(); }
    if (e.target.closest(".ws-x")) {
      try { localStorage.setItem("atlas-wstrip", "0"); } catch {}
      return renderWorldStrip();
    }
    const id = e.target.closest("[data-ev]")?.dataset.ev;
    if (id) openStory(id);
  });
  $("ws-pop").addEventListener("click", (e) => {
    const sc = e.target.closest("[data-scope]")?.dataset.scope;
    toggleStripPop(false);
    if (!sc) return;
    wsScope = sc;
    try { localStorage.setItem("atlas-wscope", sc); } catch {}
    renderWorldStrip();
  });
  document.addEventListener("click", (e) => { if (!$("ws-pop").hidden && !e.target.closest("#ws-pop")) toggleStripPop(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("ws-pop").hidden) toggleStripPop(false); });
  initSettings();
  initLayouts();
  toggle("t-3d", "show3d", () => { state.flat3d = false; set3d(state.show3d, true); });
  initLayerTips();
  const savedLay = {};
  try { savedLay.btn = localStorage.getItem("atlas-laybtn"); savedLay.pos = localStorage.getItem("atlas-laypos"); } catch {}
  setLayButtons(savedLay, false);
  renderLookChips();
  renderPanelChip();
  $("look-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleLookPop(); });
  $("look-pop").addEventListener("click", (e) => { const b = e.target.closest("[data-look]"); toggleLookPop(false); if (b) setLook(b.dataset.look); });
  document.addEventListener("click", (e) => { if (!$("look-pop").hidden && !e.target.closest("#look-pop")) toggleLookPop(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("look-pop").hidden) { toggleLookPop(false); $("look-btn").focus(); } });
  addEventListener("resize", () => toggleLookPop(false));
  $("panel-btn").addEventListener("click", (e) => { e.stopPropagation(); togglePanelPop(); });
  $("panel-pop").addEventListener("click", (e) => {
    const b = e.target.closest("[data-panel]");
    if (b) { togglePanelPop(false); setPanel({ color: b.dataset.panel }); }
    else if (e.target.closest(".panel-custom") && e.target.tagName !== "INPUT") e.target.closest(".panel-custom").querySelector("input").click();
  });
  // The custom picker previews while dragging and is kept when it closes.
  $("panel-pop").addEventListener("input", (e) => {
    const c = hexOk(e.target.value);
    if (!c) return;
    state.panelColor = c;
    applyPanel();
    e.target.parentNode.querySelector("i").style.background = c;
  });
  $("panel-pop").addEventListener("change", (e) => { const c = hexOk(e.target.value); if (c) setPanel({ color: c }); });
  $("panel-op").addEventListener("input", (e) => { state.panelOp = +e.target.value / 100; applyPanel(); });
  $("panel-op").addEventListener("change", (e) => setPanel({ op: +e.target.value / 100 }));
  $("panel-op").addEventListener("dblclick", () => setPanel({ op: null }));
  document.addEventListener("click", (e) => { if (!$("panel-pop").hidden && !e.target.closest("#panel-pop")) togglePanelPop(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("panel-pop").hidden) { togglePanelPop(false); $("panel-btn").focus(); } });
  addEventListener("resize", () => togglePanelPop(false));
  toggle("t-neighbours", "showNeighbours", () => {
    const v = state.showNeighbours ? "visible" : "none";
    map.setLayoutProperty("neighbour-fill", "visibility", v);
    map.setLayoutProperty("neighbour-line", "visibility", v);
    renderPolityLabels(state.borders[state.snapshot]);
  });
  toggle("t-places", "showPlaces", renderPlaces);
  // AI-generated event pictures are loaded either way and only hidden, so switching back needs no reload.
  const syncAI = () => {
    document.body.classList.toggle("no-ai", !state.showAI);
    if (state.tour) placeTourPic();
    if (state.reading && state.selected) showEventPic(state.selected); else hideEventPic();
  };
  toggle("t-ai", "showAI", syncAI);
  syncAI();
  toggle("t-geo", "showGeo", () => {
    renderGeo();
    for (const id of ["rivers", "rivers-minor", "lakes", "lakes-line"]) map.setLayoutProperty(id, "visibility", state.showGeo ? "visible" : "none");
    renderOldGeo();
  });
  try { state.autoLayers = localStorage.getItem("atlas-auto") !== "off"; } catch {}
  $("t-auto").setAttribute("aria-pressed", String(state.autoLayers));
  $("t-auto").addEventListener("click", () => {
    state.autoLayers = !state.autoLayers;
    $("t-auto").setAttribute("aria-pressed", String(state.autoLayers));
    try { localStorage.setItem("atlas-auto", state.autoLayers ? "on" : "off"); } catch {}
    syncAuto();
  });
  // Layer choices are remembered per browser.
  try { Object.assign(state.show, JSON.parse(localStorage.getItem("atlas-layers") || "{}")); } catch {}
  for (const k of Object.keys(state.show)) {
    $("l-" + k).setAttribute("aria-pressed", String(state.show[k]));
    $("l-" + k).addEventListener("click", () => {
      if (!state.show[k] && state.auto[k]) { state.autoOff[k] = true; return syncAuto(); }
      state.show[k] = !state.show[k];
      $("l-" + k).setAttribute("aria-pressed", String(state.show[k]));
      try { localStorage.setItem("atlas-layers", JSON.stringify(state.show)); } catch {}
      $("l-" + k).classList.remove("auto");
      renderOverlays();
    });
  }
  const collapseLedger = foldLedger;
  for (const k of TABS) $("tab-" + k).addEventListener("click", () => {
    // The open story survives a look at the other tabs; the events tab clicked again goes back to the list.
    if (k === "events" && state.tab === "events") state.reading = false;
    state.tab = k;
    saveView();
    collapseLedger(false);
    renderLedger();
  });
  $("region-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleRegionPop(); });
  // The menu stays open while the timeline is used, so its periods can be watched changing.
  document.addEventListener("click", (e) => { if (!$("region-pop").hidden && !e.target.closest("#region-pop, .rail")) toggleRegionPop(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("region-pop").hidden) toggleRegionPop(false); });
  $("search-open").addEventListener("click", openSearch);
  $("share-open").addEventListener("click", shareView);
  $("tour-tab").addEventListener("click", (e) => { const b = e.target.closest("[data-tour]"); if (b) startTour(b.dataset.tour); });
  $("trail").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tr], [data-j]"), life = trail.life;
    if (!b || !life) return;
    if (b.dataset.j) return trailGo(+b.dataset.j);
    const n = life.steps.length, before = state.year < life.start, after = state.year > life.end;
    const go = { x: () => showTrail(null), prev: () => trailGo(after ? n - 1 : trail.k - 1), next: () => trailGo(before ? 0 : trail.k + 1),
      story: () => { const s = life.steps[trail.k]; if (s?.event) { state.reading = false; selectEvent(s.event); } },
      tour: () => startTour(life.id, Math.max(0, trail.k)) }[b.dataset.tr];
    go?.();
  });
  const tb = $("tour");
  tb.querySelector(".tour-prev").addEventListener("click", () => state.tour && tourStep(state.tour.i - 1));
  tb.querySelector(".tour-next").addEventListener("click", tourNext);
  tb.querySelector(".tour-close").addEventListener("click", endTour);
  // In immersive mode the story opens in the picture's place, as a reading card above the tour card, instead of
  // bringing the side panel back.
  const readStep = () => { const s = state.tour?.tr.steps[state.tour.i]; if (s?.event) { tourPause(); syncTourTop(); $("app").classList.add("tour-reading"); openStory(s.event); } };
  tb.querySelector(".tour-immersive").addEventListener("click", () => setImmersive(!state.immersive));
  // 🔊 cycles: off → male voice → female voice → off.
  for (const b of document.querySelectorAll(".narr-toggle")) b.addEventListener("click", () => {
    if (!state.narration) { state.voice = "Charon"; state.narration = true; unlockNarration(); setNarration(true); }  // this tap unlocks the player
    else if (state.voice === "Charon") { state.voice = "Kore"; setNarration(true); }
    else setNarration(false);
  });
  try { if (localStorage.getItem("atlas-narration") === "1") state.narration = true; const v = localStorage.getItem("atlas-voice"); if (v === "Charon" || v === "Kore") state.voice = v; } catch {}
  setNarration(state.narration, false);
  for (const b of document.querySelectorAll(".music-toggle")) b.addEventListener("click", () => setMusic(!state.music));
  try { const m = localStorage.getItem("atlas-music"); if (m) state.music = m === "1"; } catch {}
  setMusic(state.music, false);
  // The reading card's × (immersive mode only): back to the step's picture.
  const closeTourReading = () => { state.reading = false; $("app").classList.remove("tour-reading"); renderLedger(); };
  $("read-close").addEventListener("click", closeTourReading);
  // AI badges: a tap shows the note (and doesn't open the picture or the story); a tap anywhere else hides it.
  document.addEventListener("click", (e) => {
    const badge = e.target.closest(".ai-badge");
    for (const b of document.querySelectorAll('.ai-badge[aria-expanded="true"]')) if (b !== badge) b.setAttribute("aria-expanded", "false");
    if (!badge) return;
    e.stopPropagation(); e.preventDefault();
    badge.setAttribute("aria-expanded", String(badge.getAttribute("aria-expanded") !== "true"));
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !state.immersive) return;
    e.stopImmediatePropagation();
    // Esc first closes a story being read (back to the step's picture), then leaves immersive mode.
    if ($("app").classList.contains("tour-reading")) closeTourReading(); else setImmersive(false);
  }, true);
  tb.querySelector(".tour-story").addEventListener("click", readStep);
  $("tour-pic").addEventListener("click", () => { readStep(); placeTourPic(); });
  addEventListener("resize", () => { if (state.tour) { placeTourPic(); syncTourTop(); } if (!$("event-pic").hidden) showEventPic(state.selected); });
  const closeEventPic = () => { eventPic.closed = "a:" + state.selected; hideEventPic(); };
  $("event-pic").querySelector(".ep-close").addEventListener("click", (e) => { e.stopPropagation(); closeEventPic(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("event-pic").hidden) { e.stopImmediatePropagation(); closeEventPic(); } }, true);
  tb.querySelector(".tour-auto").addEventListener("click", () => {
    const tour = state.tour; if (!tour) return;
    if (tour.auto) return tourPause();
    tour.auto = true; tourNext();
  });
  $("search-close").addEventListener("click", closeSearch);
  $("search-q").addEventListener("input", renderSearch);
  $("search-results").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) pickSearch(+b.dataset.i); });
  $("search-q").addEventListener("keydown", (e) => {
    const n = searchHits.length;
    if (e.key === "Escape") return closeSearch();
    if (e.key === "Enter") return pickSearch(searchOn);
    if (!n || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    searchOn = (searchOn + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    $("search-results").querySelectorAll("[data-i]").forEach((b) => b.classList.toggle("on", +b.dataset.i === searchOn));
    $("search-results").querySelector(".on")?.scrollIntoView({ block: "nearest" });
  });
  $("ledger-min").addEventListener("click", () => collapseLedger(!$("ledger").classList.contains("collapsed")));
  $("era-min").addEventListener("click", (e) => { e.stopPropagation(); setEraMin(!state.eraMin, true); });
  $("rail-min").addEventListener("click", (e) => { e.stopPropagation(); setRailMin(!state.railMin, true); });
  try { if (localStorage.getItem("atlas-rail-min") === "1") setRailMin(true); } catch {}
  $("rail-style").addEventListener("click", () => setRailSlim(!state.railSlim, true));
  let slim = false;
  try { slim = localStorage.getItem("atlas-rail-slim") === "1"; } catch {}
  setRailSlim(slim);
  try { state.dialSkin = localStorage.getItem("atlas-dial-skin") || "luopan"; if (localStorage.getItem("atlas-dial") === "1") setDial(true); } catch {}
  $("speed").addEventListener("click", (e) => { e.stopPropagation(); toggleSpeedPop(); });
  $("speed-pop").addEventListener("click", (e) => {
    const b = e.target.closest("[data-speed]");
    if (!b) return;
    setSpeed(+b.dataset.speed, true);
    toggleSpeedPop(false);
  });
  document.addEventListener("click", (e) => { if (!$("speed-pop").hidden && !e.target.closest("#speed-pop")) toggleSpeedPop(false); });
  let speed = 1;
  try { speed = +localStorage.getItem("atlas-speed") || 1; } catch {}
  setSpeed(speed);
  try { if (localStorage.getItem("atlas-era-min") === "1") setEraMin(true); } catch {}
  $("ledger-toggle").addEventListener("click", () => $("app").classList.contains("tour-reading") ? $("app").classList.remove("tour-reading") : collapseLedger(!$("ledger").classList.contains("collapsed")));
  const phone = matchMedia("(max-width: 720px)");
  if (phone.matches) collapseLedger(true);
  // Phone: tools and layer switches sit behind one button; the sheet and era bar size themselves to the timeline.
  const openEra = (o) => { $("era-more").setAttribute("aria-expanded", String(o)); document.querySelector(".era").classList.toggle("open", o); };
  // On wide screens the same button folds the layer switches and period notes away (remembered).
  $("era-more").addEventListener("click", () => phone.matches ? openEra(!document.querySelector(".era").classList.contains("open")) : setLean(!state.lean, true));
  try { setLean(localStorage.getItem("atlas-lean") === "1"); } catch { setLean(false); }
  map.on("click", () => { if (phone.matches) openEra(false); });
  // Click a country to select it, click it again to let go. A click that closes an open card only closes it.
  let hadCard = false;
  map.on("mousedown", () => { hadCard = !!document.querySelector(".maplibregl-popup"); });
  map.on("touchstart", () => { hadCard = !!document.querySelector(".maplibregl-popup"); });
  map.on("click", (e) => {
    if (hadCard || e.originalEvent.target !== map.getCanvas() || state.tour) return;
    // A click on a seat ring opens its card instead.
    if (map.getLayer("admin-dot") && map.queryRenderedFeatures(e.point, { layers: ["admin-dot"] }).length) return;
    const f = map.queryRenderedFeatures(e.point, { layers: ["focus-fill", "neighbour-fill"] }).find((f) => f.properties.name);
    if (!f) return;
    if (selNames().has(f.properties.name) && selOnMap()) selectCountry(null); else selectCountry(f.properties.name);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.sel && e.target.tagName !== "INPUT" && !state.reading && $("search").hidden) selectCountry(null); });
  // The tour card grows and shrinks with each step's caption; the immersive reading card ends just above it.
  new ResizeObserver(() => { if (state.tour) syncTourTop(); }).observe($("tour"));
  new ResizeObserver(() => {
    sizeRailVars();
    sizeTrack();
    fitBandLabels();
    renderYearMarks();
  }).observe(document.querySelector(".rail"));
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key === "k")) { e.preventDefault(); return openSearch(); }
    const i = state.eras.indexOf(state.era);
    if (e.key === "ArrowRight") setYear(state.year + 1);
    if (e.key === "ArrowLeft") setYear(state.year - 1);
    if (e.key === "PageDown" && state.eras[i + 1]) goToEra(state.eras[i + 1]);
    if (e.key === "PageUp" && state.eras[i - 1]) goToEra(state.eras[i - 1]);
    if (e.key === "+" || e.key === "=") setZoom(state.zoom + 1);
    if (e.key === "-") setZoom(state.zoom - 1);
    if (e.key === "Escape" && state.reading) { state.reading = false; renderLedger(); }
    if (e.key === " ") { e.preventDefault(); play(); }
  });
}

init().catch((err) => {
  console.error(err);
  $("era-summary").textContent = t("loadError") + err.message;
});
