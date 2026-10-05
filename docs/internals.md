# How the atlas works

Notes for working on the atlas itself: where the built-in data lives, how it is built, and the known limits. To use the
atlas with your own data, see [custom-data.md](custom-data.md) and [plugins.md](plugins.md).

## World view and regions

The map can be moved anywhere on the globe. The timeline follows the civilisation region that fills the view (`detectRegion()` in `app.js` samples a grid of points, weighted to the middle, against the region outlines): over Europe it shows Europe's periods, over India India's, and so on. When the view spans several regions, or only sea and unassigned land, the timeline runs on calendar-year bands (`state.worldEras`) instead. A region keeps the timeline while it still holds about a third of the sampled land. Tours always switch to China. Search finds the periods of every region and flies there.

| Path | What it holds |
| --- | --- |
| `data/regions.json` | 14 regions (china, korea, japan, southeast-asia, south-asia, central-asia-steppe, iran, middle-east, egypt-north-africa, europe, sub-saharan-africa, north-america, mesoamerica, south-america), each with a rough `polygon` (no overlaps; gaps such as Siberia, Australia and the Sahara interior fall back to calendar years) and `periods` that tile 3000 BCE to 2026 with `name`, `name_zh`, `glyph`, `short`, `tiny`, summaries and `focus`, the historical-basemaps polity names drawn as the main states. `groups` above the regions (东亚: china, korea, japan; 西亚与北非; 美洲…) only order the region menu under headings (each region there opens its rulers, events and countries in the current year; this replaced the 世界 tab); the timeline belongs to regions. A region is a geographic area at one level (中国与东亚大陆, 欧洲与地中海); where one state held an area most of the time its periods are that state's dynasties. A period that is only part of a longer-lived state carries `entity` (the lineage id; see `tools/check_eras.py`) and the era panel adds the state's own years; `since`/`until` give the years shown when they differ from `start`/`end` by a year. The china region lists the 20 eras of `eras.json` by id plus 新石器时代晚期, 中华民国 and 中华人民共和国. AI-drafted, not source-checked. |
| `data/world/` | 124 world border maps (3000 BCE to 2024), built by `tools/build_world.py` from Cliopatria (states, sampled at the years they change: every 100 years at most before 1000 BCE, 50 before 1 CE, 25 before 1500, 20 before 1800, 10 after) with land no state holds filled from the nearest historical-basemaps snapshot; a Cliopatria polity covering mostly the same land as a historical-basemaps feature takes that name (plus the `ALIASES` table), so `focus` lists and rulers keep matching: `<year>.json` for the whole world and, for years inside China's dynasties, `<year>-outer.json` with the East Asia window of the dynasty maps cut out. `index.json` lists them. Chinese names come from `names_zh.json` (about 2,900 names, AI-translated; small peoples are often transliterations) and the dynasty maps. |

Inside China's dynasty years (2070 BCE to 1912) the map always shows the dynasty map with the outer world map around it; other years and periods outside China use the whole world map. Events now cover every region: about 1,700 events outside China across the 13 other regions, besides China's own. Region events carry a `region` field (and `also` when they belong to two regions, e.g. 卡迭石战役 for Egypt and the Middle East); each region's list shows only its own events, the calendar-year view shows all of them, and opening an event switches the timeline to its region. They are merged with `tools/merge_region_events.py <batch.json> ...` (summary only, no long story, no city or person links; AI-drafted, not source-checked). Rulers, people and tours are still China's only. A region event that repeats one of China's (白江口之战, 鉴真东渡) folds into the China event's `also`. `tools/check_links.py`, run on GitHub by `.github/workflows/links.yml` (Wikipedia is blocked on the build machine), checks every Wikipedia source link and writes a report to the `link-check` branch; `tools/apply_links.py <links.json>` then rewrites redirected titles, fixes near-identical misspellings, adds `source_zh` (the Chinese Wikipedia page, used in Chinese mode) and lists what it could not fix in `tools/link_fixes.json`. First run: 3,612 links, 3,927 entries got a Chinese link, 291 links still point to missing or disambiguation pages (they open as a Wikipedia search).

