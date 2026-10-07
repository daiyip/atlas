"""Generate AI illustrations through the OpenAI Batch API (half price, results within 24 hours).

Usage: python3 tools/ai_batch.py submit OUT_DIR [event id ...]   # ids default to every prompt without a picture yet
       python3 tools/ai_batch.py collect OUT_DIR                 # saves finished results to OUT_DIR/openai/<id>.webp
Prompts come from tools/ai_prompts.json and get the same rules as tools/ai_illustrate.py. The batch ids are kept in
OUT_DIR/batches.json. Each batch holds CHUNK requests, so one result file (base64 WebP images) stays near 100 MB."""
import base64, json, os, sys
from openai import OpenAI
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ai_illustrate import RULES, MODELS, ROOT
from usage import record
CHUNK = 250

def have(out, i):
    return any(os.path.exists(os.path.join(out, "openai", i + ext)) for ext in (".png", ".webp"))

def submit(client, out, ids):
    prompts = json.load(open(os.path.join(ROOT, "tools/ai_prompts.json")))
    ids = [i for i in (ids or prompts) if not have(out, i)]
    log_path = os.path.join(out, "batches.json")
    log = json.load(open(log_path)) if os.path.exists(log_path) else []
    pending = {i for b in log if b["state"] != "collected" for i in b["ids"]}
    ids = [i for i in ids if i not in pending]
    for k in range(0, len(ids), CHUNK):
        part = ids[k:k + CHUNK]
        path = os.path.join(out, f"batch-in-{len(log)}.jsonl")
        with open(path, "w") as f:
            for i in part:
                f.write(json.dumps({"custom_id": i, "method": "POST", "url": "/v1/images/generations", "body": {
                    "model": MODELS["openai"], "prompt": prompts[i] + RULES, "size": "1536x1024", "quality": "medium",
                    "output_format": "webp", "output_compression": 90}}) + "\n")
        fid = client.files.create(file=open(path, "rb"), purpose="batch").id
        b = client.batches.create(input_file_id=fid, endpoint="/v1/images/generations", completion_window="24h")
        log.append({"id": b.id, "ids": part, "state": "submitted"})
        json.dump(log, open(log_path, "w"), indent=1)
        print("submitted", b.id, len(part), flush=True)

def collect(client, out):
    log_path = os.path.join(out, "batches.json")
    log = json.load(open(log_path))
    os.makedirs(os.path.join(out, "openai"), exist_ok=True)
    for entry in log:
        if entry["state"] == "collected": continue
        b = client.batches.retrieve(entry["id"])
        c = b.request_counts
        print(entry["id"], b.status, f"{c.completed}/{c.total} done, {c.failed} failed" if c else "", flush=True)
        if b.status not in ("completed", "expired", "cancelled", "failed"): continue
        for fid in (b.output_file_id, b.error_file_id):
            if not fid: continue
            for line in client.files.content(fid).text.splitlines():
                r = json.loads(line)
                body = (r.get("response") or {}).get("body") or {}
                u = body.get("usage") or {}
                if u: record(out, MODELS["openai"], r["custom_id"], u.get("input_tokens", 0), u.get("output_tokens", 0), batch=True)
                if body.get("data"):
                    open(os.path.join(out, "openai", r["custom_id"] + ".webp"), "wb").write(base64.b64decode(body["data"][0]["b64_json"]))
                else:
                    print("FAIL", r["custom_id"], json.dumps(r.get("error") or body.get("error"))[:200], flush=True)
        entry["state"] = "collected"
        json.dump(log, open(log_path, "w"), indent=1)

if __name__ == "__main__":
    cmd, out, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
    client = OpenAI()
    submit(client, out, ids) if cmd == "submit" else collect(client, out)
