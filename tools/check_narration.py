"""Screen generated narration: transcribe each clip (OpenAI gpt-4o-transcribe) and compare it with the step's caption,
and compare its length with the caption's. Results go to OUT_DIR/checks.json ({file: {...}}); files already checked
are skipped, so it can run while batches are still arriving.

Usage: python3 tools/check_narration.py OUT_DIR [--loop]      # --loop: keep checking new files every 3 minutes
Reads OPENAI_API_KEY. A clip is flagged when the transcript matches the caption below MIN_MATCH (extra words such as
read-out directions, missing or misread phrases) or when it runs far longer or shorter than usual per character."""
import difflib, json, os, re, sys, time, uuid, urllib.request, wave
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ai_narration import steps, text_hash
MIN_MATCH, SEC_PER_CHAR = 0.88, (0.12, 0.50)
try:
    import opencc; T2S = opencc.OpenCC("t2s").convert  # the transcriber sometimes answers in traditional characters
except ImportError:
    T2S = lambda s: s
CJK = r"[\u4e00-\u9fff0-9]"
# Numbers are compared apart: a caption's 前200年 is heard as 前两百年.
NUMERAL = re.compile(r"[0-9零〇一二两三四五六七八九十百千万亿]")
HAN = lambda s: NUMERAL.sub("", "".join(re.findall(CJK, T2S(s))))

def score(cap, heard):
    """match: similarity of the words; repeat: heard much longer than the caption; cut: the caption's ending is missing."""
    a, b = HAN(cap), HAN(heard)
    match = difflib.SequenceMatcher(None, a, b).ratio() if a else 0
    repeat = len(b) > 1.35 * len(a) + 4
    cut = len(a) >= 6 and a[-4:] not in b[-12:] and difflib.SequenceMatcher(None, a[-6:], b[-8:]).ratio() < 0.5
    return round(match, 3), repeat, cut

def transcribe(path):
    boundary = uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ngpt-4o-transcribe\r\n".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nzh\r\n".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode(),
        open(path, "rb").read(), f"\r\n--{boundary}--\r\n".encode()])
    req = urllib.request.Request("https://api.openai.com/v1/audio/transcriptions", body,
                                 {"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": "Bearer " + os.environ["OPENAI_API_KEY"]})
    for k in range(5):
        try: return json.load(urllib.request.urlopen(req, timeout=120))["text"]
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 503) or k == 4: raise
            time.sleep(10 * (k + 1))

def judge(cap, heard, dur):
    match, repeat, cut = score(cap, heard)
    per = dur / max(len(re.findall(CJK, cap)), 1)
    return {"dur": round(dur, 1), "match": match, "per_char": round(per, 3), "repeat": repeat, "cut": cut, "heard": heard,
            "flag": match < MIN_MATCH or repeat or cut or not SEC_PER_CHAR[0] <= per <= SEC_PER_CHAR[1]}

def rescore(out):
    """Judge again from the stored transcripts (after changing the rules), without transcribing again."""
    path = os.path.join(out, "checks.json")
    done = json.load(open(path))
    captions = {f"{t}__{i}": text for t, i, text in steps(set())}
    for f, r in done.items():
        if "heard" in r: done[f] = judge(captions[f.split("__")[0] + "__" + f.split("__")[1]], r["heard"], r["dur"])
    json.dump(done, open(path, "w"), ensure_ascii=False, indent=0)
    print(sum(bool(r.get("flag")) for r in done.values()), "flagged of", len(done))

def check_all(out):
    path = os.path.join(out, "checks.json")
    done = json.load(open(path)) if os.path.exists(path) else {}
    captions = {f"{t}__{i}": text for t, i, text in steps(set())}
    todo = [f for f in sorted(os.listdir(out)) if f.endswith(".wav") and f not in done]
    def one(f):
        t, i, voice, h = f[:-4].split("__")
        cap = captions.get(f"{t}__{i}")
        if not cap or text_hash(cap) != h: return f, {"stale": True}
        with wave.open(os.path.join(out, f)) as w: dur = w.getnframes() / w.getframerate()
        try: heard = transcribe(os.path.join(out, f))
        except Exception as e: return f, {"error": str(e)[:200]}
        return f, judge(cap, heard, dur)
    with ThreadPoolExecutor(8) as ex:
        for n, (f, r) in enumerate(ex.map(one, todo)):
            done[f] = r
            if n % 50 == 49: json.dump(done, open(path, "w"), ensure_ascii=False, indent=0)
    json.dump(done, open(path, "w"), ensure_ascii=False, indent=0)
    flagged = [f for f, r in done.items() if r.get("flag") or r.get("error")]
    print(f"{len(done)} checked, {len(todo)} new, {len(flagged)} flagged", flush=True)

if __name__ == "__main__":
    out = sys.argv[1]
    if "--rescore" in sys.argv: rescore(out); sys.exit()
    while True:
        check_all(out)
        if "--loop" not in sys.argv: break
        time.sleep(180)