## Run it

It is a static site with no build step and no API keys.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly from disk will not work, because the browser blocks `fetch()` of local files.

The page opens in Chinese; the English button (or `?lang=en`) switches language and the choice is remembered. Every text field has an English and a Chinese version.

The timeline has three zoom levels (+/− buttons, the mouse wheel over the rail, or the + and − keys): all of history, one dynasty (each segment is one border map), and a few decades.

Above the event list a filter picks the detail level (大事 key events only, 要事 adds major ones, 细目 shows all) a country when the period has several (国家, from each event's `states`), and topic tags (战争, 政治, 改革, 起义, 外交, 经济, 文化, 科技, 社会; several may be on). It applies to the list, the map and the timeline ticks, and is remembered in the browser (`localStorage` key `atlas-events`). The browser also remembers the language (`atlas-lang`), layers (`atlas-layers`), map switches (`atlas-toggles`, `atlas-look`) and where the visitor was: year, timeline zoom, ledger tab and camera (`atlas-view`). A first visit opens at 770 BCE.

Three map layers can be switched on and off: 君主 (the ruler under each country's name, and in the era card), 军队 (a card at each battle site with the sides, generals, troop numbers, unit types and result), and 路线 (campaigns, journeys, trade routes, canals and walls). Four more layers are off by default: 名人 (thinkers, poets, scientists and others shown while alive, with a card), 都城·人口 (capitals with a star, and a population chart in the era card), 宗教思想 (temples, grottoes, academies and schools, which stay on the map once founded) and 发明 (inventions, likewise cumulative). Troop numbers are mostly the traditional figures from the histories and are often inflated; the cards say so.

## How it is put together

| Path | What it holds |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The page. MapLibre GL JS 5.24 is loaded from jsDelivr. |
| `data/eras.json` | Eras from Xia to Qing: year range (negative = BCE), glyph, summary (and `summary_zh`), an optional caveat `note`, and `snapshots`, a list of border files with the year each takes over. |
| `data/events.json` | Events: year (and optional `endYear`), coordinates, English and Chinese title, place and summary (`x` and `x_zh`), Wikipedia link, a `category` (war, politics, reform, rebellion, diplomacy, economy, culture, science, society) and a `level` (1 key, 2 major, 3 detail) used by the event filter, plus links: `places` (city ids, a places.json id without its `-N`), `people` (person ids from the layers) and `states` (polity keys of the period, as in the layer's `polities`). City cards, person cards and the 国家 filter are built from these links, so new events show up there automatically. 1,654 events. |
| `data/details/<era>.json` | The story view for each event, loaded when its era opens: `story`/`story_zh` paragraphs, `why`/`why_zh`, `people`, an optional classical `quote`, and `source_zh` (Chinese Wikipedia). |
| `data/layers/<era>.json` | Map overlays, loaded per era and switched on and off under 图层 / Layers: `rulers` (polity `name` as in the border files → reigns with `from`/`to`), `armies` (war event id → sides with commanders, troops, unit types and result) and `routes` (campaigns, journeys, trade routes, canals and walls as lines with the years they show; campaigns and journeys grow along their path year by year). Built from batches in `data/work2/` by `tools/merge_layers.py`; `people` and `capitals` are added from `data/work3/` by `tools/merge_overlays.py`. |
| `data/layers/world-<region>.json` | Rulers and people for the other 13 regions, one bundle per region keyed by period id (the artifact caps its file count). Same shape as the China layer files, but a ruler carries `rank`/`rank_zh` (国王, 苏丹) instead of a title, so the name leads. Periods with a bundle entry have `"layers": true` in `data/regions.json`. AI-drafted by period, merged and de-duplicated across regions (people already in China's layers are dropped). |
| `data/countries.json` | Built by `tools/build_countries.py`. `spans`: for every polity name on the maps (China's dynasty maps inside 前2070–1912, the world maps elsewhere), the runs of years it is on the map, `[from, to, name_zh, region]`; one run is one country, so the same name centuries apart, or under another Chinese name (晋, 金), is another. `lineages` is copied from `data/lineages.json`: 152 countries whose map name changes (Kingdom of Wessex → England → Kingdom of Great Britain → United Kingdom; Ming / Southern Ming), with an optional `from`/`to` window; a name given as `["China", 1945, 1948]` belongs to the country only in those years (中华民国 is "China" on the maps until 1948, then the PRC is). Every country is dated (`start`, `end`, null = today); 428 entries. `periods` is copied from `data/country-periods.json`: a country's own periods (England: 都铎, 斯图亚特, 维多利亚…), keyed by lineage id and tiling its years; while that country is selected the timeline runs on them, and the region's periods continue before and after. AI-drafted. The same script gives events without hand-made `states` the polity holding their place in their year plus polities of that year named in the text (`"statesBy": "geo"`), and gives every person `states` (the polity holding their home in their working years plus the states of their events). Rerun it after changing maps, events or people. |
| `data/exchange.json` | Cross-civilisation layer, shown in every region: `routes` (57 trade routes, journeys and campaigns, same shape as layer routes; `supersedes` hides the China-only route it extends), `topics` (32 faiths, techniques and crops with colour and `group` faith/tech/crop) and `spread` (233 legs, each growing from `start` to `year`, then a faint line with a dot for 300 years). Paths cross the dateline as a `[180, lat]`, `[-180, lat]` pair. Toggled by 交流 / 传播 under 交通. AI-drafted, not source-checked. |
| `data/overlays.json` | Overlays that build up over time and are loaded once: `population` (census figures and estimates), `faith` (religious sites and schools of thought) and `inventions`. Built by `tools/merge_overlays.py`. |
| `tools/link_events.py` | Fills `places`, `people` and `states` for events that lack them (`--all` recomputes every event, e.g. after adding cities or people; `"linked": "hand"` protects a hand-edited event). Cities by distance and place name, people by Chinese name within their lifetime, countries by the border map at that year plus country names in the text. `merge_events.py` runs it after each merge. |
| `tools/merge_events.py` | `python3 tools/merge_events.py <dir>` adds batches of events (`<era-id>.json` lists) to `events.json`, checking category, level, year, coordinates and duplicates, and tags older reform and uprising events. 1,140 events from 资治通鉴-style coverage were added this way; they have a summary but no long story (AI-drafted, not source-checked). |
| `tools/merge_content.py` | Merges content batches written to `data/work/<era>.json` (Chinese era text, event patches, new events, details) into the files above. |
| `data/places.json` | 212 entries for 136 important cities and military strongholds (城市 toggle), one per period: the name the city had then, its role (capital, secondary capital, major city, port, military stronghold 军事重镇), the years (`from`, `to`), the modern name and a short note. Written by `tools/build_cities.py`; AI-drafted and not source-checked. |
| `data/borders/*.geojson` | Border snapshots, generated by `tools/build_borders.py` (needs shapely). The feature with `"focus": true` is the main dynasty; the rest are neighbours. Each feature has `name`, `name_zh` and a `label` point. |
| `data/states/*.json` | Territories of the periods of rival states (Spring and Autumn and Warring States in `zhou-states.json`, Northern and Southern Dynasties in `north-south.json`, Five Dynasties and Ten Kingdoms in `five-dynasties.json`) as seed points (places each state held) and a list of snapshots saying which seeds change hands. `tools/build_states.py` turns these into `data/borders/sa-*`, `ws-*`, `ns-*` and `fd-*.geojson`. To move a city from one state to another at a given year, add one line to a snapshot. A spec can name a `backdrop` border file whose neighbours are drawn around the seeded states, and a snapshot's `names` renames states or neighbours from then on (e.g. Khitan to Liao in 947). |
| `tiles/pack/` | Elevation, bundled so the map works offline and inside a sandboxed page: the whole world at zoom 0–5 (heights rounded to 8 m on land and 100 m at sea so they compress), East Asia at zoom 6–7 and China proper at zoom 8 (95–127°E, 18–46°N). Zooms 0–3 are one archive each, zoom 4 and up one archive per 8x8 block, because the page host limits the number of files. Each archive is a 1x1 PNG (the host serves only standard file types) whose private `tpAk` chunk holds a 4-byte index length, a JSON index and the tile PNGs; `tools/pack_tiles.py` builds them. `app.js` serves them through a custom `atlas://` tile protocol; beyond zoom 8, or outside the zoom 8 area, it enlarges the parent tile. |
| `tiles/sat/` | Satellite imagery (the default 卫星影像 look): Sentinel-2 L2A 120 m cloud-free mosaic, August 2020, baked to JPEG tiles at zoom 1–5 for the whole world (about 1.9 km a pixel; no data north of 72°N or over Antarctica, filled with tundra and ice colours), 6–8 for East Asia and 9 for China proper, with the sea coloured by depth from the elevation tiles. Packed like `tiles/pack/` (whole zoom per archive at 1–3, 8x8 tiles at 4–8, 16x16 at 9). Rebuild with `tools/imagery/fetch_s2.py` (downloads the RGB bands at 480 m, or 240 m with argument `2`), `tools/imagery/bake_tiles.py` (`Z9=1 FACTOR=2` for zoom 9) and `tools/pack_tiles.py <tiles> tiles/sat --all`. The imagery is modern: cities, fields and reservoirs of today show up. |
| Live tiles | Past the bundled zooms (outside East Asia above zoom 5), `app.js` fetches tiles from the original sources when it can reach them: elevation from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) and imagery from [EOX Sentinel-2 cloudless 2016](https://s2maps.eu) (10 m, CC BY 4.0), up to zoom 10 (`LIVE` and `liveTile()`). After 8 failures in a row a source is left alone for the session. Offline, or with `?offline=1`, the bundled parent tile is enlarged instead: elevation is decoded, interpolated bilinearly and re-encoded, so slopes don't turn into steps. |
| `data/geo/` | Modern rivers and lakes from Natural Earth 10m (built by `tools/build_geo.py`) and `features.json`, the names of major rivers, mountains, plains, plateaus, deserts and seas shown by the 山川 / Landscape switch. |

`data/roads.json` holds 25 major official roads (官道): Qin highways (直道, 驰道, 五尺道), Shu roads, the Han–Tang post roads, the Tang–Tibet road, tea-horse roads and the Yuan–Qing trunk post roads, each with its years of use and main stations. Written by `tools/build_roads.py` (AI-drafted, not source-checked); lines join the main stations only, so they are schematic.

`data/clans.json` holds 33 local elite groups (豪族/士人集团) for the 豪族 layer, from 丰沛集团 to 北洋集团. Each is one of five kinds: great clans (门阀士族), regional blocs, military cliques, court factions or merchant guilds. Every group has the years it mattered, its home seats, its families and its key people. The tinted area is the hull of the home seats; seats more than 3.5° apart become separate patches, so the area is a sketch of where the group came from, not a border. The file is written by `tools/build_clans.py` (AI-drafted, not source-checked).

`data/walls.json` holds 13 Great Walls (长城) for the 长城 layer, from 楚方城 and 齐长城 to 明长城, with the years each was manned and its rough length. A wall in use is drawn as a dark line with battlement ticks and a label; after it was abandoned it stays as faint dashes. The lines join well-known points only. The file is written by `tools/build_walls.py` (AI-drafted, not source-checked). Wall lines in the per-era route data are no longer drawn, since this layer replaces them.

A search box (magnifier button in the era panel, or `/` or Ctrl/Cmd+K) finds years (`755`, `前221`, `221 BC`), periods, people, rulers, cities and events; people and rulers come from all layer files, loaded on first use. Battle cards have a × that hides that card until its event is picked again.

The ledger tab 世界 (World) lists every region at the current year: its period, rulers of its main countries and the nearest big events; clicking a region moves the map and timeline there. The ledger has two tabs: 事件 (events) and 君主 (rulers). The ruler tab lists the reigns of one country from `data/layers/<era>.json`, picked from a dropdown (main dynasties first; `polities` in each layer file, added by `tools/add_polity_names.py`, gives their Chinese names). Clicking a ruler narrows the timeline to that reign (decades zoom with the window set to the reign, labelled with the ruler's name); zooming or panning clears it.

Only markers that fit the chosen year show on the map: events while they are current (the list keeps the rest), faith sites and inventions of the current era (or decades window) up to the year, people alive, capitals in use and passes standing. `data/passes.json` holds 37 famous passes (关隘) with founding years, what they guard and battles fought there, written by `tools/build_passes.py` (AI-drafted, not source-checked; founding years approximate).

Markers are decluttered after every change and as the map moves (`declutter()` in `app.js`): markers within 18 px of a more important one fold into it, which shows a "+N" badge that opens a list of everything there; labels that would collide with a more important label or icon are hidden until you zoom in (hover the icon to see one). Priority: current events, capitals, people, this era's inventions and faith sites, cities, older events, older sites, landscape names.

To add an era, add a snapshot to `tools/build_borders.py` (or hand-make a GeoJSON) and an entry in `eras.json`; eras must be back to back with no gaps. The timeline gives each era a width by the square root of its length, so the 15-year Qin and the 268-year Qing are both clickable. To add an event, append an object to `events.json`. The code reads everything from these files.

## Data sources and known limits

- **Imagery**: bundled: Sentinel-2 L2A 120 m mosaic 2020, contains modified Copernicus Sentinel data processed by Sentinel Hub (CC BY 4.0), from the AWS open data bucket `sentinel-s2-l2a-mosaic-120`.
- **Terrain**: Mapzen / AWS Terrain Tiles (terrarium encoding). Elevation, coastlines and rivers are modern (rivers and lakes from Natural Earth), so the old Yellow River courses, the shifting lakes and the old coastlines are not shown.
- **Borders**: [historical-basemaps](https://github.com/aourednik/historical-basemaps) (GPL-3.0), clipped to East Asia and simplified for the dynasty maps. The world maps come from [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria) (Seshat Global History Databank, CC BY 4.0), simplified to 0.03°, with historical-basemaps for peoples without a state; some small colonies and protectorates (Ceylon, Mandatory Palestine, Gaya) have no polygon of their own there. They are coarse, and several early snapshots are cultural zones rather than states. `tools/build_borders.py` relabels the source and lists every fix. Neighbours get Chinese historical names (匈奴, 鲜卑, 突厥, 回鹘, 后金, 暹罗 ...) from the `ZH` table in `tools/build_borders.py`, with era-specific names per snapshot (e.g. 林邑 before 757, 占城 after; 高丽 vs 朝鲜). Hand-drawn approximations (marked `approx: true`): the Xianbei steppe (25–316), the Later Jin (1616–1643), the Shang core, the Wei/Shu/Wu split, and the Song–Jin line along the Huai River. Spring and Autumn, Warring States, Northern and Southern Dynasties, and Five Dynasties and Ten Kingdoms borders are drawn from seed points (see above) after the general outlines in Tan Qixiang's atlas, so their edges are only indicative. Known gaps: the c. 700 Tang border leaves out the Hexi Corridor and Western Regions; Qin borders reuse the c. 200 BCE Han outline.
- **Events and places**: written for this prototype, each event linking to a Wikipedia article for further reading. The stories, finer events and Chinese text were drafted with an AI model from general knowledge and have not been checked line by line against sources; uncertain dates are marked circa. The Wikipedia links could not be tested from the build machine, so the page opens them through Wikipedia search, which lands on the article when the title exists and on search results otherwise.

A better border source for Chinese dynasties is CHGIS (Harvard China Historical GIS), which has prefecture-level data by year. Using it is a natural next step.

## Illustrations

Person cards and event stories show a picture from Wikimedia Commons (public domain or CC licences only, credited under the image).
- `.github/workflows/illustrations.yml` (run by hand on GitHub) runs `tools/fetch_illustrations.py` on the pages in
  `tools/illust_queries.json` (made by `tools/illust_queries.py` from each person's and event's `source`) and pushes the
  thumbnails to the `illustrations-raw` branch. GitHub's runners can reach Wikimedia; this environment cannot.
- `tools/pack_illustrations.py <checkout of illustrations-raw>` writes `data/illustrations.json` (key → image, credit)
  and `data/img/<0-11>.json` (WebP data URLs, loaded on demand). Images shared by more than 3 events are dropped as generic.
- `data/illustrations-skip.json` lists keys whose picture was wrong (checked by eye: modern namesakes, stamps, logos).
  Pictures follow each entry's Wikipedia `source`, so a wrong `source` gives a wrong picture.

## States that outlive their period

A period's maps end with the period, so states that lasted into the next dynasty's first years are carried over:
Wu on the Jin map 266–280 and Chen / Western Liang on the Sui map 581–589 (`tools/carry_states.py`), and the remaining
Ten Kingdoms on the Northern Song map 960–979 (extra snapshots fd-960…fd-978 in data/states/five-dynasties.json).
Their rulers are listed in the next period's layer file too.
The Sixteen Kingdoms (304–418, `data/states/sixteen-kingdoms.json`) and the early Qing rivals (Shun, Great Xi, Southern
Ming, Lu regency, Zheng Taiwan, the Three Feudatories, 1644–1681, `data/states/early-qing.json`) are carved out of the
Jin and 1650 Qing base maps by `tools/carve_states.py`: seed points per commandery/prefecture, owners per snapshot.

## Borders that follow the land

The border sources are coarse (historical-basemaps polygons of a few dozen straight segments, and Voronoi cells for
the state maps), so on their own they cut across valleys and run beside rivers instead of along them.
`tools/snap_terrain.py` is the last step after the border generators: it rasterises each map onto a 0.025° grid,
keeps the inside of every polity fixed and re-splits the land within 2.5° of a border by cheapest travel cost, where
mountain crests and big rivers are expensive to cross (`tools/terrain_grid.py` builds that cost map from the bundled
elevation tiles and data/geo/rivers.geojson). So a border moves onto a nearby ridge or river and stays put on open
plains. Coasts are kept as drawn. Snapped maps carry `"snapped": true`; rerun a generator to start from raw shapes.
Needs numpy, scipy, scikit-image, shapely 2.1 and numba.

## Guided tours, old rivers and links

- **Auto layers** (自动图层 chip, on by default): reading an event or showing a tour step switches on the layers its
  text calls for (battles: armies and passes; 迁都: capitals; 佛/儒: faith; 造纸: inventions; canals and journeys: routes and
  roads; frontier peoples: walls; 门阀/朋党: elites). `AUTO_RULES` in app.js; such chips get a dashed red outline and go
  off again afterwards. Clicking a dashed chip hides that layer for the current story or step; clicking again turns it on for good.

- **Tours** (导览, the first tab of the side panel; lists the current period's tours, then the rest by period):
  `data/tours.json`, 204 tours (104 for China, 100 for the other 13 regions with a `region` field; the tab lists the current region's period first, then its other periods, then each other region), each with an `era` id (a tour also lists under every period its years reach into, and under any in `also`) and a list of steps `{year, at: [lon, lat], zoom?, pitch?, bearing?, event?, text, text_zh}`;
  `path: true` draws the journey so far. The tour card flies the camera, moves the timeline and selects the step's event.
  Each step lights up (gold) the states on the current map that its Chinese caption names, minus the period's own dynasty;
  a step can override this with `highlight: [name_zh, ...]`. Tours are AI-drafted and not source-checked.
- **Old Yellow River courses and shorelines**: `data/geo/old-rivers.geojson`, lines with `kind` (river/coast) and the years
  `[from, to)` they apply to. The modern lower Yellow River (east of 113.65°E) is a separate feature in rivers.geojson with
  `from: 1855`, hidden before then. Courses are schematic, drawn from the usual textbook sketches.
- **Links**: the address hash keeps the view (`#y=year&c=lng,lat,zoom,pitch,bearing&t=tab&e=event&tour=id&s=step&l=en`);
  the link button copies it (system share sheet on phones). A link wins over the remembered view.
