// Atlas: a data-driven 3D history map.
// Everything historical lives in data/: eras.json (time ranges + border snapshots per era),
// events.json (dated, located events), places.json (cities with the years they matter) and
// details/<era>.json (the longer story behind each event, loaded when the era is opened) and
// layers/<era>.json (map overlays for one era: rulers by polity, the armies of each battle, routes, people and
// capitals) and overlays.json (overlays that build up over time: population, religion & thought, inventions).
// Adding an era or an event means editing those files, not this code.
// Years are integers; negative years are BCE. Text fields come in pairs: `x` (English) and `x_zh`.

const BASE = document.baseURI.replace(/[^/]*([?#].*)?$/, "");
// Data packs: another site's history (eras, events, tours) shown on this engine's world map, opened with
// ?pack=<manifest URL>. Pack text ends up in the page, so packs load only from these sites (and a local
// server while developing). See docs/custom-data.md.
const PACK_ORIGINS = ["https://atlas.daiyip.com", "https://bible.daiyip.com", "https://daiyip.github.io"];
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
  rulerPolity: null,    // country shown in the ruler list
  scope: null,          // the reign the timeline is narrowed to: { polity, i, label }
  borders: {},          // borders path -> GeoJSON
  bundles: {},          // border bundle file -> promise of {map id: GeoJSON}
  details: {},          // era id -> promise of { event id -> detail }
  scale: [],            // [{era, p0, p1}] slider positions per era (zoom "all")
  zoom: 0,
  closedArmies: new Set(),
  win: null,            // [start, end] years shown on the rail when zoomed in
  lang: "zh",
  show3d: true, showSat: true, showNeighbours: true, showPlaces: true, showGeo: true,
  geo: [],              // labels for rivers, lakes, mountains, plains, seas
  layers: {},           // era id -> promise of { rulers, armies, routes }
  exchange: { routes: [], topics: {}, spread: [] }, // cross-civilisation routes and spreads (data/exchange.json)
  layerData: null,      // the current era's overlays once loaded
  auto: {},             // layers on only for the current story or tour step (syncAuto)
  autoOff: {}, autoCtx: "",
  autoLayers: true,
  show: { rulers: true, armies: true, routes: true, people: true, capitals: false, faith: false, inventions: false, passes: true, roads: true, clans: true, walls: true, exchange: true, spread: true },
  overlays: { population: [], faith: [], inventions: [] },
  passes: [],           // famous passes (关隘), data/passes.json
  roads: [],            // major official roads (官道), data/roads.json
  clans: [],            // local elite groups (豪族/士人集团), data/clans.json
  walls: [],            // Great Walls (长城) by period, data/walls.json
  playing: null,
};

const $ = (id) => document.getElementById(id);

/* ---------- language ---------- */

const UI = {
  zh: {
    title: "历代地图", events: "事件", hide: "收起", show: "展开", t3d: "3D 地形", sat: "卫星影像", neighbours: "周边政权", cities: "城市", geo: "山川",
    other: "English", map: "地图：", count: (n, era) => `${era} · ${n} 件`, countWin: (n) => `本时段 · ${n} 件`,
    fc: { ok: "已与维基百科/维基数据核对年份", fixed: "已更正", doubt: "存疑", none: "AI 撰写，尚未核对" },
    sm: { ok: "简介已与维基百科对照（AI 审读）", fixed: "简介已更正", doubt: "简介存疑" }, back: "返回列表", prev: "上一件", next: "下一件", why: "历史意义", people: "相关人物", wiki: "维基百科", wikiOther: "English Wikipedia",
    more: "阅读详情 →", loading: "正在载入…", noStory: "这件事的详细介绍还在编写中。",
    notePack: "疆域为近似示意，取自开源 Cliopatria（Seshat）与 historical-basemaps 数据集。地形、海岸线和河流均为现代地理。",
    note: "疆域为近似示意：取自开源 historical-basemaps 数据集，并参照谭其骧《中国历史地图集》人工修订。地形、海岸线和河流均为现代地理。",
    zooms: ["全部", "朝代", "数十年"], country: "国家", reignLen: (n) => `${n}年`, rulerCount: (n) => `${n} 位`, noRulers: "本时期暂无君主资料", worldMap: (y) => `${y}前后的世界`, worldName: "世界 · 公元纪年", noRegionEvents: "这个地区的事件还在整理中，下一步加入。现在可以看各时期的疆域。", noPeople: "本时期暂无人物资料", peopleHint: "点击人物，地图飞到其居所并显示生平", pgroups: { all: "全部", mil: "军事", pol: "政治", cul: "思想文学", art: "艺术", sci: "科技" }, scopeHint: "点击君主，时间轴缩放到其在位期间", zoomIn: "放大时间轴", zoomOut: "缩小时间轴", earlier: "向前", later: "向后",
    hint: ["点击朝代跳转 · 按 + 放大时间轴", (era) => `${era} · 每一段是一幅地图`, (era) => `${era} · 数十年视图`],
    play: "播放", pause: "暂停", year: "年份", loadError: "地图数据无法载入。",
    detail: "详略", levels: ["大事", "要事", "细目"], allCats: "全部", cat: { war: "战争", politics: "政治", reform: "改革", rebellion: "起义", culture: "文化", economy: "经济", diplomacy: "外交", science: "科技", society: "社会" },
    layers: "图层", g_map: "地图", g_pol: "政治", g_war: "军事", g_move: "交通", g_cul: "人文", g_pack: "专题", rulers: "君主", armies: "军队", routes: "路线", forces: "参战双方", ruler: "在位：",
    reign: (a, b) => `${a}–${b}年在位`, troops: "兵力", unknown: "不详", losses: "伤亡",
    result: { won: "胜", lost: "败", draw: "平" },
    units: { infantry: "步兵", cavalry: "骑兵", chariots: "战车", archers: "弓兵", crossbows: "弩兵", navy: "水军", siege: "攻城", firearms: "火器", artillery: "火炮", elephants: "象兵" },
    kinds: { campaign: "进军", journey: "行程", trade: "商路", canal: "运河", wall: "长城" }, exchange: "交流", spread: "传播", spreadGroups: { faith: "宗教传播", tech: "技术传播", crop: "作物传播" }, arrived: (y) => `${y}传到`, set_out: (y) => `${y}起`, world_t: "世界", worldHead: "同一年的世界", goRegion: "切换地区", allWorld: "全球", worldHint: "点击地区，地图和时间轴切换过去；点击事件阅读详情", noWorldEv: "前后几十年没有收录的大事", elsewhere: "同时期的世界", hideStrip: "隐藏", showStrip: "在时间轴上方显示同时期的世界",
    people_l: "人物", cmp: { one: "对比", open: "两地对比", sync: "同步视角", openTime: "两时对比", place: "两地", time: "两时", period: "时期", year: "年份", close: "关闭对比", pick: "对比地区", rulers: "君主", events: "前后大事", none: "前后几十年没有收录的大事" }, lasted: (n) => `共${n}年`, close: "关闭", search: "搜索", share: "分享这个视图", tours: "导览", toursHead: "导览 · 跟着地图读历史", tourStory: "读这段故事", tourBack: "返回导览", tourPrev: "上一步", tourNext: "下一步", tourPlay: "自动播放", tourPause: "暂停", tourEnd: "结束导览", tourDone: "导览结束", tourSteps: (n) => `${n} 站`, tourCount: (n) => `${n} 条导览`, tourAt: (n) => `第${n}站`, toursHere: "本时期导览", toursOther: "其他时期", noTours: "本时期还没有导览", tourHint: "点击一条导览，地图会跟着故事移动", linkCopied: "链接已复制，可以发给别人", linkCopy: "复制这个链接：", searchPh: "搜索导览、事件、人物、君主、城市或年份（如 755、前221）", autoLayers: "自动图层", autoHint: "打开事件或导览时，自动显示相关图层，自动打开的图层标为虚线", autoOn: "已自动显示", autoAlso: "相关图层", sgroups: { time: "时间", era: "朝代", tour: "导览", event: "事件", person: "人物", ruler: "君主", city: "城市" }, noResults: "没有找到相关内容", jumpYear: "跳到这一年", capitals: "都城·人口", faith: "宗教思想", inventions: "发明", passes: "关隘", roads: "官道", walls: "长城", wallBy: "修筑", wallLen: (n) => `约${n.toLocaleString()}公里`, ruin: "已废弃，现为遗迹", clans: "豪族", ckinds: { gentry: "门阀士族", bloc: "地域集团", military: "军事集团", faction: "朋党", merchant: "商帮" }, seats: "郡望/根据地", families: "代表家族", members: "代表人物", drafted: "AI 整理，未经核对", cityEvents: (n) => `城中大事（${n}）· 点击跳转`,  personEvents: (n) => `相关事件（${n}）· 点击跳转`, pranks: { capital: "都城", secondary: "陪都", major: "重要城市", port: "港口", frontier: "军事重镇" }, rkinds: { imperial: "驰道", post: "驿道", trade: "商道" }, via: "途经", inUse: "使用年代",
    fields: { general: "军事家", statesman: "政治家", thinker: "思想家", poet: "诗人", writer: "文学家", historian: "史学家", scientist: "科学家", physician: "医学家", engineer: "工程师", artist: "艺术家", religious: "宗教人物", explorer: "旅行家", scholar: "学者" },
    faiths: { buddhist: "佛教", daoist: "道教", confucian: "儒家", islam: "伊斯兰教", christian: "基督教", thought: "思想", other: "其他" },
    ifields: { craft: "工艺", writing: "文字", printing: "印刷", metallurgy: "冶金", military: "军事", astronomy: "天文", math: "数学", medicine: "医学", agriculture: "农业", navigation: "航海", engineering: "工程", money: "货币" },
    pop: "人口", popOf: (m, y, k) => { const w = Math.round(m * 100); return `${k === "estimate" ? "估计约" : "约"}${w >= 10000 ? (w / 10000).toFixed(1).replace(/\.0$/, "") + "亿" : w + "万"}（${y}）`; },
    capital: "都城", works: "代表作", life: (a, b) => `${a} – ${b}`, inventor: "发明者", pkinds: { pass: "山隘", wall: "长城关口", gate: "关口" }, guards: "扼守", battles: "关前史事", built: (y) => `${y}建`,
  },
  en: {
    title: "Atlas", events: "Events", hide: "Hide", show: "Show", t3d: "3D terrain", sat: "Satellite", neighbours: "Neighbours", cities: "Cities", geo: "Landscape",
    other: "中文", map: "Map: ", count: (n, era) => `${n} in ${era}`, countWin: (n) => `${n} in view`,
    fc: { ok: "Years checked against Wikipedia/Wikidata", fixed: "Corrected", doubt: "Doubtful", none: "AI-drafted, not yet checked" },
    sm: { ok: "Summary compared with Wikipedia (AI review)", fixed: "Summary corrected", doubt: "Summary doubtful" }, back: "All events", prev: "Previous", next: "Next", why: "Why it matters", people: "People", wiki: "Wikipedia", wikiOther: "中文维基百科",
    more: "Read the story →", loading: "Loading…", noStory: "The full story for this event is still being written.",
    notePack: "Borders are approximate, from the open Cliopatria (Seshat) and historical-basemaps datasets. Terrain, coastlines and rivers are modern.",
    note: "Borders are approximate: from the open historical-basemaps dataset, revised by hand after Tan Qixiang's Historical Atlas of China. Terrain, coastlines and rivers are modern.",
    zooms: ["All", "Dynasty", "Decades"], country: "Country", reignLen: (n) => `${n} yr${n > 1 ? "s" : ""}`, rulerCount: (n) => `${n} rulers`, noPeople: "No famous people listed for this period", peopleHint: "Click a person to fly to where they lived and read about them", pgroups: { all: "All", mil: "Military", pol: "Politics", cul: "Thought & letters", art: "Arts", sci: "Science" }, noRulers: "No rulers recorded for this period", worldMap: (y) => `the world around ${y}`, worldName: "World · calendar years", noRegionEvents: "Events for this region are still being written. For now you can follow its borders through the periods.", scopeHint: "Pick a ruler to narrow the timeline to their reign", zoomIn: "Zoom in", zoomOut: "Zoom out", earlier: "Earlier", later: "Later",
    hint: ["Click a dynasty to jump · + to zoom in", (era) => `${era} · each segment is one map`, (era) => `${era} · decades view`],
    play: "Play timeline", pause: "Pause timeline", year: "Year", loadError: "The map data could not be loaded. ",
    detail: "Detail", levels: ["Key", "Major", "All"], allCats: "All", cat: { war: "War", politics: "Politics", reform: "Reform", rebellion: "Uprising", culture: "Culture", economy: "Economy", diplomacy: "Diplomacy", science: "Science", society: "Society" },
    layers: "Layers", g_map: "Map", g_pol: "Power", g_war: "War", g_move: "Travel", g_cul: "Culture", g_pack: "Pack", rulers: "Rulers", armies: "Armies", routes: "Routes", forces: "Forces", ruler: "Ruler: ",
    reign: (a, b) => `r. ${a}–${b}`, troops: "Troops", unknown: "unknown", losses: "Losses",
    result: { won: "Won", lost: "Lost", draw: "Draw" },
    units: { infantry: "Infantry", cavalry: "Cavalry", chariots: "Chariots", archers: "Archers", crossbows: "Crossbows", navy: "Navy", siege: "Siege", firearms: "Firearms", artillery: "Artillery", elephants: "Elephants" },
    kinds: { campaign: "Campaign", journey: "Journey", trade: "Trade route", canal: "Canal", wall: "Wall" }, exchange: "Exchange", spread: "Spread", spreadGroups: { faith: "Faith spreads", tech: "Technique spreads", crop: "Crop spreads" }, arrived: (y) => `arrived ${y}`, set_out: (y) => `from ${y}`, world_t: "World", worldHead: "The world this year", goRegion: "Go to region", allWorld: "Whole world", worldHint: "Click a region to move the map and timeline there; click an event to read it", noWorldEv: "No major events recorded within a few decades", elsewhere: "Elsewhere", hideStrip: "Hide", showStrip: "Show other regions above the timeline",
    people_l: "People", cmp: { one: "Compare", open: "Compare regions", sync: "Sync view", openTime: "Compare times", place: "Two places", time: "Two times", period: "Period", year: "Year", close: "Close compare", pick: "Compare with", rulers: "Rulers", events: "Around this year", none: "No major events recorded within a few decades" }, lasted: (n) => `${n} years`, close: "Close", search: "Search", share: "Share this view", tours: "Tours", toursHead: "Guided tours", tourStory: "Read the story", tourBack: "Back to the tour", tourPrev: "Back", tourNext: "Next", tourPlay: "Play", tourPause: "Pause", tourEnd: "End tour", tourDone: "End of tour", tourSteps: (n) => `${n} stops`, tourCount: (n) => `${n} tour${n === 1 ? "" : "s"}`, tourAt: (n) => `Stop ${n}`, toursHere: "Tours for this period", toursOther: "Other periods", noTours: "No tours for this period yet", tourHint: "Pick a tour and the map follows the story", linkCopied: "Link copied", linkCopy: "Copy this link:", searchPh: "Search tours, events, people, rulers, cities or a year (755, 221 BC)", autoLayers: "Auto layers", autoHint: "Reading an event or a tour stop switches on the layers it needs; those get a dashed outline", autoOn: "Switched on for this", autoAlso: "Related layers", sgroups: { time: "Year", era: "Periods", tour: "Tours", event: "Events", person: "People", ruler: "Rulers", city: "Cities" }, noResults: "Nothing found", jumpYear: "Go to this year", capitals: "Capitals", faith: "Faith", inventions: "Inventions", passes: "Passes", roads: "Roads", walls: "Great Walls", wallBy: "Built by", wallLen: (n) => `about ${n.toLocaleString()} km`, ruin: "Abandoned; ruins remain", clans: "Elites", ckinds: { gentry: "Great clans", bloc: "Regional bloc", military: "Military clique", faction: "Court faction", merchant: "Merchant guild" }, seats: "Home seats", families: "Families", members: "Key figures", drafted: "AI-drafted, not source-checked", cityEvents: (n) => `Events here (${n}) · click to jump`, personEvents: (n) => `Related events (${n}) · click to jump`, pranks: { capital: "Capital", secondary: "Secondary capital", major: "Major city", port: "Port", frontier: "Military stronghold" }, rkinds: { imperial: "Imperial highway", post: "Post road", trade: "Trade road" }, via: "Via", inUse: "In use",
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
  $("lang-name").textContent = L.short;
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
function loadPack(z, px, py, dir = "pack") {
  const key = `${dir}/${z}-${px}-${py}`;
  if (!(key in packs)) {
    // Each archive is wrapped in a 1x1 PNG (the host serves only standard file types); the archive itself sits in
    // a private "tpAk" chunk: a 4-byte index length, a JSON index {"x/y": [offset, length]}, then the tile PNGs.
    packs[key] = fetch(`${BASE}tiles/${key}.png`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
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
maplibregl.addProtocol("atlas", async (params) => {
  const sat = params.url.startsWith("atlas://sat/");
  const [z, x, y] = params.url.slice(sat ? "atlas://sat/".length : "atlas://".length).split("/").map(Number);
  const data = await (sat ? satTile(z, x, y) : demTile(z, x, y));
  if (!data) throw new Error(`no ${sat ? "imagery" : "elevation"} tile ${z}/${x}/${y}`);
  return { data };
});

// Two looks: satellite colours with light shading, or the drawn relief map (hypsometric tint, stronger shading).
const SKY = {
  sat: { "sky-color": "#3f86c8", "horizon-color": "#cfe4f2", "fog-color": "#d6e6f0",
         "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.3, "atmosphere-blend": 0.8 },
  relief: { "sky-color": "#a9c4d0", "horizon-color": "#e3ebe8", "fog-color": "#e3ebe8",
            "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.4, "atmosphere-blend": 0.5 },
};
// Relief is exaggerated more as you zoom in, so hills and ranges keep standing out at close range.
const terrainExaggeration = (z) => Math.min(5, 2 + Math.max(0, z - 5) * 0.9);
function setTerrainForZoom() {
  if (!state.show3d) return;
  const e = Math.round(terrainExaggeration(map.getZoom()) * 10) / 10;
  if (e === state.terrainExag) return;
  state.terrainExag = e;
  // Calling setTerrain again would rebuild the terrain and stall tile loading; adjust the live terrain instead.
  if (map.terrain) { map.terrain.exaggeration = e; map.triggerRepaint(); }
  else map.setTerrain({ source: "dem-terrain", exaggeration: e });
}
function applyLook() {
  const sat = state.showSat;
  document.documentElement.classList.toggle("sat", sat);
  if (!map?.getLayer("satellite")) return;
  map.setLayoutProperty("satellite", "visibility", sat ? "visible" : "none");
  // The drawn relief stays underneath, so it shows where the imagery stops (west of about 70°E).
  map.setLayoutProperty("relief", "visibility", "visible");
  map.setPaintProperty("hillshade", "hillshade-exaggeration", sat
    ? ["interpolate", ["linear"], ["zoom"], 3, 0.3, 6, 0.55, 8, 0.8]
    : ["interpolate", ["linear"], ["zoom"], 3, 0.45, 6, 0.6, 8, 0.7]);
  map.setPaintProperty("hillshade", "hillshade-highlight-color", sat
    ? ["rgba(255,244,214,0.5)", "rgba(255,244,214,0.35)", "rgba(255,244,214,0.2)", "rgba(255,244,214,0.35)"] : ["#fffdf5", "#fffdf5", "#fff8e8", "#fffdf5"]);
  map.setPaintProperty("hillshade", "hillshade-shadow-color", sat
    ? ["rgba(8,14,6,0.95)", "rgba(8,14,6,0.8)", "rgba(8,14,6,0.6)", "rgba(8,14,6,0.8)"] : ["#3a3328", "#4a3f33", "#3a3328", "#2e2a24"]);
  map.setPaintProperty("lakes", "fill-opacity", sat ? 0 : 0.9);
  map.setPaintProperty("bg", "background-color", sat ? "#1d4f86" : "#9db8bf");
  map.setSky(SKY[sat ? "sat" : "relief"]);
}

function buildStyle() {
  const dem = { type: "raster-dem", tiles: [TILE_URL], tileSize: 256, encoding: "terrarium", maxzoom: 10 };
  return {
    version: 8,
    sources: {
      dem, "dem-terrain": { ...dem },
      sat: { type: "raster", tiles: [SAT_URL], tileSize: 256, maxzoom: 10,
             attribution: "Imagery: Sentinel-2 2020, Copernicus/Sentinel Hub (CC BY 4.0); Sentinel-2 cloudless 2016 by EOX, s2maps.eu (CC BY 4.0)" },
      rivers: { type: "geojson", data: BASE + "data/geo/rivers.geojson" },
      lakes: { type: "geojson", data: BASE + "data/geo/lakes.geojson" },
      oldgeo: { type: "geojson", data: BASE + "data/geo/old-rivers.geojson" },
      borders: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      routes: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      spread: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      roads: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      clans: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      walls: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    sky: SKY.relief,
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#9db8bf" } },
      { id: "relief", type: "color-relief", source: "dem", paint: { "color-relief-color": RELIEF } },
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
      // The states a tour step talks about (tourHighlight sets the filter).
      { id: "hl-fill", type: "fill", source: "borders", filter: ["==", ["get", "name_zh"], "\u0000"],
        paint: { "fill-color": "#f2c14e", "fill-opacity": 0.42 } },
      { id: "hl-line", type: "line", source: "borders", filter: ["==", ["get", "name_zh"], "\u0000"], layout: { "line-join": "round" },
        paint: { "line-color": "#f2c14e", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 6], "line-blur": 0.5 } },
      // Elite groups (豪族/士人集团): a soft tint over their home region with a dashed edge, coloured by kind.
      { id: "clan-fill", type: "fill", source: "clans", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.3 } },
      { id: "clan-line", type: "line", source: "clans", layout: { "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.95, "line-dasharray": [2, 1.5] } },
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
// Packs and plugins load only from this site, the sites in PACK_ORIGINS and a local server.
const allowedOrigin = (u) => u.origin === location.origin || PACK_ORIGINS.includes(u.origin) || ["localhost", "127.0.0.1"].includes(u.hostname);
// The manifest named by ?pack=, or null. Throws with a readable message when the pack cannot be used.
async function openPack(url) {
  let u;
  try { u = new URL(url, location.href); } catch { throw new Error(`"${url}" is not a pack address.`); }
  if (!allowedOrigin(u)) throw new Error(`Packs from ${u.origin} are not allowed.`);
  const res = await fetch(u, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load the pack (${res.status}).`);
  const manifest = await res.json();
  if (manifest.atlas !== 1) throw new Error(`This pack needs a newer atlas (format ${manifest.atlas}).`);
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
  });
}
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
const PLUGIN_API = 1;
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
    document.querySelector(".era-layers").append(g);
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
  const before = map.getLayer("tour-path") ? "tour-path" : undefined;
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
  return (state.pack?.manifest.plugins || []).map((p) => {
    const u = new URL(p, state.pack.url);
    if (!allowedOrigin(u)) return Promise.reject(new Error(`Plugins from ${u.origin} are not allowed.`));
    return import(u.href).then((m) => ({ src: u.href, m }));
  });
}
// Once the map has loaded: the manifest's layers, then each plugin's setup(atlas). A broken one is logged and skipped.
async function startPlugins(imports) {
  const base = state.pack.url;
  for (const def of state.pack.manifest.layers || []) {
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
function setMode(id, quiet) {
  if (id === state.mode || (id !== "world" && !state.regionById[id])) return false;
  state.mode = id;
  state.eras = id === "world" ? state.worldEras : state.regionById[id].eras;
  state.scope = null;
  state.country = null;
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
  revealYear(true);
  saveView();
  const snap = snapshotFor(era, state.year);
  const label = snap.world ? t("worldMap")(fmtYear(worldAt(state.year)?.from ?? snap.from)) : tx(snap, "label");
  $("era-snap").textContent = label ? t("map") + label : "";
  $("era-snap").hidden = !label;
  document.querySelectorAll(".band.snap").forEach((b) => b.classList.toggle("current", b.dataset.path === snap.borders && +b.dataset.from === snap.from));
  await setMaps(era, state.year);
  updateCompare();
  renderEventStates();
  renderPlaces();
  renderOverlays();
  renderOldGeo();
  renderPackLayers();
  emit("year", { year: state.year, era: era.id, eraChanged });
  renderWorldStrip();
}

function setEra(era, quiet) {
  state.era = era;
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
  $("era-zh").innerHTML = (region ? [nameOf(region), zh() ? era.name : era.name_zh, `${fmtYear(era.start)} – ${fmtYear(era.end)}`, t("lasted")(eraYears(era))]
    : [t("worldName"), t("lasted")(eraYears(era))])
    .map((x) => `<span>${esc(x)}</span>`).join(" · ");
  $("era-summary").textContent = tx(era, "summary");
  const note = tx(era, "note");
  $("era-note").textContent = note;
  $("era-note").hidden = !note;
  document.querySelectorAll(".band.era-band").forEach((b) => b.classList.toggle("current", b.dataset.era === era.id));
  $("scale-hint").textContent = hintText();
  loadDetails(era);
  state.layerData = null;
  popup?.remove();
  loadLayers(era).then((d) => { if (state.era === era) { state.layerData = d; renderOverlays(); if (state.tab === "events" && !state.reading) renderLedger(); } });
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
  // While playing, the old map turns into the new one; otherwise it simply switches.
  if (state.playing && prev && !matchMedia("(prefers-reduced-motion: reduce)").matches && morphBorders(prev, state.borders[key])) return;
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
    el.className = "mk-polity" + (p.focus ? " focus" : p.name_zh ? " neighbour" : "") +
      (p.kind === "state" ? " state" : "") + (p.minor ? " minor" : "");
    if (zh()) el.innerHTML = p.name_zh ? esc(p.name_zh) : `<small>${esc(p.name)}</small>`;
    else el.innerHTML = `<span>${esc(p.name)}</span>` + (p.name_zh ? `<small lang="zh-CN">${esc(p.name_zh)}</small>` : "");
    markers.polities.push(new maplibregl.Marker({ element: el }).setLngLat(p.label).addTo(map));
    markers.polityEls.push({ el, name: p.name, focus: p.focus, state: p.kind === "state", area: p.area || 0, lat: p.label[1] });
  }
  updateRulers();
}

/* ---------- overlay layers: rulers, armies, routes ---------- */

// Length of a period in years; there is no year 0, so a span across it is one year shorter.
const eraYears = (e) => e.end - e.start + 1 - (e.start < 0 && e.end > 0 ? 1 : 0);
function loadLayers(era) {
  if (!era.layers) return Promise.resolve({});
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
  [["faith"], (c, x) => /佛|寺|僧|道教|道士|儒|孔子|孟子|理学|心学|书院|景教|伊斯兰|摩尼|祆教|基督|天主|传教|石窟|经书|佛经|百家/.test(x)],
  [["inventions"], (c, x) => c === "science" || /发明|造纸|印刷|火药|指南|历法|地动仪|天文|算|医书|本草|农书|技术|瓷/.test(x)],
  [["clans"], (c, x) => /门阀|士族|世家|豪族|朋党|党争|党禁|商帮|集团|郡望/.test(x)],
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
  if (text) for (const [keys, test] of AUTO_RULES) if (test(cat, text)) for (const k of keys) if (!state.autoOff[k]) auto[k] = true;
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
  renderPopulation();
}

/* People, capitals, religion & thought, inventions: small markers that open a card. */

let popup;
function showCard(lngLat, html) {
  popup?.remove();
  popup = new maplibregl.Popup({ className: "atlas-pop", maxWidth: "300px", offset: 14, focusAfterOpen: false })
    .setLngLat(lngLat).setHTML(html).addTo(map);
  fillIllus(popup.getElement());
  // Event lists open at the city's current period and jump to that moment when clicked.
  const list = popup.getElement().querySelector(".pc-events"), now = list?.querySelector(".now");
  if (now) list.scrollTop = now.parentElement.offsetTop - list.offsetTop - 4;
  popup.getElement().querySelectorAll("[data-ev]").forEach((b) => b.addEventListener("click", () => {
    popup?.remove();
    state.reading = false;
    selectEvent(b.dataset.ev);
  }));
}
/* ---------- illustrations ---------- */
// data/illustrations.json maps "p:<person id>" / "e:<event id>" to an image; the pictures themselves sit in data/img/<bucket>.json
// as data URLs (the hosted page cannot load images from other sites). Built by tools/pack_illustrations.py.
let illuIndex = null;
const illuBuckets = {};
function illuSlot(key) {
  return `<figure class="illu" data-illu="${esc(key)}" hidden></figure>`;
}
async function fillIllus(root) {
  const slots = [...root.querySelectorAll("figure[data-illu]:not(.done)")];
  if (!slots.length) return;
  illuIndex ||= loadJSON("data/illustrations.json").catch(() => ({ keys: {}, images: {} }));
  const idx = await illuIndex;
  for (const fig of slots) {
    fig.classList.add("done");
    const id = idx.keys[fig.dataset.illu], im = idx.images[id];
    if (!im) continue;
    illuBuckets[im.b] ||= loadJSON(`data/img/${im.b}.json`).catch(() => ({}));
    const src = (await illuBuckets[im.b])[id];
    if (!src) continue;
    const credit = [im.artist, im.license].filter(Boolean).join(" · ");
    fig.innerHTML = `<img src="${src}" alt="${esc(im.page)}" style="aspect-ratio:${im.w}/${im.h}">` +
      `<figcaption><a href="${esc(im.url)}" target="_blank" rel="noopener">${esc(credit || "Wikimedia Commons")} ↗</a></figcaption>`;
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
  const alive = list.filter((p) => state.year >= personSpan(p)[0] && state.year <= personSpan(p)[1]);
  pointMarkers("people", alive, (p) => {
    const el = document.createElement("div");
    el.className = "mk-person f-" + p.field;
    const nm = nameOf(p);
    el.innerHTML = `<i>${esc((p.name_zh || p.name).slice(0, 1))}</i><span>${esc(nm)}<small>${esc(t("fields")[p.field] || "")}</small></span>`;
    return { el, anchor: "left", card: () => personCard(p) };
  });
}
function personLife(p) {
  if (p.died == null && p.born != null) return zh() ? `${fmtYear(p.born, p.circa)}生` : `born ${fmtYear(p.born, p.circa)}`; // living
  return p.died != null ? t("life")(p.born != null ? fmtYear(p.born, p.circa) : "?", fmtYear(p.died, p.circa)) : (zh() ? "生卒不详" : "dates unknown");
}
function personCard(p) {
  const works = (p.works || []).map((w) => zh() ? `《${esc(w.title_zh || w.title)}》` : `<i>${esc(w.title)}</i>`).join(zh() ? "" : ", ");
  const line = p.line_zh ? `<blockquote><span lang="zh-CN">${esc(p.line_zh)}</span>${!zh() && p.line_en ? `<em>${esc(p.line_en)}</em>` : ""}</blockquote>` : "";
  return `${illuSlot("p:" + p.id)}<div class="pc-kind">${esc(t("fields")[p.field] || p.field)} · ${personLife(p)}</div>
    <h4>${esc(nameOf(p))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? p.name : p.name_zh)}</span></h4>
    <p>${esc(tx(p, "known_for"))}</p>${works ? `<p class="pc-works"><b>${t("works")}</b> ${works}</p>` : ""}${line}
    ${personEventList(p)}${checkNote(p)}<p class="pc-meta">${esc(tx(p, "place"))} ${wikiA((zh() && p.source_zh) || p.source)}</p>`;
}
function personEventList(p) {
  const evs = personEvents(p);
  if (!evs.length) return "";
  // Highlight the latest event up to the current year, so the list opens there.
  const last = evs.filter((ev) => ev.year <= state.year).pop() || evs[0];
  return `<p class="pc-works"><b>${t("personEvents")(evs.length)}</b></p>${eventButtons(evs, (ev) => ev === last)}`;
}
// Years a person's marker is on the map: their life, or the 40 years before death when the birth year is unknown.
const personSpan = (p) => p.show ? p.show : [p.born ?? p.died - 40, p.died ?? state.range.end];

function renderCapitals() {
  const list = shown("capitals") ? (state.layerData?.capitals || []) : [];
  const now = list.filter((c) => state.year >= c.from && state.year <= c.to);
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
  const start = state.zoom === 2 ? state.win[0] : state.era.start;
  const shown = items.filter((x) => x.year <= state.year && x.year >= start);
  pointMarkers(key, shown, (x) => {
    const recent = x.year >= state.era.start;
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
  const list = shown("passes") ? state.passes.filter((x) => state.year >= x.from && (x.to == null || state.year <= x.to)) : [];
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
  const list = shown("roads") ? state.roads.filter((r) => state.year >= r.from && (r.to == null || state.year <= r.to)) : [];
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
  const list = shown("clans") ? state.clans.filter((g) => state.year >= g.from && state.year <= g.to) : [];
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
function renderWalls() {
  const list = shown("walls") ? state.walls.filter((w) => state.year >= w.from) : [];
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

function updateRulers() {
  const focus = [];
  for (const p of markers.polityEls) {
    p.el.querySelector(".ruler")?.remove();
    const r = shown("rulers") && rulerAt(p.name, state.year);
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
    const moving = r.kind === "campaign" || r.kind === "journey";
    const f = moving && r.to > r.from ? Math.max(0.08, (state.year - r.from + 1) / (r.to - r.from + 1)) : 1;
    const path = moving ? partialPath(r.path, f) : r.path;
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
    add(m, "event", el.classList.contains("active") ? 100 : el.classList.contains("minor") ? 50 : 60);
  }
  (markers.capitals || []).forEach((m) => add(m, "capital", 80));
  (markers.people || []).forEach((m) => add(m, "person", 70));
  (markers.inventions || []).forEach((m) => add(m, "invention", m.getElement().classList.contains("old") ? 30 : 65));
  (markers.passes || []).forEach((m) => add(m, "pass", 62));
  (markers.faith || []).forEach((m) => add(m, "faith", m.getElement().classList.contains("old") ? 29 : 64));
  markers.places.forEach((m) => add(m, "place", m.getElement().classList.contains("capital") ? 75 : m.getElement().classList.contains("r-secondary") ? 48 : m.getElement().classList.contains("r-frontier") ? 63 : 40, { fixed: true }));
  (markers.roads || []).forEach((m) => add(m, "road", 20, { fixed: true, labelOnly: true }));
  (markers.clans || []).forEach((m) => add(m, "clan", 55));
  (markers.walls || []).forEach((m) => add(m, "wall", 22, { fixed: true, labelOnly: true }));
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
  for (const p of [...markers.polityEls].sort((a, b) => b.focus - a.focus || b.area - a.area)) {
    const r = p.el.getBoundingClientRect();
    if (!r.width) continue;
    const onScreen = p.area * ppd * ppd * Math.cos((p.lat * Math.PI) / 180);
    if (!p.focus && (onScreen < r.width * r.height * (phone ? 4 : 2.5) || polities.some((t) => overlaps(r, t, pad)))) {
      p.el.classList.add("dc-hide");
      continue;
    }
    polities.push(r);
  }
  // Labels: placed in priority order; battle cards are already taken space,
  // and the territory names push away the landscape, road and route names.
  const taken = markers.armies.map((m) => m.getElement().getBoundingClientRect());
  // A label gives way to labels and icons of more important markers; it may cover a less important icon.
  for (const it of kept) {
    const span = it.labelOnly ? it.el : it.el.querySelector("span");
    const r = span?.getBoundingClientRect();
    if (r?.width) {
      const blocked = budget <= 0 || taken.some((t) => overlaps(r, t, pad)) ||
        ((it.kind === "geo" || it.kind === "road" || it.kind === "route") && polities.some((t) => overlaps(r, t)));
      // The open event's name always shows.
      if (blocked && it.prio < 100) it.el.classList.add("dc-nolabel");
      else { taken.push(r); budget--; }
    }
    if (!it.labelOnly && !it.fixed) taken.push(it.icon);
  }
  for (const it of kept) if (it.group) addGroupBadge(it);
}
function addGroupBadge(host) {
  const b = document.createElement("b");
  b.className = "dc-more";
  b.textContent = "+" + (host.group.length - 1);
  b.title = host.group.map((g) => g.el.dataset.name).join(" · ");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    const kinds = { event: t("events"), capital: t("capitals"), person: t("people_l"), invention: t("inventions"), faith: t("faith"), pass: t("passes") };
    showCard(host.m.getLngLat(), `<div class="pc-kind">${zh() ? `此处 ${host.group.length} 项` : `${host.group.length} here`}</div>
      <ul class="dc-list">${host.group.map((g, i) => `<li><button data-i="${i}"><span class="dc-ico ${esc(g.el.className.replace(/\b(dc|maplibregl)-\S+/g, ""))}">${(g.el.querySelector("i") || {}).outerHTML || ""}</span>
        <span>${esc(g.el.dataset.name || "")}<small>${esc(kinds[g.kind] || "")}</small></span></button></li>`).join("")}</ul>`);
    popup.getElement().querySelectorAll(".dc-list button").forEach((btn) =>
      btn.addEventListener("click", () => host.group[+btn.dataset.i].el.click()));
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
  // Each region shows its own events; the world view shows all.
  if (state.mode !== "world" && (ev.region || state.home) !== state.mode && !ev.also?.includes(state.mode)) return false;
  if (ev.id === state.selected) return true;
  // The country filter belongs to one period; events of other periods ignore it.
  const c = state.country;
  if (c && ev.year >= c.start && ev.year <= c.end && !(ev.states || []).includes(c.key)) return false;
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
  const cur = state.country && state.country.start === state.era.start ? state.country.key : "";
  const key = `${state.detail}|${state.cats.join()}|${state.lang}|${state.era.id}|${cur}|${state.layerData ? 1 : 0}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const cs = eventCountries();
  // Row 1: level of detail and (in multi-state periods) the country; row 2: the categories.
  const country = cs.length > 1 ? `<select id="ef-country" class="ef-country" aria-label="${t("country")}"><option value="">${zh() ? "全部国家" : "All countries"}</option>${cs.map((c) =>
      `<option value="${esc(c.key)}" ${c.key === cur ? "selected" : ""}>${esc(c.name)}${zh() ? `（${c.count}）` : ` (${c.count})`}</option>`).join("")}</select>` : "";
  box.innerHTML = `<div class="ef-top"><div class="ef-levels" role="group" aria-label="${t("detail")}">${t("levels").map((l, i) =>
      `<button data-lv="${i + 1}" aria-pressed="${state.detail === i + 1}">${l}</button>`).join("")}</div>${country}</div>
    <div class="ef-cats"><button class="chip" data-cat="" aria-pressed="${!state.cats.length}">${t("allCats")}</button>${CATS.map((c) =>
      `<button class="chip cat-${c}" data-cat="${c}" aria-pressed="${state.cats.includes(c)}">${t("cat")[c]}</button>`).join("")}</div>`;
  box.querySelectorAll("[data-lv]").forEach((b) => b.addEventListener("click", () => setEventFilter(+b.dataset.lv, state.cats)));
  $("ef-country")?.addEventListener("change", (e) => {
    state.country = e.target.value ? { key: e.target.value, start: state.era.start, end: state.era.end } : null;
    setEventFilter(state.detail, state.cats);
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
  for (const [id, m] of markers.events) {
    const ev = state.events.find((x) => x.id === id);
    const happened = ev.year <= state.year;
    // Only events current at this year (and the one opened) stay on the map; the list keeps the rest.
    if (isActive(ev, state.year) || id === state.selected) m.addTo(map); else m.remove();
    const el = m.getElement();
    const active = isActive(ev, state.year) || ev.id === state.selected;
    el.classList.toggle("active", active);
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

// City card: its role and name in this period, the years it held them and today's name.
function placeCard(p) {
  const modern = zh() ? p.modern_zh || p.modern : p.modern;
  const now = modern && modern !== (zh() ? p.name_zh : p.name) ? (zh() ? `今${modern}` : `modern ${modern}`) : "";
  return `<div class="pc-kind">${esc(t("pranks")[p.rank] || "")} · ${fmtYear(p.from, true)} – ${p.to >= 1912 ? (zh() ? "清末" : "1912") : fmtYear(p.to, true)}</div>
    <h4>${esc(nameOf(p))} <span lang="${zh() ? "en" : "zh-CN"}">${esc(zh() ? p.name : p.name_zh)}</span></h4>
    ${now ? `<p class="pc-meta">${esc(now)}</p>` : ""}${tx(p, "note") ? `<p>${esc(tx(p, "note"))}</p>` : ""}
    ${placeEventList(p)}<p class="pc-meta">${t("drafted")}</p>`;
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
    if (state.year < p.from || state.year > p.to) continue;
    const el = document.createElement("div");
    el.className = "mk-place r-" + p.rank + (p.rank === "capital" ? " capital" : "");
    el.innerHTML = zh() ? `<i></i><span>${esc(p.name_zh)}</span>` : `<i></i><span>${esc(p.name)} <em>${esc(p.name_zh)}</em></span>`;
    el.title = zh() ? `${p.name_zh}（今${p.modern_zh || p.modern}）` : `${p.name} (modern ${p.modern})`;
    el.addEventListener("click", (e) => { e.stopPropagation(); showCard([p.lon, p.lat], placeCard(p)); });
    markers.places.push(new maplibregl.Marker({ element: el, anchor: "left", offset: [-4, 0] }).setLngLat([p.lon, p.lat]).addTo(map));
  }
}

/* ---------- ledger: event list and story view ---------- */

const TABS = ["tours", "events", "rulers", "people", "world"];
function renderLedger() {
  if (!state.era) return;
  syncAuto();
  $("ev-filter").hidden = true;
  for (const k of TABS) $("tab-" + k).setAttribute("aria-selected", String(state.tab === k));
  $("rulers").hidden = state.tab !== "rulers";
  $("people").hidden = state.tab !== "people";
  $("tour-tab").hidden = state.tab !== "tours";
  $("world").hidden = state.tab !== "world";
  if (state.tab !== "events") {
    $("story").hidden = $("ev-list").hidden = true;
    return state.tab === "rulers" ? renderRulers() : state.tab === "people" ? renderPeopleTab() : state.tab === "world" ? renderWorldTab() : renderToursTab();
  }
  if (state.reading && state.selected) return renderStory();
  $("story").hidden = true;
  $("ev-list").hidden = false;
  renderList();
}

/* ---------- ledger: the same year in every region ---------- */

// Over the timeline: a few headline events from other regions near the current year, one per region, so links
// across civilisations show while scrubbing. Click one to read it (the map moves there); × hides the strip.
let stripKey = "";
function renderWorldStrip() {
  const box = $("world-strip");
  let off = false;
  try { off = localStorage.getItem("atlas-wstrip") === "0"; } catch {}
  if (off || !state.regions?.length || state.tour || cmp.on) { box.hidden = true; stripKey = ""; return; }
  const y = state.year, here = state.mode;
  const key = `${y}|${here}|${state.lang}`;
  if (key === stripKey) return;
  stripKey = key;
  const win = Math.max(10, Math.min(40, Math.round((state.era?.end - state.era?.start || 100) / 8)));
  const best = new Map();
  for (const ev of state.events) {
    const r = ev.region || "china";
    if (r === here || ev.level > 2 || Math.abs(ev.year - y) > win) continue;
    const score = ev.level * win + Math.abs(ev.year - y);
    if (!best.has(r) || score < best.get(r).score) best.set(r, { ev, score });
  }
  const picks = [...best.values()].sort((a, b) => a.score - b.score).slice(0, 4).map((x) => x.ev).sort((a, b) => a.year - b.year);
  if (!picks.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<span class="ws-head">${esc(t("elsewhere"))}</span>` + picks.map((ev) => {
    const r = state.regionById[ev.region || "china"];
    return `<button type="button" data-ev="${esc(ev.id)}" style="--rc:${esc(r?.seal || r?.color || "#888")}" title="${esc(tx(ev, "summary"))}"><i></i><b>${esc(r ? (zh() ? r.short_zh || r.name_zh : r.short || r.name) : "")}</b><span>${fmtYear(ev.year)}</span> ${esc(zh() ? ev.title_zh || ev.title : ev.title)}</button>`;
  }).join("") + `<button type="button" class="ws-x" aria-label="${esc(t("hideStrip"))}" title="${esc(t("hideStrip"))}">×</button>`;
}

function regionEra(r, y) { return r.eras.find((e) => y >= e.start && y <= e.end); }
function renderWorldTab() {
  const box = $("world"), y = state.year;
  const key = `${y}|${state.lang}|${state.mode}`;
  $("ev-count").textContent = fmtYear(y);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const rows = state.regions.map((r) => {
    const era = regionEra(r, y);
    // The biggest events within 30 years, nearest first.
    const evs = state.events.filter((ev) => ((ev.region || "china") === r.id || ev.also?.includes(r.id)) && Math.abs(ev.year - y) <= 30)
      .sort((a, b) => Math.abs(a.year - y) - Math.abs(b.year - y) || a.level - b.level).slice(0, 3).sort((a, b) => a.year - b.year);
    return `<li class="wd-row${r.id === state.mode ? " here" : ""}" style="--rc:${esc(r.color || "#888")}">
      <button type="button" class="wd-head" data-r="${esc(r.id)}"><b>${esc(nameOf(r))}</b><span>${era ? esc(nameOf(era)) : ""}</span></button>
      <p class="wd-rulers" data-era="${era?.layers ? esc(era.id) : ""}"></p>
      ${evs.length ? `<ul class="wd-ev">${evs.map((ev) => `<li><button type="button" data-ev="${esc(ev.id)}"><span>${fmtYear(ev.year)}</span> ${esc(zh() ? ev.title_zh || ev.title : ev.title)}</button></li>`).join("")}</ul>`
        : `<p class="wd-none">${t("noWorldEv")}</p>`}</li>`;
  });
  let stripOff = false;
  try { stripOff = localStorage.getItem("atlas-wstrip") === "0"; } catch {}
  box.innerHTML = `<p class="rl-hint">${t("worldHint")}</p>` + (stripOff ? `<button type="button" class="chip ws-on" id="ws-on">${esc(t("showStrip"))}</button>` : "") + `<ol class="wd-list">${rows.join("")}</ol>`;
  $("ws-on")?.addEventListener("click", () => {
    try { localStorage.removeItem("atlas-wstrip"); } catch {}
    box.dataset.key = ""; renderWorldTab(); renderWorldStrip();
  });
  box.querySelectorAll(".wd-head").forEach((b) => b.addEventListener("click", () => goRegion(b.dataset.r)));
  box.querySelectorAll("[data-ev]").forEach((b) => b.addEventListener("click", () => openStory(b.dataset.ev)));
  // Who ruled where: the main countries with a ruler this year, filled in as each region's layer file arrives.
  box.querySelectorAll(".wd-rulers").forEach((p, i) => {
    const era = regionEra(state.regions[i], y);
    if (!era?.layers) return;
    loadLayers(era).then((L) => {
      if (box.dataset.key !== key) return;
      const pol = L.polities || {};
      const names = Object.keys(L.rulers || {}).sort((a, b) => !!pol[b]?.focus - !!pol[a]?.focus);
      const out = [];
      for (const n of names) {
        const r = (L.rulers[n] || []).findLast((r) => y >= r.from && y <= r.to);
        if (r) out.push(`${esc(zh() ? pol[n]?.name_zh || n : n)}：${esc(rulerText(r)[0])}`);
        if (out.length === 3) break;
      }
      p.innerHTML = out.join(" · ");
    });
  });
}
function goRegion(id) {
  const reg = state.regionById[id];
  if (!reg) return;
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
function toggleLangPop(open) {
  const pop = $("lang-pop"), btn = $("lang");
  open ??= pop.hidden;
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", open);
  if (!open) return;
  pop.innerHTML = LANGS.map((l) => `<button type="button" role="menuitemradio" aria-checked="${l.id === state.lang}" data-lang="${l.id}" lang="${l.html}"><b>${esc(l.name)}</b><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.3 2.2L9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>`).join("");
  // Placed under the button, inside the panel that holds both.
  const r = btn.getBoundingClientRect(), o = pop.offsetParent.getBoundingClientRect();
  pop.style.top = `${r.bottom - o.top + 6}px`;
  pop.style.right = `${Math.max(0, o.right - r.right)}px`;
  pop.querySelector('[aria-checked="true"]')?.focus();
}

function toggleRegionPop(open) {
  const pop = $("region-pop"), btn = $("region-btn");
  open ??= pop.hidden;
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", open);
  if (!open) return;
  const y = state.year;
  const row = (id, color, name, sub, full = name) => `<button type="button" role="menuitem" data-r="${esc(id)}" title="${esc(full)}" class="${id === state.mode ? "here" : ""}" style="--rc:${esc(color)}"><i></i><b>${esc(name)}</b><span>${esc(sub)}</span></button>`;
  pop.innerHTML = state.regions.map((r) => { const era = regionEra(r, y); return row(r.id, r.color || "#888", zh() ? r.short_zh || r.name_zh : r.short || r.name, era ? nameOf(era) : "", nameOf(r)); }).join("")
    + row("world", "#777", t("allWorld"), fmtYear(y))
    + `<button type="button" role="menuitem" class="rp-cmp" id="rp-cmp"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="5.5" height="10" rx="1"/><rect x="9" y="3" width="5.5" height="10" rx="1"/></svg>${esc(t("cmp").one)}</button>`;
  $("rp-cmp").addEventListener("click", () => { toggleRegionPop(false); openCompare(); });
  pop.querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => {
    toggleRegionPop(false);
    if (b.dataset.r !== "world") return goRegion(b.dataset.r);
    setMode("world");
    map.flyTo({ center: [60, 30], zoom: innerWidth <= 720 ? 0.6 : 1.4, pitch: 0, bearing: 0, duration: 1400 });
    renderLedger();
  }));
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
      const sat = state.showSat;
      cmp.map.setLayoutProperty("satellite", "visibility", sat ? "visible" : "none");
      cmp.map.setPaintProperty("bg", "background-color", sat ? "#1d4f86" : "#9db8bf");
      cmp.map.setPaintProperty("lakes", "fill-opacity", sat ? 0 : 0.9);
      if (!state.showGeo) for (const l of ["rivers", "rivers-minor", "lakes"]) cmp.map.setLayoutProperty(l, "visibility", "none");
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
  const all = [...(state.layerData?.people || [])].sort((a, b) => personSpan(a)[0] - personSpan(b)[0]);
  const g = state.peopleGroup || "all";
  const list = g === "all" ? all : all.filter((p) => PGROUP[p.field] === g);
  $("ev-count").textContent = all.length ? t("rulerCount")(list.length) : "";
  if (!all.length) { box.innerHTML = `<p class="rl-empty">${t("noPeople")}</p>`; box.dataset.key = ""; return; }
  const key = `${state.era.id}|${state.lang}|${g}`;
  if (box.dataset.key !== key || box._data !== state.layerData) {
    box.dataset.key = key;
    box._data = state.layerData;
    box._list = list;
    const groups = ["all", ...["mil", "pol", "cul", "art", "sci"].filter((k) => all.some((p) => PGROUP[p.field] === k))];
    box.innerHTML = `<div class="pp-groups">${groups.map((k) =>
        `<button class="chip" data-g="${k}" aria-pressed="${k === g}">${t("pgroups")[k]}</button>`).join("")}</div>
      <p class="rl-hint">${t("peopleHint")}</p><ol class="rl-list">${list.map((p, i) =>
      `<li><button class="rl pp f-${esc(p.field)}" data-i="${i}"><span class="rl-years">${p.born != null ? fmtYear(p.born, p.circa) : "?"}<br>${p.died != null ? fmtYear(p.died, p.circa) : p.born != null ? (zh() ? "今" : "now") : "?"}</span>
        <span class="rl-name">${esc(nameOf(p))}</span><span class="rl-sub">${esc(tx(p, "known_for"))}</span><span class="rl-len">${esc(t("fields")[p.field] || "")}</span></button></li>`).join("")}</ol>`;
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
    ${illuSlot("e:" + ev.id)}
    <p class="story-lede">${esc(tx(ev, "summary"))}</p>
    <div class="story-body"><p class="muted">${t("loading")}</p></div>`;
  box.scrollTop = 0;
  fillIllus(box);
  box.onclick = (e) => {
    const go = e.target.closest("[data-go]")?.dataset.go;
    if (go === "back") { state.reading = false; $("app").classList.remove("tour-reading"); renderLedger(); }
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
    return all.find((p) => ev.year >= p.from && ev.year <= p.to) || all[0];
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
// The atlas's own tours and the pack's (marked with the pack's region), or the pack's alone.
const loadTours = () => tours || (tours = Promise.all([
  state.pack?.only ? [] : loadJSON("data/tours.json").catch(() => []),
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
  return `<button type="button" class="tour-item${on ? " on" : ""}" data-tour="${tr.id}"><b>${esc(tx(tr, "title"))}</b><span>${fmtYear(tr.start)}–${fmtYear(tr.end)} · ${t("tourSteps")(tr.steps.length)}${home ? ` · ${esc(nameOf(home))}` : ""}</span><small>${esc(tx(tr, "summary"))}</small></button>`;
}
async function renderToursTab() {
  const list = await loadTours();
  if (state.tab !== "tours") return;
  const box = $("tour-tab");
  // This region's tours for the period on screen, then its other periods, then the other regions.
  const reg = state.mode === "world" ? null : state.era.region || state.mode;
  const here = list.filter((tr) => reg && tourRegion(tr) === reg && tourIn(tr, state.era)).sort((a, b) => a.start - b.start);
  $("ev-count").textContent = t("tourCount")(here.length);
  const key = `${state.mode}|${state.era.id}|${state.lang}|${state.tour?.id || ""}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  let html = `<p class="rl-hint">${t("tourHint")}</p>`;
  html += here.length ? here.map((tr) => tourItem(tr, state.era)).join("") : `<p class="rl-empty">${t("noTours")}</p>`;
  const group = (title, groups) => {
    groups = groups.filter(([, l]) => l.length);
    if (!groups.length) return "";
    const n = groups.reduce((k, [, l]) => k + l.length, 0);
    return `<details class="tour-more" data-g="${esc(title)}"${box.querySelector(`details[data-g="${title}"]`)?.open ? " open" : ""}><summary>${esc(title)}${zh() ? "（" : " ("}${n}${zh() ? "）" : ")"}</summary>` +
      groups.map(([h, l]) => `<h5>${esc(h)}</h5>` + l.map((tr) => tourItem(tr)).join("")).join("") + `</details>`;
  };
  if (reg) html += group(t("toursOther"), regionEras(reg).filter((e) => e.id !== state.era.id).map((e) => [nameOf(e), list.filter((tr) => tourRegion(tr) === reg && tourEra(tr) === e.id)]));
  for (const r of state.regions) if (r.id !== reg) {
    const l = list.filter((tr) => tourRegion(tr) === r.id).sort((a, b) => a.start - b.start);
    html += group(nameOf(r), regionEras(r.id).map((e) => [nameOf(e), l.filter((tr) => tourEra(tr) === e.id)]));
  }
  box.innerHTML = html + `<p class="tour-note">${t("drafted")}</p>`;
}
async function startTour(id, i = 0) {
  const tr = (await loadTours()).find((x) => x.id === id);
  if (!tr) return;
  stop(); closeSearch();
  state.tour = { id, tr, i: 0, auto: false };
  setMode(tourRegion(tr));
  $("tour").hidden = false;
  $("app").classList.add("touring");
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
  // Draw the journey so far.
  const src = map.getSource("tour");
  if (src) {
    const pts = tr.path ? tr.steps.slice(0, i + 1).map((x) => x.at) : [];
    src.setData({ type: "FeatureCollection", features: [
      ...(pts.length > 1 ? [{ type: "Feature", properties: { kind: "path" }, geometry: { type: "LineString", coordinates: pts } }] : []),
      ...tr.steps.slice(0, i + 1).map((x, k) => ({ type: "Feature", properties: { kind: "stop", now: k === i ? 1 : 0, n: k + 1 }, geometry: { type: "Point", coordinates: x.at } })),
    ] });
  }
  tourCard();
  state.selected = s.event || null;
  state.reading = false;
  if (state.zoom && !inWindow(s.year)) { state.scope = null; state.win = windowFor(state.zoom, s.year); refreshTimeline(); }
  map.flyTo({ center: s.at, zoom: s.zoom ?? 4.8, pitch: state.show3d ? s.pitch ?? 48 : 0, bearing: s.bearing ?? -8,
    padding: tourPadding(), duration: 2600, essential: true });
  emit("tour-step", { id: tour.id, index: i, step: s, steps: tr.steps, path: !!tr.path });
  await setYear(s.year);
  if (state.tour === tour && tour.i === i) tourHighlight(s);
  renderArmies();
  renderLedger();
  saveView();
  if (tour.auto) map.once("moveend", () => { if (state.tour === tour && tour.auto) tour.timer = setTimeout(() => tourNext(), 3000 + tx(s, "text").length * (zh() ? 110 : 45)); });
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
}
// Keep the spot clear of the tour card at the bottom and the ledger on the right.
function tourPadding() {
  if (EMBED) return { top: 50, bottom: 30, left: 30, right: 30 };
  const phone = innerWidth <= 720;
  const card = $("tour").offsetHeight || 160;
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
  $("tour").querySelector(".tour-auto").textContent = t("tourPlay");
}
function endTour() {
  if (!state.tour) return;
  clearTimeout(state.tour.timer);
  state.tour = null;
  $("tour").hidden = true;
  $("app").classList.remove("touring", "tour-reading");
  if (state.tab === "tours") renderToursTab();
  map.getSource("tour")?.setData({ type: "FeatureCollection", features: [] });
  tourHighlight(null);
  emit("tour-end", {});
  syncAuto();
  renderArmies();
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  saveView();
}
function addTourLayers() {
  map.addSource("tour", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "tour-path", type: "line", source: "tour", filter: ["==", ["get", "kind"], "path"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#b93a26", "line-width": 3, "line-dasharray": [2, 1.5], "line-opacity": 0.9 } });
  map.addLayer({ id: "tour-stops", type: "circle", source: "tour", filter: ["==", ["get", "kind"], "stop"],
    paint: { "circle-radius": ["case", ["==", ["get", "now"], 1], 8, 4.5], "circle-color": ["case", ["==", ["get", "now"], 1], "#b93a26", "#fff6f2"],
      "circle-stroke-color": "#b93a26", "circle-stroke-width": 2 } });
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
    out.push({ g: "era", year: e.start, title: nameOf(e), sub: `${nameOf(r)} · ${fmtYear(e.start)} – ${fmtYear(e.end)}`, go: () => goToEra(e) });
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
    for (const list of searchIndex.cities.filter((l) => l.some((c) => has(c.name_zh, c.name, c.modern_zh, c.modern))).slice(0, 8)) {
      const c = list.find((c) => has(c.name_zh, c.name)) || list[0];
      out.push({ g: "city", year: c.from, title: nameOf(c), sub: zh() ? `今${c.modern_zh || c.modern}` : `modern ${c.modern}`, go: () => jumpToCity(c) });
    }
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
async function openSearch() {
  $("search").hidden = false;
  $("search-q").placeholder = t("searchPh");
  $("search-q").focus();
  $("search-q").select();
  if (!searchIndex) { searchIndex = await buildSearchIndex(); renderSearch(); }
}
function closeSearch() { $("search").hidden = true; }
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
function hideScrubTag() {
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
const pagedRail = () => state.zoom === 0 && innerWidth <= 720;
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
function buildRail() {
  sizeTrack();
  requestAnimationFrame(() => { fitBandLabels(); revealYear(false); });
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
      b.title = `${nameOf(e)} ${fmtYear(e.start)} – ${fmtYear(e.end)} · ${t("lasted")(eraYears(e))}`;
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
        b.title = tx(s, "label") || `${nameOf(e)} ${fmtYear(e.start)} – ${fmtYear(e.end)}`;
        b.addEventListener("click", () => { stop(); setYear(from); });
        bands.appendChild(b);
      });
    }
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
function play() {
  if (state.playing) return stop();
  if (state.year >= state.range.end) setYear(state.range.start);
  state.selected = null;
  state.reading = false;
  $("play-icon").innerHTML = '<path d="M3 2h4v12H3zM9 2h4v12H9z"/>';
  $("play").setAttribute("aria-label", t("pause"));
  state.playing = setInterval(() => {
    if (state.year >= state.range.end) return stop();
    const era = state.era;
    const len = state.zoom === 2 ? state.win[1] - state.win[0] + 1 : era.end - era.start + 1;
    const step = Math.max(1, Math.round(len / 50));
    let next = Math.min(state.year + step, state.range.end);
    if (next > era.end && era.end >= state.year) next = era.end + 1; // land on the next era's first year
    const hit = state.events.filter((e) => shownEvent(e) && e.year > state.year && e.year <= next).pop();
    if (hit) state.selected = hit.id;
    setYear(next).then(() => { if (hit) renderLedger(); });
  }, state.zoom === 2 ? 450 : 260);
}
function stop() {
  clearInterval(state.playing);
  state.playing = null;
  $("play-icon").innerHTML = '<path d="M4 2l10 6-10 6z"/>';
  $("play").setAttribute("aria-label", t("play"));
}

function toggle(btnId, key, fn) {
  $(btnId).setAttribute("aria-pressed", String(state[key]));
  $(btnId).addEventListener("click", () => {
    state[key] = !state[key];
    $(btnId).setAttribute("aria-pressed", String(state[key]));
    try { localStorage.setItem("atlas-toggles", JSON.stringify({ show3d: state.show3d, showNeighbours: state.showNeighbours, showPlaces: state.showPlaces, showGeo: state.showGeo })); } catch {}
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
    const view = { year: state.year, zoom: state.zoom, win: state.win, tab: state.tab,
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
  if (tg) for (const k of ["show3d", "showNeighbours", "showPlaces", "showGeo"]) if (typeof tg[k] === "boolean") state[k] = tg[k];
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
  return v.cam && Array.isArray(v.cam.center) ? v.cam : null;
}

// Home Screen app: a service worker keeps what has been viewed for offline use (not inside embeds or the preview).
if ("serviceWorker" in navigator && location.protocol === "https:" && !/[?&]embed=1/.test(location.search) && !location.hostname.endsWith("claude.ai") && !location.hostname.endsWith("claudeusercontent.com"))
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

async function init() {
  try { const l = localStorage.getItem("atlas-lang"); if (langOk(l)) state.lang = l; } catch {}
  try { const f = JSON.parse(localStorage.getItem("atlas-events") || "null"); if (f) { state.detail = f.detail || 2; state.cats = f.cats || []; } } catch {}
  try { state.showSat = localStorage.getItem("atlas-look") !== "relief"; } catch {}
  const q = new URLSearchParams(location.search).get("lang");
  if (langOk(q)) state.lang = q;
  const hl = new URLSearchParams(location.hash.slice(1)).get("l");
  if (langOk(hl)) state.lang = hl;
  // A link pasted into the same tab only changes the hash: start again from it.
  addEventListener("hashchange", () => { if (map && location.hash.length > 1) location.reload(); });
  if (PACK_URL) {
    state.pack = await openPack(PACK_URL);
    state.selected = null;
  }
  applyLang();
  const plugins = importPlugins();
  plugins.forEach((p) => p.catch(() => {}));  // reported once the map is up
  const pack = state.pack?.manifest, only = state.pack?.only;
  const [eras, events, places, packEras, packEvents] = await Promise.all([
    only ? { eras: [] } : loadJSON("data/eras.json"), only ? [] : loadJSON("data/events.json"), only ? [] : loadJSON("data/places.json"),
    pack && packFile("eras"), pack && packFile("events"),
  ]);
  // The atlas's own overlays (population, faith, inventions, passes, roads, clans, walls, exchange) stay out of a pack shown alone.
  if (!only) {
    state.overlays = await loadJSON("data/overlays.json").catch(() => state.overlays);
    state.passes = await loadJSON("data/passes.json").catch(() => []);
    state.roads = await loadJSON("data/roads.json").catch(() => []);
    state.clans = await loadJSON("data/clans.json").catch(() => []);
    state.walls = await loadJSON("data/walls.json").catch(() => []);
    state.exchange = await loadJSON("data/exchange.json").catch(() => state.exchange);
  }
  state.geo = await loadJSON("data/geo/features.json").catch(() => []);
  state.oldGeo = (await loadJSON("data/geo/old-rivers.geojson").catch(() => ({ features: [] }))).features;
  const [regions, worldIndex] = await Promise.all([
    loadJSON("data/regions.json").catch(() => ({ regions: [] })), loadJSON("data/world/index.json").catch(() => [])]);
  if (!only) setupRegions(eras, regions.regions, worldIndex);
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
    for (const g of document.querySelectorAll(".era-layers .lg")) g.hidden = ![...g.querySelectorAll(".chip")].some((c) => !c.hidden);
  }
  state.events = events.sort((a, b) => a.year - b.year || (a.level || 1) - (b.level || 1));
  state.places = places;
  buildScale();
  const cam = loadView();
  if (only && !["events", "tours"].includes(state.tab)) state.tab = "events";

  map = new maplibregl.Map({
    container: "map",
    style: buildStyle(),
    center: cam?.center || pack?.region?.view?.center || [108, 33.5], zoom: cam?.zoom ?? pack?.region?.view?.zoom ?? 3.7, pitch: state.show3d ? cam?.pitch ?? 52 : 0, bearing: cam?.bearing ?? -8,
    maxPitch: 65, minZoom: 1.6, maxZoom: 9.5,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true,
    customAttribution: "Terrain: Mapzen/AWS Terrain Tiles · Borders: Cliopatria/Seshat (CC BY 4.0), historical-basemaps (GPL-3.0)" + (pack?.attribution ? ` · ${esc(pack.attribution)}` : "") }), "bottom-left");
  // MapLibre opens the compact attribution on wide screens; start it folded to the "i" button.
  const foldAttribution = () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  map.once("load", foldAttribution);
  map.once("idle", foldAttribution);
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
  map.on("mouseenter", "road-hit", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "road-hit", () => (map.getCanvas().style.cursor = ""));
  map.on("moveend", () => { scheduleDeclutter(); saveView(); if (!state.tour && state.ready) setMode(detectRegion()); });
  map.on("zoomend", setTerrainForZoom);
  map.on("load", async () => {
    setTerrainForZoom();
    applyLook();
    renderGeo();
    // Switches remembered from the last visit that the style starts with on.
    if (!state.showNeighbours) for (const id of ["neighbour-fill", "neighbour-line"]) map.setLayoutProperty(id, "visibility", "none");
    if (!state.showGeo) for (const id of ["rivers", "rivers-minor", "lakes"]) map.setLayoutProperty(id, "visibility", "none");
    addTourLayers();
    if (state.pack) await startPlugins(plugins);
    setMode(detectRegion(), true);
    renderRegionBtn();
    state.ready = true;
    await setYear(state.year);
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
    hideScrubTag();
    const y = posToYear(+e.target.value);
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
      if (!s.onButton) setYear(posToYear(posAt(e.clientX)));
      return;
    }
    hideScrubTag();
    // Swallow the click that follows the drag, so the band under the finger doesn't also fire.
    addEventListener("click", (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true });
    setTimeout(() => setYear(s.year), 0);
  });
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
    if (e.target.closest(".ws-x")) {
      try { localStorage.setItem("atlas-wstrip", "0"); } catch {}
      $("world").dataset.key = "";
      if (state.tab === "world") renderWorldTab();
      return renderWorldStrip();
    }
    const id = e.target.closest("[data-ev]")?.dataset.ev;
    if (id) openStory(id);
  });
  $("lang").addEventListener("click", (e) => { e.stopPropagation(); toggleLangPop(); });
  $("lang-pop").addEventListener("click", (e) => {
    const l = e.target.closest("[data-lang]")?.dataset.lang;
    toggleLangPop(false);
    if (l && l !== state.lang) setLang(l);
  });
  document.addEventListener("click", (e) => { if (!$("lang-pop").hidden && !e.target.closest("#lang-pop")) toggleLangPop(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("lang-pop").hidden) { toggleLangPop(false); $("lang").focus(); } });
  addEventListener("resize", () => toggleLangPop(false));
  toggle("t-3d", "show3d", () => {
    state.terrainExag = null;
    if (state.show3d) setTerrainForZoom(); else map.setTerrain(null);
    map.easeTo({ pitch: state.show3d ? 52 : 0, duration: 800 });
  });
  toggle("t-sat", "showSat", () => {
    try { localStorage.setItem("atlas-look", state.showSat ? "sat" : "relief"); } catch {}
    applyLook();
  });
  toggle("t-neighbours", "showNeighbours", () => {
    const v = state.showNeighbours ? "visible" : "none";
    map.setLayoutProperty("neighbour-fill", "visibility", v);
    map.setLayoutProperty("neighbour-line", "visibility", v);
    renderPolityLabels(state.borders[state.snapshot]);
  });
  toggle("t-places", "showPlaces", renderPlaces);
  toggle("t-geo", "showGeo", () => {
    renderGeo();
    for (const id of ["rivers", "rivers-minor", "lakes"]) map.setLayoutProperty(id, "visibility", state.showGeo ? "visible" : "none");
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
  const collapseLedger = (c) => {
    $("ledger").classList.toggle("collapsed", c);
    $("ledger-toggle").textContent = c ? t("show") : t("hide");
    $("ledger-toggle").setAttribute("aria-expanded", String(!c));
  };
  for (const k of TABS) $("tab-" + k).addEventListener("click", () => {
    // The open story survives a look at the other tabs; the events tab clicked again goes back to the list.
    if (k === "events" && state.tab === "events") state.reading = false;
    state.tab = k;
    saveView();
    collapseLedger(false);
    renderLedger();
  });
  $("region-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleRegionPop(); });
  document.addEventListener("click", (e) => { if (!$("region-pop").hidden && !e.target.closest("#region-pop")) toggleRegionPop(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("region-pop").hidden) toggleRegionPop(false); });
  $("search-open").addEventListener("click", openSearch);
  $("share-open").addEventListener("click", shareView);
  $("tour-tab").addEventListener("click", (e) => { const b = e.target.closest("[data-tour]"); if (b) startTour(b.dataset.tour); });
  const tb = $("tour");
  tb.querySelector(".tour-prev").addEventListener("click", () => state.tour && tourStep(state.tour.i - 1));
  tb.querySelector(".tour-next").addEventListener("click", tourNext);
  tb.querySelector(".tour-close").addEventListener("click", endTour);
  tb.querySelector(".tour-story").addEventListener("click", () => { const s = state.tour?.tr.steps[state.tour.i]; if (s?.event) { tourPause(); $("app").classList.add("tour-reading"); openStory(s.event); } });
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
  $("ledger-toggle").addEventListener("click", () => $("app").classList.contains("tour-reading") ? $("app").classList.remove("tour-reading") : collapseLedger(!$("ledger").classList.contains("collapsed")));
  const phone = matchMedia("(max-width: 720px)");
  if (phone.matches) collapseLedger(true);
  // Phone: tools and layer switches sit behind one button; the sheet and era bar size themselves to the timeline.
  const openEra = (o) => { $("era-more").setAttribute("aria-expanded", String(o)); document.querySelector(".era").classList.toggle("open", o); };
  // On wide screens the same button folds the layer switches and period notes away (remembered).
  $("era-more").addEventListener("click", () => phone.matches ? openEra(!document.querySelector(".era").classList.contains("open")) : setLean(!state.lean, true));
  try { setLean(localStorage.getItem("atlas-lean") === "1"); } catch { setLean(false); }
  map.on("click", () => { if (phone.matches) openEra(false); });
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--rail-h", document.querySelector(".rail").offsetHeight + "px");
    sizeTrack();
    fitBandLabels();
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
