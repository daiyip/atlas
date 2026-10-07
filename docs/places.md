# The place graph

Where a place lies and who held it change with time: 吐鲁番盆地 is always in 新疆, but it was held by 高昌, the
Tang, the Uyghurs, the Chaghatai khans, the Qing and China in turn. The place graph keeps the two apart. **Nodes** are
places and states, with ids that never change. **Edges** say how one belongs to another, each with its own years.
Selections, links and saved views keep only an id, so they stay valid whatever happens to the place later.

The format is part of the [Atlas format](custom-data.md#versions) from format 2. The atlas's own graph is
`data/graph.json` (with the files it includes), and a pack can add its own places (see [Packs](#packs)).

## Nodes

```json
{"id":"area:taiwan","kind":"area","name":"Taiwan","name_zh":"台湾","geo":{"poly":[[119.95,23.0],"…"]},"intro":"…","intro_zh":"…","notes":[…]}
```

| Key | Meaning |
| --- | --- |
| `id` | `<kind>:<name>`, unique, and **never changed or removed** once published. A pack's ids start with its own id: `demo:area:cyprus`. |
| `kind` | One of the kinds below. |
| `name`, `name_zh` | Display names. |
| `from`, `to` | The years the thing existed, both included; negative is BCE, there is no year 0; missing or `null` = no limit (`to: null` = still exists). Areas usually have neither. |
| `geo` | Where it is: `poly` (an outline `[[lon, lat], …]`), `src` (`"<file in data/>#<id>"`, a feature in another file such as `disputes.json#kurils`), `label` (`[lon, lat]`). |
| `intro`, `intro_zh` | A line or two about the place. |
| `notes` | `[{from, to, en, zh, disputed}]`: what a reader should know about some years (no state held it, a contested status). `disputed: true` marks the years on the 地区史 strip. |
| `replacedBy` | When two nodes turn out to be one: the id to use instead. The old id stays and still resolves. |

| Kind | Example | Where its shape comes from |
| --- | --- | --- |
| `group` | `group:east-asia` 东亚 | its regions |
| `region` | `region:china` 中国与东亚大陆 | `regions.json` (its timeline and outline) |
| `area` | `area:taiwan`, `area:turpan` | a hand-drawn outline that does not change |
| `polity` | `polity:qing`, `polity:roc` | the border maps, through `name` edges |
| `map` | `map:Qing`, `map:China` | a name as drawn on the border maps |
| `admin` | (reserved) 西州, 台湾府 | a seat, with a sketch area |
| `city` | (reserved) 长安 | a point |

`admin` and `city` are reserved: the format accepts them now, so prefectures and counties can be added later without
a new format, but the atlas does not draw them yet.

## Edges

```json
{"child":"area:taiwan","parent":"polity:prc","rel":"claim","from":1949,"to":null,"disputed":true,"dispute":"taiwan"}
```

| `rel` | Meaning | From → to | Years | Several at once |
| --- | --- | --- | --- | --- |
| `in` | lies within (geography) | region, area, admin, city → group, region, area, admin | none: it does not change | no, one parent |
| `held` | actually controlled by | area, admin, city → polity, map | yes | yes, with `share` (percent) |
| `claim` | claimed by | area, admin, city → polity | yes | yes |
| `part` | a state under another (vassal, protectorate) | polity → polity | yes | yes |
| `name` | a name on the border maps means this state | map → polity | yes | yes |

Other keys: `share` (percent of the place, for `held`), `by` (`"maps"`: worked out by a script from the maps, or
`"hand"`, the default), `disputed`, `dispute` (the id in `data/disputes.json` whose card tells the story), `note` and
`note_zh`.

Rules (checked by `tools/check_graph.py`):

- `in` edges form a tree: one parent each, no loops. So the path above a place (东亚 › 中国 › 新疆 › 吐鲁番盆地) never
  depends on the year; what changes with the year is who held it. `in` is geography, not sovereignty: a disputed
  place sits under the region whose outline holds it, or under the group when it falls between regions.
- `held`, `claim` and `part` edges fall within the years both their nodes existed.
- The `held` shares of one place in one year add up to 100 at most (give or take rounding). What is missing is land no
  state held on the maps, or holders under 10% that the build drops.
- `claim` is for places whose status is really disputed (those in `data/disputes.json`), not every claim a state
  ever made.
- `part` is defined now but not drawn yet.
- When a hand edge and one worked out from the maps disagree, the hand one wins.

## Asking the graph

- **Where is it?** Follow `in` edges up: `placePath("area:turpan", 1800)` is
  `["area:turpan", "area:xinjiang", "region:china", "group:east-asia"]`.
- **Who held it?** The `held` edges in that year, a map name resolved to its state through `name` edges:
  `placeHeld("area:taiwan", 1700)` is `[{id: "map:Qing", polity: "polity:qing", share: 81}]`.
- **When did it change hands?** The years where its edges start and end.
- **Who claimed it?** The `claim` edges in that year.

Plugins get the same through [`atlas.places`](plugins.md#the-atlas-object).

## Files

A graph file is either:

- **JSON**: `{"atlas": 2, "note": "…", "include": [...], "nodes": [...], "edges": [...]}`, each key optional, or
- **JSONL**: one record per line. A line with `id` is a node, a line with `child` is an edge, `{"include": "path"}`
  (or a list) pulls in other files, and a line with only `atlas`, `note` or `span` is a header.

Include paths are relative to the file that names them. Includes may nest but must not loop. An id may be defined
once in the whole graph; a second definition is an error, never a silent override. The order of lines doesn't
matter.

## How the files are organised

This is a convention, not part of the format: the files can be split and moved without changing anything that reads
the graph, as long as no id changes. Ids say nothing about which file a record is in.

The atlas's own graph today:

```
data/graph.json                      includes the files below
data/graph/<group>.jsonl             hand-written, one per region group: east-asia, inner-asia, south-southeast-asia,
                                     west-asia-north-africa, europe, africa, americas
data/graph/maps.jsonl                built by tools/build_graph.py; do not edit
```

- Data is split by category first (`data/graph/`, and later `data/events/` …), then by region group, because each
  category has one format, one checker and one builder, and the app loads a category at a time.
- Hand-written and built records never share a file, so a rebuild cannot touch hand work.
- An edge goes in the file of its `child`. A node goes in the file of the group its `in` path reaches; a state in the
  group of its home ground.
- A new region adds a file to each category it has data in, plus a line in that category's include list. Content
  that should stay together (a contribution, a region worked on as a whole) can instead be one folder, like a pack,
  whose files the category indexes include.

What is in the graph so far, and what still lives elsewhere:

| In the graph | Kept in its own file for now (the graph refers to it) |
| --- | --- |
| areas, their outlines, notes and `in` edges | regions and groups: `regions.json` (timelines, outlines) |
| claims on the disputed places | dispute shapes and cards: `disputes.json` |
| polities and the names they go by (built) | the country table: `lineages.json`, which `build_graph.py` turns into polity nodes and `name` edges |
| who held each area (built) | country periods: `country-periods.json` |

## Packs

A pack adds places with `data.graph` in its manifest (format 2):

```json
"atlas": 2,
"data": { "eras": "eras.json", "events": "events.json", "graph": "places.jsonl" }
```

- Its own ids start with `<pack id>:` (`demo:area:cyprus`), and its edges start from its own places. Their parents
  may be the atlas's own nodes, such as `polity:rome`.
- The pack's region is the node `region:<pack id>`; put a top-level area `in` it.
- Areas with an outline get a 地区史 card, search results and the map click like the atlas's own. Hand `held` edges
  give the strip its holders.

The [demo pack](../examples/demo-pack/) has one: `places.jsonl`, Cyprus.

## Checking

```sh
python3 tools/check_graph.py          # the atlas's own graph
python3 tools/validate.py my-pack     # a pack, including its graph
```

## Rebuilding

After border changes, or after editing `lineages.json`, `regions.json` or a hand-written graph file:

```sh
python3 tools/build_graph.py && python3 tools/check_graph.py
```
