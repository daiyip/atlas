# Plugins and map layers

A [data pack](custom-data.md) can add its own things to the map in two ways:

- **[Layers](#layers)**: GeoJSON files that the atlas draws for you. No code is needed. Use them for roads, borders,
  sites and regions.
- **[Plugins](#plugins)**: JavaScript modules that receive the map and the atlas's events. Use them for anything
  that moves or reacts, such as animations, live data or custom cards.

Each layer and plugin switch appears in a **Pack** (专题) group in the layers panel. The browser remembers each
visitor's choices for each pack.

![Demo pack: Roman roads, churches and journey playback](img/pack-demo.jpg)

The [demo pack](../examples/demo-pack/) uses both: Roman roads and churches are layers, and journey playback is a
plugin.

## Layers

List them in the manifest:

```json
"layers": [
  { "id": "roads", "name": "Roman roads", "name_zh": "罗马大道", "data": "layers/roads.geojson",
    "type": "line", "color": "#7a5230", "width": 3, "dash": [3, 1.5] },
  { "id": "churches", "name": "Churches", "name_zh": "教会", "data": "layers/churches.geojson",
    "type": "circle", "color": "#2f6f8f", "radius": 6 }
]
```

| Key | Meaning |
| --- | --- |
| `id` | Lowercase letters, digits and `-`, unique in the pack. |
| `name`, `name_zh` | The switch's label. |
| `data` | Path to a GeoJSON FeatureCollection, relative to the manifest. |
| `type` | `fill`, `line` or `circle`. If you leave it out, polygons are filled and outlined, lines are stroked and points are drawn as dots. |
| `color` | Default colour. A feature's own `color` property wins. |
| `opacity` | Fill opacity, default `0.22`. |
| `width`, `dash` | Line width in pixels and dash pattern, for example `[3, 1.5]`. |
| `radius` | Dot radius in pixels. |
| `on` | `false` starts the layer switched off. |
| `years` | `[from, to)`: the whole layer only shows in these years. |

### Features

```json
{ "type": "Feature",
  "properties": { "name": "Via Egnatia", "name_zh": "伊格那提亚大道", "from": -146,
                  "text": "The Roman road across Macedonia.", "text_zh": "横贯马其顿的罗马大道。",
                  "ref": "Acts.16.11-12" },
  "geometry": { "type": "LineString", "coordinates": [[19.45, 41.32], [22.94, 40.64], [24.40, 40.94]] } }
```

| Property | Meaning |
| --- | --- |
| `from`, `to` | Years the feature exists, `[from, to)`. Either can be left out. As the timeline moves, the feature appears and disappears. |
| `name`, `name_zh` | Card title. A feature with a name or text opens a card when clicked. |
| `text`, `text_zh` | Card text. |
| `ref` | Adds a link to the card through the manifest's `refs`. |
| `color` | Overrides the layer colour. |

## Plugins

A plugin is an ES module listed in the manifest. Paths are relative to the manifest:

```json
"plugins": ["plugins/journey.js"]
```

It exports a setup function. The atlas calls it once, after the map has loaded:

```js
export default function setup(atlas) {
  const dots = atlas.addLayer({ id: "my-dots", name: "My dots", type: "circle",
                                data: { type: "FeatureCollection", features: [] } });

  atlas.on("year", ({ year }) => {
    dots.setData(/* GeoJSON for this year */);
  });
}
```

Plugins run inside the atlas page, so they load only from the sites a pack may come from. See
[Hosting and the allowlist](custom-data.md#hosting-and-the-allowlist). If a plugin fails to load or throws, the atlas
logs it in the console and carries on without it.

### The `atlas` object (API version 1)

**State** (read-only)

| | |
| --- | --- |
| `atlas.version` | Plugin API version, `1`. |
| `atlas.map` | The [MapLibre GL](https://maplibre.org/maplibre-gl-js/docs/API/) map, already loaded. |
| `atlas.maplibregl` | The MapLibre library, for markers and popups. |
| `atlas.pack` | The pack's manifest. |
| `atlas.year` | The current year (negative is BCE). |
| `atlas.era` | The current period: `{id, name, name_zh, start, end}`. |
| `atlas.lang` | `"zh"` or `"en"`. |
| `atlas.tour` | The running tour, `{id, index, steps, path}`, or `null`. |

**Events**: `atlas.on(name, fn)` returns a function that removes the handler.

| Event | Detail |
| --- | --- |
| `year` | `{year, era, eraChanged}`: the timeline moved. |
| `tour-step` | `{id, index, step, steps, path}`: a tour step started. The camera flight takes about 2.6 s. |
| `tour-end` | `{}`: the tour was closed or finished. |
| `event` | `{id, event}`: an event was opened. |
| `lang` | `{lang}`: the language changed. |

**Adding to the map**

| | |
| --- | --- |
| `atlas.addLayer(def)` | A layer as in the manifest. `data` may be a URL or a GeoJSON object, and `chip: false` gives it no switch. Returns `{on, setData(geojson), show(on), layerIds}`. |
| `atlas.addToggle(def, fn)` | A switch with no layer of its own. `def` is `{id, name, name_zh, on}`. `fn(on)` is called now and on every click. |
| `atlas.showCard(lngLat, html)` | Opens a map card. The HTML is used as is. |

**Moving the atlas**

| | |
| --- | --- |
| `atlas.setYear(year)` | Moves the timeline. |
| `atlas.setStyle(id)` / `atlas.style` / `atlas.styles` | Switches the map style (`satellite`, `terrain`, `antique`, `plain`, `dark`); the current one; all of them. |
| `atlas.startTour(id, step)` | Starts a tour (step counts from 0). |
| `atlas.openEvent(id)` | Opens an event's story. |

**Helpers**

| | |
| --- | --- |
| `atlas.text(en, zh)` | Picks the visitor's language. `atlas.text(obj, "name")` reads `obj.name` or `obj.name_zh`. |
| `atlas.url(path)` | A URL next to the plugin file. |
| `atlas.fetchJSON(path)` | Loads a JSON file next to the plugin. |

## Example: journey playback

[`examples/demo-pack/plugins/journey.js`](../examples/demo-pack/plugins/journey.js) traces each leg of a journey with a
moving marker while the tour's camera flies. It is 30 lines long:

```js
export default function setup(atlas) {
  const empty = { type: "FeatureCollection", features: [] };
  const leg = atlas.addLayer({ id: "journey-leg", chip: false, data: empty, type: "line", color: "#e0a526", width: 5 });
  const head = atlas.addLayer({ id: "journey-head", chip: false, data: empty, type: "circle", color: "#e0a526", radius: 8 });
  let frame = 0, enabled = true;

  const clear = () => { cancelAnimationFrame(frame); leg.setData(empty); head.setData(empty); };
  atlas.addToggle({ id: "journey", name: "Journey playback", name_zh: "行程回放" }, (on) => { enabled = on; if (!on) clear(); });

  atlas.on("tour-step", ({ index, steps, path }) => {
    clear();
    if (!enabled || !path || index === 0) return;
    // ...animate from steps[index - 1].at to steps[index].at with requestAnimationFrame
  });
  atlas.on("tour-end", clear);
}
```

Try it at `/?pack=examples/demo-pack/manifest.json&packonly=1#tour=paul-first&s=1`.

## Embedding

With `?embed=1` the atlas shows only the map and a small period label. The panels, the timeline and the tour card are
hidden, and tours frame their stops for the whole map. Use it when the host page shows the story itself, beside the
map.

To move an embedded atlas without reloading it, let your pack's plugin listen to the host page with `postMessage`,
and report back what the visitor does on the map:

```js
export default function setup(atlas) {
  if (window.parent === window) return;                 // not embedded
  const HOST = "https://example.org";                   // your app's site
  addEventListener("message", (e) => {
    if (e.source !== window.parent || e.origin !== HOST) return;
    if (e.data.type === "tour") atlas.startTour(e.data.id, e.data.step);
    if (e.data.type === "year") atlas.setYear(e.data.year);
  });
  atlas.on("tour-step", ({ id, index }) => window.parent.postMessage({ type: "tour-step", id, index }, HOST));
}
```

Check the sender's origin on every message, and name your own site as the target when you post back. The Bible
reader's [bridge plugin](https://github.com/daiyip/interactive-bible/blob/main/atlas/plugins/bridge.js) is a complete
example: the reader starts tours and pins a verse's places, and the atlas sends back tour steps and clicked verses.

