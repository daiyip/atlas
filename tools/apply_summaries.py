"""Write the summary review into events.json: python3 tools/apply_summaries.py [tools/summary_verdicts.json]

Each verdict ({"id", "s": ok|fixed|doubt, "summary", "summary_zh", "n", "n_zh"}) comes from comparing an event's
summary with its Wikipedia articles (tools/fact_deep.py with `events`, reviewed by AI against that text only).
It is stored as the event's `sum` mark; a fix replaces the summary and keeps the old text in sum.was. Re-running
restores the original summaries first, so it can be applied again after the verdicts change."""
import json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
V = {v["id"]: v for v in json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools/summary_verdicts.json")))}
p = os.path.join(ROOT, "data/events.json")
raw = open(p).read()
evs = json.loads(raw)
n = {"ok": 0, "fixed": 0, "doubt": 0}
for e in evs:
    old = e.pop("sum", None) or {}
    e.update(old.get("was") or {})
    v = V.get(e["id"])
    if not v: continue
    m = {"s": v["s"]}
    if v["s"] == "fixed":
        new = {k: v[k] for k in ("summary", "summary_zh") if v.get(k) and v[k] != e.get(k)}
        if new:
            m["was"] = {k: e.get(k) for k in new}
            e.update(new)
    for k in ("n", "n_zh"):
        if v.get(k): m[k] = v[k]
    e["sum"] = m
    n[m["s"]] += 1
ind = 1 if raw.startswith("[\n {") else 2 if raw.startswith("[\n  ") else None
json.dump(evs, open(p, "w"), ensure_ascii=False, indent=ind, separators=None if ind else (",", ":"))
if raw.endswith("\n"): open(p, "a").write("\n")
print(n)
