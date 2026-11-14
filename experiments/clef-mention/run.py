import json, os, time, urllib.request, urllib.error, sys

ACC = os.environ["CLOUDFLARE_ACCOUNT_ID"]
TOK = os.environ["CLOUDFLARE_API_TOKEN"]
URL = f"https://api.cloudflare.com/client/v4/accounts/{ACC}/ai/run/@cf/cloudflare/clef"

ASPECTS = {
    "gameplay": "ゲーム性・内容（戦闘、システム、難易度、ボリュームなど）",
    "music": "音楽・音（BGM、サウンドトラック、効果音など）",
    "comfort": "快適さ（ロード時間、不具合・バグ、操作性など）",
    "price": "価格（値段、コストパフォーマンス、セールなど）",
}
OPTIONS = {
    "肯定": "この観点について、肯定的な評価だけが書かれている",
    "否定": "この観点について、否定的な評価だけが書かれている",
    "混在": "この観点について、肯定的な評価と否定的な評価の両方が書かれている",
    "言及なし": "この観点について、レビューに何も書かれていない（書かれていないことを推測で補わない）",
}

def question(kind, key):
    desc = ASPECTS[key]
    if kind == "choice":
        return {"type": "choice",
                "instructions": f"このゲームレビューは、観点「{key}: {desc}」についてどう述べていますか。書かれていないことは推測せず、言及がなければ「言及なし」を選んでください。",
                "criteria": OPTIONS}
    return {"type": "noul",
            "instructions": f"このゲームレビューは、観点「{key}: {desc}」について言及していますか。",
            "criteria": {"true": "この観点についての記述がレビューにある",
                         "false": "この観点についての記述がレビューにない"}}

def call(model, text, q):
    url = URL if model == "clef" else URL + "-flash"
    body = json.dumps({"model": model, "state": text, "questions": {"q": q}}).encode()
    req = urllib.request.Request(url, data=body, method="POST",
        headers={"Authorization": f"Bearer {TOK}", "Content-Type": "application/json"})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    except Exception as e:
        return {"status": None, "error": type(e).__name__, "sec": time.perf_counter() - t}
    sec = time.perf_counter() - t
    try:
        return {"status": status, "sec": sec, "body": json.loads(raw)}
    except Exception:
        return {"status": status, "sec": sec, "raw": raw[:300].decode("utf-8", "replace")}

samples = json.load(open("samples.json"))["samples"]
models = sys.argv[1:] or ["clef", "clef-flash"]
out = []
for model in models:
    for s in samples:
        for key in ASPECTS:
            for kind in ("choice", "noul"):
                r = call(model, s["text"], question(kind, key))
                r.update(model=model, sample=s["id"], aspect=key, kind=kind, expected=s["expected"][key])
                out.append(r)
                print(model, s["id"], key, kind, r.get("status"), round(r["sec"], 2), flush=True)
    json.dump(out, open("results.json", "w"), ensure_ascii=False, indent=1)
json.dump(out, open("results.json", "w"), ensure_ascii=False, indent=1)
