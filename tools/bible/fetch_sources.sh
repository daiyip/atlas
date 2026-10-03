#!/bin/sh
# Downloads the sources for build_bible.py into tools/bible/src (not committed).
# Theographic Bible Metadata (CC BY-SA 4.0); KJV (public domain) and 和合本 (public domain) via scrollmapper/bible_databases (MIT).
set -e
cd "$(dirname "$0")"
mkdir -p src
T=https://raw.githubusercontent.com/robertrouse/theographic-bible-metadata/cfb1c485d4da6fb63a69cb3b7f5b0752792f46bc/json
for f in books events people places verses; do curl -sSfo src/$f.json $T/$f.json; done
B=https://raw.githubusercontent.com/scrollmapper/bible_databases/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/formats/json
curl -sSfo src/KJV.json $B/KJV.json
curl -sSfo src/ChiUn.json $B/ChiUn.json
