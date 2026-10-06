"""Fetch CHGIS (China Historical GIS, Harvard) V6 time-series data from Harvard Dataverse (run by
.github/workflows/chgis.yml, since Dataverse is reachable from GitHub's runners but not from the build machine).

Searches Dataverse for CHGIS datasets, saves each dataset's metadata (title, licence, file list) to
<out>/datasets.json and downloads the files of the time-series datasets into <out>/files/<dataset>/.
tools/build_admin.py turns them into data/admin.json."""
import json, os, re, sys, time, urllib.parse, urllib.request

UA = {"User-Agent": "Atlas/1.0 (https://github.com/daiyip/atlas; educational history map)"}
DV = "https://dataverse.harvard.edu"
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
MAX = 90 * 1024 * 1024
os.makedirs(OUT, exist_ok=True)


def get(url, raw=False):
    for i in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300)
            return r.read() if raw else json.load(r)
        except Exception as e:
            print("retry", url, e, file=sys.stderr); time.sleep(5 * (i + 1))
    return None


found = {}
for q in ["CHGIS", "China Historical GIS", "CHGIS V6 time series"]:
    start = 0
    while True:
        r = get(f"{DV}/api/search?" + urllib.parse.urlencode({"q": q, "type": "dataset", "per_page": 100, "start": start}))
        items = (r or {}).get("data", {}).get("items", [])
        for it in items:
            found[it["global_id"]] = it.get("name", "")
        if len(items) < 100: break
        start += 100
print(len(found), "datasets", file=sys.stderr)

meta = {}
for gid, name in sorted(found.items()):
    d = get(f"{DV}/api/datasets/:persistentId/?persistentId={urllib.parse.quote(gid)}")
    if not d: continue
    v = d.get("data", {}).get("latestVersion", {})
    files = [{"id": f["dataFile"]["id"], "name": f["dataFile"].get("filename"), "size": f["dataFile"].get("filesize"),
              "restricted": f.get("restricted")} for f in v.get("files", [])]
    meta[gid] = {"name": name, "license": v.get("license"), "terms": v.get("termsOfUse"), "files": files}
    if not re.search(r"chgis", name, re.I) or not re.search(r"time.?series|v6|version 6", name, re.I):
        continue
    folder = os.path.join(OUT, "files", re.sub(r"[^A-Za-z0-9]+", "_", gid))
    for f in files:
        if f["restricted"] or (f["size"] or 0) > MAX: continue
        b = get(f"{DV}/api/access/datafile/{f['id']}?format=original", raw=True) or get(f"{DV}/api/access/datafile/{f['id']}", raw=True)
        if b is None: f["error"] = "download failed"; continue
        os.makedirs(folder, exist_ok=True)
        open(os.path.join(folder, f["name"]), "wb").write(b)
        f["saved"] = True
        print("saved", gid, f["name"], len(b), file=sys.stderr)
json.dump(meta, open(os.path.join(OUT, "datasets.json"), "w"), ensure_ascii=False, indent=1)
