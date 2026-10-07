# Custom data: data packs

The atlas is an engine. It supplies the world map, terrain, satellite imagery, world borders from 3000 BCE to today,
the timeline, tours, search and the UI. **Your history** (periods, events, tours and map layers) lives in a **data
pack**: a folder of JSON files with a `manifest.json`, published on your own site. Point the atlas at it with `?pack=`:

```
https://atlas.daiyip.com/?pack=https://example.org/atlas/manifest.json
https://atlas.daiyip.com/?pack=https://example.org/atlas/manifest.json&packonly=1
```

- By default the pack is **added** to the atlas's own data. Its periods become one more region, which wins inside its
  outline, and its events and tours sit beside the built-in ones.
- With `packonly=1` the pack is **shown alone**. The atlas's own events, tours, cities, per-period layers and overlays
  are left out, and so are the layer switches and ledger tabs that would be empty.

A complete working pack is in [`examples/demo-pack/`](../examples/demo-pack/). It has one period, 61 events, Paul's
three journeys as tours, two map layers and a plugin.

## A minimal pack

```
my-pack/
  manifest.json
  eras.json
  events.json
  tours.json        (optional)
```

`manifest.json`:

```json
{
  "atlas": 1,
  "id": "rome",
  "name": "Ancient Rome",
  "name_zh": "古罗马",
  "region": {
    "polygon": [[-10, 35], [40, 35], [40, 55], [-10, 55]],
    "view": { "center": [12.5, 41.9], "zoom": 5, "year": -44 }
  },
  "range": { "start": -753, "end": 476 },
  "data": { "eras": "eras.json", "events": "events.json", "tours": "tours.json" },
  "attribution": "Events: my sources"
}
```

## Manifest

