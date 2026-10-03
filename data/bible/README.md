# Bible lands dataset

Data for showing the Bible's places, events and journeys on the world map, in the same shapes as the China files
in `data/`. Every event and tour step also carries a `refs`/`ref` field (OSIS references such as `Acts.13.4-5`),
so the Bible reader can link to the map and back.

| File | What it holds |
| --- | --- |
| `eras.json` | 11 periods from the Patriarchs (2000 BC) to the Early Church (AD 100), English and Chinese. `snapshots` are empty until the world map has borders for the region. |
| `events.json` | 298 events that have a known place, from Theographic Bible Metadata: year (and `endYear`), `level`, `category`, title and place in English and Chinese, `lat`/`lon`, the first verse as `summary` (KJV) and `summary_zh` (和合本), `refs`, `people` and `places`. Level 1 is a short hand-picked list of key events; level 2 are top-level events; level 3 are events that are part of a larger one. |
| `places.json` | 1,220 places with coordinates: `id`, `name`, `name_zh` (only for the 160 places used by events so far), `lon`, `lat`, `kind`, `precision` and how many verses name it. |
| `tours.json` | 8 hand-written tours (Abraham, the Exodus, David, the exile and return, Jesus, Paul's first and second journeys, Paul's voyage to Rome), 65 steps, each with a `ref`. AI-drafted from the biblical text; the coordinates of the stops were set by hand. |

`events.json` and `places.json` are built by `tools/bible/build_bible.py` (run `tools/bible/fetch_sources.sh` first);
Chinese names come from `tools/bible/zh.json` (和合本 spellings, AI-drafted). `eras.json` and `tours.json` are edited by hand.

Years follow Theographic's traditional chronology (Exodus 1490 BC, Solomon's temple 1011 BC, Jesus born 3 BC);
many scholars date the early periods later. Event coordinates are Theographic's and for regions (Egypt, Canaan,
the Jordan) are a rough centre point.

Sources and licences: [Theographic Bible Metadata](https://github.com/robertrouse/theographic-bible-metadata)
(CC BY-SA 4.0, so this folder is shared under CC BY-SA 4.0 too); King James Version and 和合本 (both public domain)
via [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases).
