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
| `atlas` | Pack format version, `1`. The atlas refuses versions it doesn't know. |
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

Periods must follow each other with no gaps. `glyph` is the seal in the era card (one or two characters). `short`
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
shows `text`. `event` links the step to an event's story, and `path: true` draws the journey so far.

## Base map

A pack shown alone (`packonly=1`) can replace Earth with its own ground. The [Mars pack](../examples/mars-pack/)
is a complete example: open `/?pack=examples/mars-pack/manifest.json&packonly=1`.

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

## Hosting and the allowlist

Pack text is put into the atlas page, so the atlas only loads packs (and plugins) from a short list of sites:
`PACK_ORIGINS` at the top of `app.js`, plus the atlas's own site and `localhost` for development. Today the list is
`atlas.daiyip.com`, `bible.daiyip.com` and `daiyip.github.io`. You have two ways to use your own pack:

1. **Self-host the atlas.** It is a static site with no build step. Fork the repo, put your pack in a folder next to
   it (for example `packs/rome/`) and open `/?pack=packs/rome/manifest.json`. A pack on the same site always loads.
2. **Use atlas.daiyip.com.** Open a pull request that adds your site to `PACK_ORIGINS`. Your pack's files must be served
   with `Access-Control-Allow-Origin` (GitHub Pages does this for you).

To try a pack while you write it, serve the atlas and your pack locally:

```sh
python3 -m http.server 8000          # from the atlas checkout
# open http://localhost:8000/?pack=examples/demo-pack/manifest.json&packonly=1
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
