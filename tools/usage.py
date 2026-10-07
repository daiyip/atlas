"""What the generation tools spend, from each API response's own usage counts.

Every call that costs money appends a line to <OUT_DIR>/usage.jsonl: the model, the item, the token counts the provider
returned and the cost they come to at PRICES. Providers return tokens, not money, so PRICES holds their list prices
(US$; check the pricing pages when they change, and the provider's billing page is the final word). Batch Mode is half
price on Gemini.

Usage: python3 tools/usage.py OUT_DIR [OUT_DIR ...]      # totals per model and day
Imported by tools/ai_music.py, tools/ai_narration.py, tools/check_narration.py and tools/ai_batch.py (record())."""
import collections, json, os, sys, threading, time

PRICES = {  # per million tokens ("in", "out") or per call ("call")
    "gemini-2.5-pro-preview-tts": {"in": 1.00, "out": 20.00},  # audio out is 25 tokens a second
    "gemini-2.5-pro-tts": {"in": 1.00, "out": 20.00},          # Cloud Text-to-Speech; out estimated from the audio length
    "gemini-3.8-flash-tts": {"in": 0.50, "out": 10.00},        # assumed at the 2.5 Flash TTS price until published
    "gemini-2.5-pro": {"in": 1.25, "out": 10.00},
    "gpt-image-2": {"in": 5.00, "out": 40.00},                 # assumed at the gpt-image-1 price; image tokens out
    "gpt-4o-transcribe": {"in": 6.00, "out": 10.00},           # audio in, text out
    "lyria-3.5": {"call": 0.08},                               # priced per track; its token counts are logged too
}
_lock = threading.Lock()

def cost(model, tin, tout, batch=False):
    p = PRICES.get(model, {})
    c = p.get("call", 0) + (tin * p.get("in", 0) + tout * p.get("out", 0)) / 1e6
    return round(c * (0.5 if batch else 1), 6)

def record(out, model, key, tin, tout, batch=False):
    line = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "model": model, "key": key, "in": tin, "out": tout,
            "batch": batch, "usd": cost(model, tin, tout, batch)}
    with _lock, open(os.path.join(out, "usage.jsonl"), "a") as f: f.write(json.dumps(line) + "\n")

def summary(dirs):
    tot = collections.defaultdict(lambda: [0, 0, 0, 0.0])
    for d in dirs:
        p = os.path.join(d, "usage.jsonl")
        if not os.path.exists(p): continue
        for line in open(p):
            x = json.loads(line)
            t = tot[(x["t"][:10], x["model"])]
            t[0] += 1; t[1] += x["in"]; t[2] += x["out"]; t[3] += x["usd"]
    for (day, model), (n, tin, tout, usd) in sorted(tot.items()):
        print(f"{day}  {model:28} {n:6} calls {tin:>10} in {tout:>11} out  ${usd:8.2f}")
    print(f"{'':12}{'total':28} {sum(v[0] for v in tot.values()):6} calls {'':>26}  ${sum(v[3] for v in tot.values()):8.2f}")

if __name__ == "__main__": summary(sys.argv[1:])
