"""Generate AI illustrations for events from tools/ai_prompts.json ({event id: scene prompt}).

Usage: python3 tools/ai_illustrate.py OUT_DIR gemini|openai [event id ...]
Keys come from GOOGLE_API_KEY / OPENAI_API_KEY. Images land in OUT_DIR/<provider>/<id>.png; existing files are skipped."""
import base64, json, os, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RULES = (" Historically accurate clothing, architecture and objects for the period. No text, no writing, no captions, no signatures,"
         " no seals, nothing anachronistic, no gore, no close-up portraits.")
MODELS = {"gemini": "gemini-3.1-flash-image", "openai": "gpt-image-2"}

def post(url, body, headers, tries=6):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **headers})
    for k in range(tries):
        try:
            return json.load(urllib.request.urlopen(req, timeout=300))
        except urllib.error.HTTPError as e:
            if e.code != 429 or k == tries - 1: raise
            time.sleep(15 * (k + 1))  # rate limit (OpenAI allows 20 images a minute on this account)

def gemini(prompt):
    r = post(f"https://generativelanguage.googleapis.com/v1beta/models/{MODELS['gemini']}:generateContent",
             {"contents": [{"parts": [{"text": prompt}]}],
              "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "4:3"}}},
             {"x-goog-api-key": os.environ["GOOGLE_API_KEY"]})
    parts = r["candidates"][0]["content"]["parts"]
    return base64.b64decode(next(p["inlineData"]["data"] for p in parts if "inlineData" in p))

def openai(prompt):
    r = post("https://api.openai.com/v1/images/generations",
             {"model": MODELS["openai"], "prompt": prompt, "size": "1536x1024", "quality": "medium", "n": 1},
             {"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"]})
    return base64.b64decode(r["data"][0]["b64_json"])

def main():
    out, provider, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
    prompts = json.load(open(os.path.join(ROOT, "tools/ai_prompts.json")))
    gen = {"gemini": gemini, "openai": openai}[provider]
    os.makedirs(os.path.join(out, provider), exist_ok=True)
    def one(i):
        path = os.path.join(out, provider, i + ".png")
        if os.path.exists(path): return
        try:
            data = gen(prompts[i] + RULES)
            open(path, "wb").write(data); print("ok", i, flush=True)
        except Exception as e:
            msg = e.read().decode()[:300] if hasattr(e, "read") else str(e)
            print("FAIL", i, msg, flush=True)
    with ThreadPoolExecutor(3) as ex: list(ex.map(one, ids or list(prompts)))

if __name__ == "__main__": main()