| Key | Meaning |
| --- | --- |
| `atlas` | The Atlas format the pack is written for, `1` today: the lowest format that can read it. See [Versions](#versions). |
| `id` | Lowercase letters, digits and `-`. It is also the region id, and the key the browser remembers the view under. |
| `name`, `name_zh` | Display name in English and Chinese. |
| `data.eras`, `data.events` | Required. Paths relative to the manifest. |
| `data.tours` | Optional guided tours. |
| `region.polygon` | Outline `[[lon, lat], ...]`. While the map is mostly inside it, the timeline shows the pack's periods. `region.bounds` (`[[west, south], [east, north]]`) is used as a box when there is no polygon. |
| `region.view` | First view when there is no link and no remembered view: `center`, `zoom`, `year`. |
| `range` | `{start, end}`: the years the pack's periods cover. Negative years are BCE. |
| `refs` | Optional link back to your own site. Events with `refs` and tour steps with `ref` get a link built from `url`, with `{ref}` replaced. `label` and `label_zh` are its tooltip. |
| `attribution` | Added to the map credits. |
| `note`, `note_zh` | When the pack is shown alone, this replaces the borders note in the side panel. |
| `layers` | Map overlays drawn from GeoJSON. See [plugins.md](plugins.md#layers). |
| `plugins` | JavaScript modules that extend the atlas. See [plugins.md](plugins.md#plugins). |
| `basemap` | Your own ground instead of Earth's: another planet or an invented world. Only for a pack shown alone. See [Base map](#base-map). |

Text fields come in pairs: `x` in English and `x_zh` in Chinese. If the Chinese one is missing, the English one is
shown.

## eras.json: the periods

```json
{
  "range": { "start": 31, "end": 100 },
  "eras": [
    { "id": "early-church", "name": "The Early Church", "name_zh": "初期教会", "glyph": "使徒",
      "short": "Early Church", "tiny": "Chr", "start": 31, "end": 100,
      "summary": "The apostles preach from Jerusalem to Rome.", "summary_zh": "使徒从耶路撒冷一直传道到罗马。" }
  ]
}
```

Periods must follow each other with no gaps. `glyph` is the seal in the era card (one or two characters);
`glyph_en`, if given, replaces it when the atlas is in English (up to three letters). `short`
and `tiny` are the labels on the timeline when space runs out. A pack's periods use the atlas's world border maps, so
they need no `snapshots`.

## events.json: dated, located events

```json
[
  { "id": "paul-at-athens", "year": 50, "level": 1, "category": "culture",
    "title": "Paul at Athens", "title_zh": "保罗在雅典",
    "place": "Athens", "place_zh": "雅典", "lat": 37.97, "lon": 23.72,
    "summary": "Paul speaks on the Areopagus.", "summary_zh": "保罗在亚略巴古讲道。",
    "refs": ["Acts.17.16-34"] }
]
```

| Field | Meaning |
| --- | --- |
| `id` | Unique across the pack. |
| `year`, `endYear` | When it happened (the end is optional). |
| `lat`, `lon` | Where. |
| `level` | `1` key, `2` major, `3` detail. The event filter and timeline zoom use it. |
| `category` | One of `war`, `politics`, `reform`, `rebellion`, `diplomacy`, `economy`, `culture`, `science`, `society`. |
| `title`, `place`, `summary` (+ `_zh`) | Text for the list, the map card and the story view. |
| `refs` | Optional, for the manifest's `refs` link. |
| `layers` | Optional. Map layers the Auto layers switch turns on while this event's story is open, for example `["armies", "passes"]`. `[]` turns none on. Left out, keyword rules guess. Keys: `rulers`, `people`, `armies`, `routes`, `exchange`, `spread`, `passes`, `roads`, `walls`, `clans`, `capitals`, `faith`, `inventions`. |

## tours.json: guided tours

```json
[
  { "id": "paul-first", "era": "early-church", "path": true,
    "title": "Paul's first journey", "title_zh": "保罗第一次旅行布道",
    "steps": [
      { "year": 45, "at": [36.165, 36.201], "zoom": 6.4, "event": "first-missionary-journey", "ref": "Acts.13.1-3",
        "text": "The church at Antioch sends them out.", "text_zh": "安提阿的教会差遣他们出去。" }
    ] }
]
```

Each step flies the camera to `at` (with optional `zoom`, `pitch` and `bearing`), moves the timeline to `year` and
shows `text`. `event` links the step to an event's story, and `path: true` draws the journey so far. A step's `layers`
works like an event's: the layers Auto layers turns on at that stop (without it, the linked event's, then the rules).

### Tour media: pictures, narration and music

A pack can bring the same media the atlas's own tours have: a picture per stop, a voice reading each stop's `text_zh`,
and background music per period. Name three index files and the folder their files sit in:

```json
"media": {
  "base": "https://data.atlas.daiyip.com/apps/bible/",
  "pictures": "media/pictures.json",
  "narration": "media/narration.json",
  "music": "media/music.json"
}
```

The indexes have the same shape as the atlas's own, with file names under `base`:

| File | Shape | Files in |
| --- | --- | --- |
| `pictures` | `{"keys": {"a:tour.<tour id>.<step>": "<image id>", "a:<event id>": …}, "images": {"<image id>": {"f": "<file>", "w": 1536, "h": 1152, "ai": "<model>"}}}` | `base/ai/` |
| `narration` | `{"<tour id>/<step>": {"Charon": "<file>", "Kore": "<file>", "h": "<CRC-32 of text_zh, 8 hex digits>"}}` | `base/narration/` |
| `music` | `{"<pack id>/<era id>": {"f": "<file>"}}` | `base/music/` |

A step is read aloud only while `h` matches its current `text_zh`, so an edited caption falls silent instead of reading
old words. Pictures are always shown as AI-generated. `base` must be on an allowed site or under the atlas's R2
`apps/` folder (see [data-updates.md](data-updates.md#layout-on-r2)), and its files need the CORS header for
atlas.daiyip.com. Each part is optional, and an atlas that predates `media` simply leaves it out, so it needs no new
format.

## Versions

One number, the **Atlas format**, versions everything in a pack: the manifest, the data files (eras, events, tours,
layers) and the [plugin API](plugins.md#the-atlas-object). The manifest's `atlas` says which format the pack is
written for.

- **Older packs keep working.** The atlas reads every format up to its own and upgrades older files as it loads them,
  so a pack never has to change just because the atlas moved on.
- **Newer packs are refused** with a message asking the visitor to reload: a page too old to understand the pack would
  otherwise show it wrongly. (If the page was merely cached, the reload fixes it.)
- **Optional extras can ask for more.** A layer or a plugin entry may carry its own `atlas`. On an older atlas it is
  skipped and the rest of the pack still opens:

  ```json
  "plugins": ["plugins/journey.js", { "src": "plugins/narrator.js", "atlas": 2 }]
  ```

The format goes up when the atlas gains something a pack may rely on, such as a new manifest key, field or file that
an older atlas would silently get wrong. Fields an older atlas can safely ignore don't raise it. Set `atlas` to the
lowest format that has everything your pack uses:

The format is numbered separately from the app. The app version (`?v=`, shown as "Atlas v178" in the map credits)
goes up with every release; the format only goes up when packs need to know, so the table below is the full list of
format changes. The credits show both, for example "Atlas v178 · data format 1".

| Format | First app version | Added |
| --- | --- | --- |
| 1 | v178 (earlier versions read format 1 only) | Everything in these pages: manifest, `eras.json`, `events.json`, `tours.json`, layers, plugins (API 1), `basemap`. |

The atlas's own data declares its format the same way, in `data/manifest.json`.

## Base map

A pack shown alone (`packonly=1`) can replace Earth with its own ground. The [Mars pack](../examples/mars-pack/)
is a complete example: open `/?pack=examples/mars-pack/manifest.json&packonly=1`. For a step-by-step guide,
including how to make tiles from one picture, see [custom-ground.md](custom-ground.md).

```json
"basemap": {
  "earth": false,
  "background": "#0b0b10",
  "dem": { "tiles": "tiles/dem/{z}/{x}/{y}.png", "encoding": "terrarium", "maxzoom": 3 },
  "imagery": { "tiles": "tiles/img/{z}/{x}/{y}.jpg", "maxzoom": 4, "name": "Viking colour", "name_zh": "海盗号影像" },
  "relief": [[-8000, "#1d2a5c"], [0, "#c9d27a"], [5000, "#d0743a"], [21000, "#ffffff"]],
  "reliefName": "Elevation", "reliefName_zh": "高程",
  "exaggeration": 0.5,
  "labels": "labels.json",
  "attribution": "Mars tiles: OpenPlanetary"
}
```

| Key | Meaning |
| --- | --- |
| `earth` | `false` hides everything that belongs to Earth: coastlines, rivers, lakes, old river courses, landscape names and the world borders. Leave it out to keep them (for a re-coloured Earth). |
| `dem` | Elevation tiles (XYZ, Web Mercator) for relief, hill shading and 3D. `encoding` is `terrarium` (default) or `mapbox`. Past `maxzoom` the last zoom is enlarged. Without `dem` there is no relief and no 3D. |
| `imagery` | Picture tiles (XYZ, Web Mercator). `name`, `name_zh` label it in the style menu. |
| `relief` | Colours for heights in metres, as `[height, colour]` pairs, used by the relief style. |
| `reliefName`, `reliefName_zh` | The relief style's name in the menu. |
| `background` | Colour where there are no tiles. |
| `exaggeration` | Multiplies the 3D height (default `1`). Lower it for a world with taller mountains than Earth. |
| `labels` | Place names on the ground, the same shape as `data/geo/features.json`: `{name, name_zh, kind, lon, lat, minzoom?}`, with `kind` one of `mountain`, `plain`, `plateau`, `desert`, `sea`, `lake`, `river`, `corridor`. They show with the Landscape switch. |
| `sky` | A MapLibre sky object for the 3D horizon (default: a dark sky). |
| `attribution` | Credits for the tiles. |

Tile paths are relative to the manifest. The style menu offers only the pack's own styles: its imagery and its
relief. Tiles must use XYZ numbering (row 0 at the north); if your source is TMS, flip the rows.

## Checking a pack

`tools/validate.py` checks a pack against the data format before you publish it. It needs only Python 3:

```sh
python3 tools/validate.py my-pack             # the pack's folder, or its manifest.json
python3 tools/validate.py data examples/*-pack   # the atlas's own data/ and the example packs
```

```
Atlas data format 1
my-pack/manifest.json: 2 error(s), 1 warning(s)
  error: events.json paul-at-athens: unknown `category` 'religion'
  error: tours.json paul-first step 3: event 'paul-in-cyprus' does not exist
  warning: events.json saul-is-converted: `layers` has unknown key 'army'
```

**Errors** are things the atlas would refuse or show wrongly, and the command exits 1 if there are any. **Warnings**
are worth a look but break nothing. It checks:

- **Manifest**: `atlas` is a format this atlas reads (see [Versions](#versions)), `id`, `name`, `data.eras` and
  `data.events`, the shape of `region` and `range`, `refs.url` has `{ref}`.
- **Periods**: unique ids, a name, `start` before `end`, and each period starting where the one before ends (the year
  after, or the same year), inside `range`. A `glyph` of more than two characters is a warning.
- **Events**: unique ids, a whole `year` (and `endYear` not before it), `lat`/`lon` on the globe, `level` 1–3, a known
  `category`, a `title`. Unknown `layers` keys are a warning.
- **Tours**: unique ids, a title, `era` is one of the periods, every step has a `year`, `at` as `[lon, lat]` and
  `text`, and its `event` exists.
- **Layers and plugins**: ids, `type`, `years`, a per-entry `atlas`, the GeoJSON file is a FeatureCollection whose
  features have geometry and sensible `from`/`to`, plugin files exist.

The **Validate data** workflow (`.github/workflows/validate.yml`) runs it on the atlas's own data and the example
packs for every push and pull request that changes them. A pack in another repository can run the same command
in its own CI against a checkout of the atlas.

## Hosting and the allowlist

Pack text is put into the atlas page, so the atlas only loads packs (and plugins) from a short list of sites:
`PACK_ORIGINS` at the top of `app.js`, plus the atlas's own site and `localhost` for development. Today the list is
`atlas.daiyip.com`, `bible.daiyip.com`, `gallery.daiyip.com` and `daiyip.github.io`. You have two ways to use your own pack:

1. **Self-host the atlas.** It is a static site with no build step. Fork the repo, put your pack in a folder next to
   it (for example `packs/rome/`) and open `/?pack=packs/rome/manifest.json`. A pack on the same site always loads.
2. **Use atlas.daiyip.com.** Open a pull request that adds your site to `PACK_ORIGINS`. Your pack's files must be served
   with `Access-Control-Allow-Origin` (GitHub Pages does this for you).

To try a pack while you write it, serve the atlas and your pack locally:

```sh
python3 -m http.server 8000          # from the atlas checkout
# open http://localhost:8000/?pack=examples/demo-pack/manifest.json&packonly=1
python3 tools/validate.py examples/demo-pack   # and check it (see Checking a pack)
```

## Links into a pack

The address keeps the view, so you can link straight to a moment:

| Hash key | Meaning |
| --- | --- |
| `y` | Year, for example `y=-44`. |
| `c` | Camera: `lon,lat,zoom,pitch,bearing`. |
| `e` | Open this event's story. |
| `tour`, `s` | Start this tour at step `s` (counting from 1). |
| `l=en` | English. |

For example: `/?pack=…/manifest.json&packonly=1#tour=paul-first&s=3&l=en`. Changing the hash reloads the atlas at the
new place. This is how a host page moves an embedded atlas (see the README).
