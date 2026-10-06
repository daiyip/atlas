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
    for i in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120)
            return r.read() if raw else json.load(r)
        except Exception as e:
            print("retry", url, e, file=sys.stderr); time.sleep(5 * (i + 1))
    return None


# The V6 dataverse holds the time-series layers; the EULA and README say how they may be used.
found = {}
for x in (get(f"{DV}/api/dataverses/2966391/contents") or {}).get("data", []):
    if x.get("type") == "dataset": found[f"{x['protocol']}:{x['authority']}/{x['identifier']}"] = ""
for gid in ["doi:10.7910/DVN/WW1PD6", "doi:10.7910/DVN/I0Q7SM", "doi:10.7910/DVN/FDLFJ3", "doi:10.7910/DVN/6CHSR7", "doi:10.7910/DVN/SNCEAU"]:
    found[gid] = ""
print(len(found), "datasets", file=sys.stderr)

meta = {}
for gid, name in sorted(found.items()):
    d = get(f"{DV}/api/datasets/:persistentId/?persistentId={urllib.parse.quote(gid)}")
    if not d: continue
    v = d.get("data", {}).get("latestVersion", {})
    files = [{"id": f["dataFile"]["id"], "name": f["dataFile"].get("filename"), "size": f["dataFile"].get("filesize"),
              "restricted": f.get("restricted")} for f in v.get("files", [])]
    name = name or next((f["value"] for blk in v.get("metadataBlocks", {}).values() for f in blk.get("fields", []) if f.get("typeName") == "title"), "")
    meta[gid] = {"name": name, "license": v.get("license"), "terms": v.get("termsOfUse"), "files": files}
    json.dump(meta, open(os.path.join(OUT, "datasets.json"), "w"), ensure_ascii=False, indent=1)
    print("dataset", gid, name, [f["name"] for f in files], flush=True)
    if not re.search(r"time.?series|eula|readme|dictionary", name, re.I):
        continue
    folder = os.path.join(OUT, "files", re.sub(r"[^A-Za-z0-9]+", "_", gid))
    for f in files:
        if f["restricted"] or (f["size"] or 0) > MAX: continue
        if not re.search(r"pts|point|pgn|polygon|\.csv|\.txt|\.xls|readme|\.pdf", f["name"] or "", re.I): continue
        b = get(f"{DV}/api/access/datafile/{f['id']}?format=original", raw=True) or get(f"{DV}/api/access/datafile/{f['id']}", raw=True)
        if b is None: f["error"] = "download failed"; continue
        os.makedirs(folder, exist_ok=True)
        open(os.path.join(folder, f["name"]), "wb").write(b)
        f["saved"] = True
        print("saved", gid, f["name"], len(b), file=sys.stderr)
json.dump(meta, open(os.path.join(OUT, "datasets.json"), "w"), ensure_ascii=False, indent=1)
