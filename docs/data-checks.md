# Data checks: what has been checked and what has not

Almost all of the atlas's text and much of its map data was drafted with AI, then corrected in passes. This page
records each pass: what it compared against, what it found, how to run it again, and, as important, what nobody has
checked yet. Numbers are as of 2026-10-07 (app `?v=221`).

The short version:

| Data | Made by | Checked against | Result | Not checked |
| --- | --- | --- | --- | --- |
| Event years (3,625 events) | AI | Wikipedia intro + Wikidata dates, then whole en/zh articles | 3,005 ok, 1 fixed, 20 doubt, 599 nothing to check against | Places, the long story paragraphs |
| Event summaries | AI | Whole en/zh Wikipedia articles, Sonnet reviewers | 2,609 ok, 6 fixed, 36 doubt, 974 not reviewed | The long stories, quotes, "significance" |
| Event Wikipedia links | AI | Link check (GitHub Action) | Dead links fixed, redirects followed, `source_zh` added (3,213) | Whether the article is the right subject (a few point at namesakes) |
| Rulers (4,390 reigns) | AI | Wikipedia + Wikidata reign years | 4,083 ok, 4 fixed, 64 doubt, 239 unchecked | Titles, posthumous names |
| People (3,371) | AI | Wikipedia + Wikidata life years | 3,125 ok, 3 fixed, 43 doubt, 200 unchecked | Biographies, home place |
| Life journeys (1,929 steps) | AI | Wikipedia passages | 1,457 ok, 11 fixed, 67 doubt | Step places (map points) |
| Ties between people (1,064) | AI | Wikipedia passages | 803 ok, 3 fixed, 30 doubt | The descriptive text |
| Disasters (157) | AI | Wikipedia passages | 84 ok, 5 doubt | Places and death tolls beyond the passage |
| Climate periods (13) | AI | Wikipedia | 6 ok, 1 doubt | The temperature curve itself |
| Economy shares | AI from memory of 梁方仲 / 葛剑雄 tables | Wikipedia (only 1393 and 1820 checkable) | Few checkable | Most numbers |
| China dynasty borders | historical-basemaps + hand edits after 谭其骧 | By eye; Taiwan, Korea, disputed areas by script | See [Borders](#borders) | No systematic check against a source atlas |
| World borders | Cliopatria (Seshat) + historical-basemaps | Country table, overlap scan, name review (2026-10-07) | See [Borders](#borders) | Exact border lines |
| 政区 seats (4,529) | AI | CHGIS, privately (its licence forbids publishing) | Coverage 73–94 %, median error 1–8 km | 南北朝 thin; Voronoi areas are sketches |
| Pictures (Wikimedia) | Wikipedia `source` links | Every picture looked at on contact sheets | Bad ones in `data/illustrations-skip.json` | — |
| AI pictures (3,625 events) | GPT Image | Spot check of the 510 level-1 events | 55 redone | The other ~3,100 |

Everything in the last column is still AI-drafted and unverified. The app says so where it matters: cards show
"AI review" or "AI-drafted" notes (`checkNote()`, `vcNote()` in app.js).

## Events, rulers and people

**Years.** `.github/workflows/facts.yml` runs `tools/fact_fetch.py` (Wikipedia intros and Wikidata dates, written to
branch `fact-check`), and in `mode=deep` `tools/fact_deep.py` (year passages from the whole English and Chinese
articles, branch `fact-deep`). `tools/fact_check.py` compares them with our years. Reviewers (Sonnet, told to judge
only from the evidence) wrote verdicts to `tools/fact_verdicts.json` and `tools/fact_verdicts_deep.json`, and
`tools/apply_facts.py report.json fact_verdicts.json fact_verdicts_deep.json` writes `check: {s: ok|fixed|doubt, was,
n, n_zh}` on each item. Re-running is safe.

- Disputed dates (for example Warring States reigns, where 杨宽 and 史记 differ) are marked doubt, not changed.
- "Unchecked" means no article, or an article that does not give the year.

**Summaries.** `facts.yml` `mode=deep-events` fetches whole articles (branch `fact-events`), reviewers wrote
`tools/summary_verdicts.json`, and `tools/apply_summaries.py` writes `sum: {s, n, n_zh, was}`. Two batches whose
reviewers passed everything were thrown away, so those events count as not reviewed. Sources that turned out to be
about the wrong subject: liu-kun-killed, siege-of-xiangyang-378, qiu-fu-rebellion.

**Links.** `.github/workflows/links.yml` runs `tools/check_links.py` (branch `link-check`); `tools/apply_links.py`
follows redirects and adds `source_zh`. The 95 China events after 1912 (`cn-*`) were added later and their links have
not been checked.

**Lives, ties, disasters, climate, economy.** `facts.yml` `mode=more` runs `tools/fact_more.py` (branch `fact-more`),
verdicts are in `tools/more_verdicts.json`, and `tools/apply_more.py` writes `check`. `tools/build_relations.py` and
`tools/build_climate.py` run it again. Economy fixes must be made by hand in `data/economy.json`; the script refuses.

Not checked at all: event story paragraphs, quotes and "significance" notes, tour and life-story captions, narration
scripts, person biographies, the event→place/person/state links made by `tools/link_events.py`, mood tags, and the
layers each event turns on.

## Borders

### China dynasty maps (2070 BCE–1912)

Drawn from historical-basemaps and redrawn by hand after 谭其骧's *中国历史地图集*, then snapped to ridges and rivers
(`tools/snap_terrain.py`). Pre-Qin borders are the roughest. Script fixes on top:

- `tools/taiwan.py`: Taiwan has an owner on every Ming and Qing map (台湾诸部, 荷属台湾, 明郑 and 大肚王国, 清,
  Japan from 1895).
- `tools/fix_maps.py`: Korea (古朝鲜, 乐浪郡, 高句丽, 安东都护府, 新罗 at the right dates), Ryukyu, South Sakhalin,
  and the China entries for 1912–1959 (中华民国 labels, warlords, 东北, 唐努图瓦, Tibet from 1951).

### World maps (3000 BCE–today)

`tools/build_world.py` takes Cliopatria (Seshat) and fills land it does not cover from historical-basemaps. The
filling reuses the nearest older historical-basemaps snapshot, which is why some states outlived their end. Chinese
names in `data/world/names_zh.json` are AI-translated.

Checks run on 2026-10-07 (full list in the project's `atlas-reviews/world-scan.md`):

1. **Years vs the country table.** Every name on the maps compared with `data/lineages.json`: 56 runs off by more
   than 40 years.
2. **Overlaps.** Two states drawn on the same land in any snapshot: 114 pairs outside the 1492 map's indigenous
   ranges, mostly a parent state drawn over its sub-units (Kievan Rus over Novgorod).
3. **Name review.** All ~3,047 names, by region, for anachronisms, wrong names or translations, missing Chinese
   names and loaded labels (six AI reviewers): 13 sensitive labels, 111 anachronisms, 32 wrong translations, 102
   missing Chinese names.

All of these were fixed in `tools/world_fixes.json` (applied by `tools/fix_maps.py`; see below), and the overlap rule
now runs on every map except 1492: where two states cover the same land, the smaller keeps it.

Not checked: the border lines themselves, states that are missing entirely, and land the sources leave empty.

### Disputed areas

Policy (chosen by Daiyi, 2026-10-07): draw who actually controlled a place at the time, hatch areas whose
sovereignty is disputed, and show a card with the controller and the claimants. The ⓘ note says the map takes no
side. `tools/build_disputes.py` writes `data/disputes.json` (36 areas from Natural Earth's disputed areas plus a few
drawn by hand; card notes are AI-drafted). Natural Earth lists about 100 disputed areas; the other ~65 are small or
dormant and not drawn yet.

### Running the border fixes

Order matters:

```
build_world / build_borders / carve_states / snap_terrain
python3 tools/taiwan.py
python3 tools/fix_maps.py        # FIXES in the script, then tools/world_fixes.json, then the overlap rule
python3 tools/build_countries.py
python3 tools/build_graph.py     # who held each area (地区史), then:
python3 tools/check_graph.py
```

`fix_maps.py` splits a map when a fix starts mid-snapshot (new files are marked `"fix": true`) and redoes them on
each run. Entries in `tools/world_fixes.json` never split maps: they apply to a snapshot when at least half its
years fall inside the fix. Add new corrections to these tables rather than editing map files by hand.

## Other layers

AI-drafted and not checked against sources: cities and their period names, passes, roads, walls, elite groups
(豪族), trade and spread routes, region and country periods (`regions.json`, `country-periods.json`), the country
table (`lineages.json`), tours, the gazetteer's "约在 X郡" units (taken from the Voronoi sketch areas, so sometimes
wrong), and the climate curve (nodes placed after 竺可桢 1972 and 葛全胜 2013, not published data). Rivers and
coastlines are modern; old Yellow River courses are sketched.

## Ideas for later checks

- Event places and story text against the same Wikipedia articles used for summaries.
- China borders against CHGIS (private comparison only, as for the 政区 seats).
- The rest of Natural Earth's disputed areas.
- A per-country "point of view" switch (Natural Earth has official views for China, India and others).
