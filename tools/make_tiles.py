"""Turn a picture of a world into map tiles for a pack's base map (manifest `basemap`, docs/custom-ground.md).

Input pictures are plate carrée ("equirectangular"): x runs evenly from west to east, y evenly from north to south,
the usual layout of planet maps and of most drawn fantasy maps. The tiles come out as XYZ Web Mercator, which is what
the atlas (MapLibre) reads.

  # imagery: a picture of the whole planet
  python3 tools/make_tiles.py imagery mars.jpg out/tiles/img --zoom 4
  # elevation: a grey height map, black = --low metres, white = --high metres (8- or 16-bit)
  python3 tools/make_tiles.py heights mars-heights.png out/tiles/dem --zoom 3 --low -8200 --high 21229
  # a map that covers only part of the globe: say where its edges are
  python3 tools/make_tiles.py imagery shire.png out/tiles/img --zoom 6 --bounds=-20,-12,20,12
  # tiles downloaded from a TMS server (row 0 at the south): renumber them to XYZ in place
  python3 tools/make_tiles.py flip out/tiles/img

Zoom 4 is 4,096 pixels around the equator; each zoom doubles that. Pick the zoom where the tiles are about as sharp as
your picture: a picture W pixels wide is used fully at zoom log2(W / 256).
Needs numpy and Pillow.
"""
import argparse
import math
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
MAX_LAT = 85.0511287798  # Web Mercator stops here


def tile_lonlat(z, x, y, size=256):
    """Longitude and latitude of each pixel centre in tile z/x/y (XYZ, row 0 at the north)."""
    n = 2 ** z
    px = (x + (np.arange(size) + 0.5) / size) / n
    py = (y + (np.arange(size) + 0.5) / size) / n
    lon = px * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * py))))
    return np.meshgrid(lon, lat)


def sample(src, lon, lat, bounds):
    """Bilinear sample of a plate carrée array at lon/lat; NaN where the picture does not reach."""
    w, s, e, n = bounds
    h, wd = src.shape[:2]
    fx = (lon - w) / (e - w) * wd - 0.5
    fy = (n - lat) / (n - s) * h - 0.5
    inside = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
    fx = np.clip(fx, 0, wd - 1.001)
    fy = np.clip(fy, 0, h - 1.001)
    x0, y0 = fx.astype(int), fy.astype(int)
    tx, ty = fx - x0, fy - y0
    if src.ndim == 3:
        tx, ty = tx[..., None], ty[..., None]
    v = (src[y0, x0] * (1 - tx) * (1 - ty) + src[y0, x0 + 1] * tx * (1 - ty)
         + src[y0 + 1, x0] * (1 - tx) * ty + src[y0 + 1, x0 + 1] * tx * ty)
    return v, inside


def tiles_for(z, bounds):
    """The tiles at zoom z that the bounds touch."""
    w, s, e, n = bounds
    n2 = 2 ** z
    def tx(lon): return min(n2 - 1, max(0, int((lon + 180) / 360 * n2)))
    def ty(lat):
        lat = max(-MAX_LAT, min(MAX_LAT, lat))
        r = math.radians(lat)
        return min(n2 - 1, max(0, int((1 - math.asinh(math.tan(r)) / math.pi) / 2 * n2)))
    for x in range(tx(w), tx(e) + 1):
        for y in range(ty(n), ty(s) + 1):
            yield x, y


def terrarium(h):
    """Heights in metres as Terrarium RGB: (R * 256 + G + B / 256) - 32768."""
    v = np.clip(h + 32768.0, 0, 65535.99)
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.floor((v - r * 256 - g) * 256)
    return np.stack([r, g, b], -1).astype(np.uint8)


def run(kind, src_path, out, zoom, bounds, low, high, background, quality):
    img = Image.open(src_path)
    if kind == "imagery":
        src = np.asarray(img.convert("RGB"), dtype=np.float32)
        bg = np.array([int(background[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)
    else:
        a = np.asarray(img)
        if a.ndim == 3:
            a = a[..., :3].mean(-1)
        top = 65535.0 if a.dtype == np.uint16 or a.max() > 255 else 255.0
        src = low + a.astype(np.float32) / top * (high - low)
    count = 0
    for z in range(zoom + 1):
        for x, y in tiles_for(z, bounds):
            lon, lat = tile_lonlat(z, x, y)
            v, inside = sample(src, lon, lat, bounds)
            if not inside.any():
                continue
            os.makedirs(f"{out}/{z}/{x}", exist_ok=True)
            if kind == "imagery":
                v = np.where(inside[..., None], v, bg)
                Image.fromarray(v.round().clip(0, 255).astype(np.uint8)).save(f"{out}/{z}/{x}/{y}.jpg", quality=quality)
            else:
                v = np.where(inside, v, low)
                Image.fromarray(terrarium(v)).save(f"{out}/{z}/{x}/{y}.png", optimize=True)
            count += 1
    print(f"{count} tiles in {out} (zooms 0-{zoom})")


def flip(folder):
    """Renumber TMS rows (0 at the south) to XYZ (0 at the north), in place."""
    moved = 0
    for z in sorted(os.listdir(folder)):
        if not z.isdigit():
            continue
        n = 2 ** int(z)
        for x in os.listdir(f"{folder}/{z}"):
            d = f"{folder}/{z}/{x}"
            files = os.listdir(d)
            for f in files:
                os.rename(f"{d}/{f}", f"{d}/~{f}")
            for f in files:
                y, ext = os.path.splitext(f)
                os.rename(f"{d}/~{f}", f"{d}/{n - 1 - int(y)}{ext}")
                moved += 1
    print(f"renumbered {moved} tiles")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("kind", choices=["imagery", "heights", "flip"])
    ap.add_argument("source", help="the picture (imagery, heights) or the tile folder (flip)")
    ap.add_argument("out", nargs="?", help="output tile folder")
    ap.add_argument("--zoom", type=int, default=4, help="highest zoom to make (default 4)")
    ap.add_argument("--bounds", default="-180,-90,180,90", help="west,south,east,north of the picture, written --bounds=W,S,E,N (default: the whole globe)")
    ap.add_argument("--low", type=float, default=0, help="heights: metres for black")
    ap.add_argument("--high", type=float, default=5000, help="heights: metres for white")
    ap.add_argument("--background", default="#000000", help="imagery: colour outside the picture")
    ap.add_argument("--quality", type=int, default=82, help="imagery: JPEG quality")
    a = ap.parse_args()
    if a.kind == "flip":
        return flip(a.source)
    if not a.out:
        sys.exit("give an output folder")
    bounds = tuple(float(v) for v in a.bounds.split(","))
    run(a.kind, a.source, a.out, a.zoom, bounds, a.low, a.high, a.background, a.quality)


if __name__ == "__main__":
    main()
