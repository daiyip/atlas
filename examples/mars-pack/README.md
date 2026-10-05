# Mars demo pack

Shows that a pack can bring its own world: this one replaces Earth with Mars (manifest `basemap`) and adds a small
timeline of Mars exploration (1960 to today), 17 events and a "Landing on Mars" tour.

Open it with `/?pack=examples/mars-pack/manifest.json&packonly=1` (a base map applies only to a pack shown alone).

- `tiles/img`: Viking MDIM 2.1 colour mosaic, zooms 0-4, from OpenPlanetary's tile service (re-saved as JPEG).
- `tiles/dem`: heights at zooms 0-3, converted from OpenPlanetary's MOLA grey shaded-relief tiles. The grey level is
  mapped linearly onto MOLA's range (−8,200 m to +21,229 m), so heights are approximate and carry some shading.
- `labels.json`: names of volcanoes, basins and plains, shown by the Landscape switch.

Event summaries are AI-drafted from public mission records.
