"""Narrate every tour step's Chinese caption (data/tours.json and the life journeys in data/lives.json) with Google Gemini 2.5 Pro TTS, in each of VOICES.

The text read is the step's speaking script from tools/narration_scripts.json ({"<tour>/<step>": {"script", "direct"}}:
the caption with pauses and stress marked by punctuation, plus a one-line direction for that step), written from the
caption; a step without a script reads its caption as is.

Usage: python3 tools/ai_narration.py OUT_DIR direct [tour id ...]       # parallel requests (THREADS, default 8)
       python3 tools/ai_narration.py OUT_DIR submit [tour id ...]       # Gemini Batch Mode, half price
       python3 tools/ai_narration.py OUT_DIR collect                    # save finished batches
       python3 tools/ai_narration.py OUT_DIR run [tour id ...]          # submit and collect in a loop until done
       python3 tools/ai_narration.py OUT_DIR status                     # progress: done / left / queued / flagged
                                                                        # (the project's batch queue is small)
Reads GOOGLE_API_KEY. Writes OUT_DIR/<tour>__<step>__<voice>__<hash>.wav (24 kHz mono), where <hash> is a CRC of the
caption (not the script), so an edited caption gets new narration and the old file is left unused. Existing files are
skipped. Batch ids are kept in OUT_DIR/batches.json."""
import base64, json, os, sys, time, urllib.error, urllib.request, wave, zlib
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MODEL, VOICES = "gemini-2.5-pro-preview-tts", ["Charon", "Kore"]
API = "https://generativelanguage.googleapis.com"
STYLE = ("你是历史纪录片的旁白，讲一段历史故事，要有明显的重音和起伏，像在讲给听众听，而不是念稿。"
         "整体语速比平常稍快、流畅紧凑，停顿短而干脆。用标准普通话。")

def text_hash(text): return format(zlib.crc32(text.encode()), "08x")

def steps(only):
    # The guided tours and the life journeys (data/lives.json), which the app lists as tours too.
    tours = [tr for f in ("data/tours.json", "data/lives.json") for tr in json.load(open(os.path.join(ROOT, f)))]
    for tr in tours:
        if only and tr["id"] not in only: continue
        for i, s in enumerate(tr["steps"]):
            if s.get("text_zh"): yield tr["id"], i, s["text_zh"]

def request(key, caption, voice):
    sc = SCRIPTS.get(key) or {}
    prompt = STYLE + (sc.get("direct") or "") + "\n\n请朗读：" + (sc.get("script") or caption)
    return {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}

def save(path, part):
    raw = base64.b64decode(part["data"])
    if part.get("mimeType", "").startswith("audio/wav"): open(path, "wb").write(raw)
    else:
        with wave.open(path, "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(raw)

def call(method, path, body=None, tries=6, raw=False):
    for k in range(tries):
        try:
            req = urllib.request.Request(API + path, json.dumps(body).encode() if body is not None else None,
                                         {"Content-Type": "application/json", "x-goog-api-key": os.environ["GOOGLE_API_KEY"]}, method=method)
            data = urllib.request.urlopen(req, timeout=600).read()
            return data if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503) or k == tries - 1: raise
            time.sleep(15 * (k + 1))

def jobs(out, only):
    for t, i, caption in steps(only):
        for v in VOICES:
            path = os.path.join(out, f"{t}__{i}__{v}__{text_hash(caption)}.wav")
            if not os.path.exists(path): yield f"{t}/{i}", caption, v, path

def direct(out, only):
    def one(job):
        key, caption, v, path = job
        try:
            r = call("POST", f"/v1beta/models/{MODEL}:generateContent", request(key, caption, v))
            save(path, r["candidates"][0]["content"]["parts"][0]["inlineData"])
        except Exception as e: print("FAIL", key, v, (e.read().decode()[:200] if hasattr(e, "read") else str(e))[:200], flush=True)
    # Alongside a running batch loop: skip what is queued in a batch, and (REVERSE=1) work from the end of the list
    # while the loop submits from the front, so the two meet in the middle.
    log_path = os.path.join(out, "batches.json")
    queued = {k for b in json.load(open(log_path)) if b["state"] != "collected" for k in b["keys"]} if os.path.exists(log_path) else set()
    todo = [j for j in jobs(out, only) if os.path.basename(j[3]) not in queued]
    if os.environ.get("REVERSE"): todo.reverse()
    def guarded(job):
        if not os.path.exists(job[3]): one(job)  # the batch loop may have saved it meanwhile
    with ThreadPoolExecutor(int(os.environ.get("THREADS", 8))) as ex: list(ex.map(guarded, todo))
    print(len(todo), "requests")

