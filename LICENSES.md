# Licences

The atlas engine is source-available under the [Business Source License 1.1](LICENSE): free for personal,
educational, non-profit, private-network and pack-development use, but not for running a competing public atlas
site. Each version becomes [MIT](https://opensource.org/license/mit) three years after it is first published.

What grows around the engine is open:

| Path | What it is | Licence |
| --- | --- | --- |
| `data/` (events, stories, tours, eras, people, places, layers) | The atlas's own content | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), except the third-party data below |
| `data/borders/` | Borders derived from [historical-basemaps](https://github.com/aourednik/historical-basemaps) and [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria) | GPL-3.0, with Cliopatria data under CC BY 4.0 |
| `data/geo/` | Rivers, lakes and land from [Natural Earth](https://www.naturalearthdata.com/) | Public domain |
| Satellite imagery tiles | Sentinel-2 cloudless by EOX and Sentinel Hub | CC BY 4.0 |
| Illustrations from Wikimedia Commons | Pictures in event stories and person cards | The licence shown under each picture |
| `examples/` | Example data packs and plugins | Code MIT ([`examples/LICENSE`](examples/LICENSE)), data CC BY-SA 4.0 |
| `vendor/` | MapLibre GL JS stylesheet | BSD-3-Clause |

**Your own packs and plugins are yours.** A data pack or plugin that runs on the atlas through its documented
interfaces ([docs/custom-data.md](docs/custom-data.md), [docs/plugins.md](docs/plugins.md)) is not a derivative of
the engine, and you may license it however you like.

**The name.** The licences cover code and data, not the name. A copy of the engine that others can reach should say
it is not the official atlas.