def upload_jsonl(path):
    size = os.path.getsize(path)
    start = urllib.request.Request(API + "/upload/v1beta/files", json.dumps({"file": {"display_name": os.path.basename(path)}}).encode(),
        {"Content-Type": "application/json", "x-goog-api-key": os.environ["GOOGLE_API_KEY"], "X-Goog-Upload-Protocol": "resumable",
         "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": str(size), "X-Goog-Upload-Header-Content-Type": "application/jsonl"})
    url = urllib.request.urlopen(start, timeout=120).headers["X-Goog-Upload-URL"]
    put = urllib.request.Request(url, open(path, "rb").read(), {"X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize",
                                                                "Content-Length": str(size)})
    return json.load(urllib.request.urlopen(put, timeout=600))["file"]["name"]

def submit(out, only, chunk=int(os.environ.get("CHUNK", 400))):
    log_path = os.path.join(out, "batches.json")
    log = json.load(open(log_path)) if os.path.exists(log_path) else []
    pending = {k for b in log if b["state"] != "collected" for k in b["keys"]}
    todo = [j for j in jobs(out, only) if os.path.basename(j[3]) not in pending]
    for n in range(0, len(todo), chunk):
        part = todo[n:n + chunk]
        jl = os.path.join(out, f"batch-in-{len(log)}.jsonl")
        with open(jl, "w") as f:
            for key, caption, v, path in part:
                f.write(json.dumps({"key": os.path.basename(path), "request": request(key, caption, v)}, ensure_ascii=False) + "\n")
        try:
            r = call("POST", f"/v1beta/models/{MODEL}:batchGenerateContent",
                     {"batch": {"display_name": f"atlas-narration-{len(log)}", "input_config": {"file_name": upload_jsonl(jl)}}}, tries=1)
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            print("queue full; submitted what fits", flush=True)  # Gemini caps how much a project may have queued
            return
        log.append({"name": r["name"], "keys": [os.path.basename(p) for *_, p in part], "state": "submitted"})
        json.dump(log, open(log_path, "w"), indent=1)
        print("submitted", r["name"], len(part), flush=True)

def collect(out):
    log_path = os.path.join(out, "batches.json")
    log = json.load(open(log_path))
    for b in log:
        if b["state"] == "collected": continue
        r = call("GET", f"/v1beta/{b['name']}")
        state = r.get("metadata", {}).get("state") or r.get("state")
        print(b["name"], state, json.dumps(r.get("metadata", {}).get("batchStats")), flush=True)
        if not state.endswith(("SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED")): continue
        f = (r.get("response") or {}).get("responsesFile")
        if f:
            for line in call("GET", f"/download/v1beta/{f}:download?alt=media", raw=True).decode().splitlines():
                x = json.loads(line)
                try: save(os.path.join(out, x["key"]), x["response"]["candidates"][0]["content"]["parts"][0]["inlineData"])
                except Exception: print("FAIL", x.get("key"), json.dumps(x.get("error") or x.get("response"))[:200], flush=True)
        b["state"] = "collected"
        json.dump(log, open(log_path, "w"), indent=1)

def run(out, only):
    """Keep the batch queue full until every step is narrated: collect, submit what fits, wait, repeat."""
    while True:
        try:
            if os.path.exists(os.path.join(out, "batches.json")): collect(out)
            left = list(jobs(out, only))
            if not left: print("all narrated"); return
            submit(out, only)
            print(len(left), "files still to come", flush=True)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:  # a dropped connection: try again next round
            print("network trouble, retrying:", str(e)[:120], flush=True)
        time.sleep(120)

def status(out, only):
    """Where a run stands: clips done and left, batches queued, screening results (tools/check_narration.py), last errors.
    Every command resumes where it stopped (finished clips are files; queued batches are in batches.json)."""
    total = sum(len(VOICES) for _ in steps(only))
    left = len(list(jobs(out, only)))
    log_path, checks_path = os.path.join(out, "batches.json"), os.path.join(out, "checks.json")
    log = json.load(open(log_path)) if os.path.exists(log_path) else []
    queued = [b for b in log if b["state"] != "collected"]
    print(f"narrated {total - left}/{total} ({100 * (total - left) // max(total, 1)}%), {left} left")
    print(f"batches: {len(log)} submitted, {len(queued)} still queued ({sum(len(b['keys']) for b in queued)} clips)")
    if os.path.exists(checks_path):
        checks = json.load(open(checks_path))
        print(f"screened {len(checks)}, flagged {sum(bool(r.get('flag') or r.get('error')) for r in checks.values())}")
    for name in ("run.log", "direct.log"):
        p = os.path.join(out, name)
        if os.path.exists(p):
            fails = [l for l in open(p, errors="replace") if l.startswith("FAIL") or "quota" in l]
            if fails: print(f"{name}: {len(fails)} errors, last: {fails[-1].strip()[:150]}")

if __name__ == "__main__":
    out, cmd, only = sys.argv[1], sys.argv[2], set(sys.argv[3:])
    sp = os.path.join(ROOT, "tools/narration_scripts.json")
    SCRIPTS = json.load(open(sp)) if os.path.exists(sp) else {}
    os.makedirs(out, exist_ok=True)
    {"direct": lambda: direct(out, only), "submit": lambda: submit(out, only), "collect": lambda: collect(out),
     "run": lambda: run(out, only), "status": lambda: status(out, only)}[cmd]()
