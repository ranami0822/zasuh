"""第4弾の実行（規約「理由のない評価は数えない」を質問文に入れる）。使い方: python3 -I run3.py <local_reviews.jsonl> <出力json>
レビュー本文は入力ファイルから読むだけで、出力には書かない（識別子と回答のみ）。
認証は環境変数 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN から読む。"""
import json, os, sys, time, urllib.request, urllib.error

ACC = os.environ["CLOUDFLARE_ACCOUNT_ID"]
TOK = os.environ["CLOUDFLARE_API_TOKEN"]
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACC}/ai/run/@cf/cloudflare/"
ASPECTS = ["gameplay", "music", "comfort", "price"]

DESC = {
    "V0": {"gameplay": "ゲーム性・内容（戦闘、システム、難易度、ボリュームなど）",
           "music": "音楽・音（BGM、サウンドトラック、効果音など）",
           "comfort": "快適さ（ロード時間、不具合・バグ、操作性など）",
           "price": "価格（値段、コストパフォーマンス、セールなど）"},
    "V2": {"gameplay": "ゲームの遊び心地や内容面（戦闘・システム・難易度・ボリュームなど）",
           "music": "音楽や音まわり（BGM・サントラ・効果音など）",
           "comfort": "遊ぶうえでの快適さ（ロードの待ち時間、不具合、操作のしやすさなど）",
           "price": "値段まわり（価格、費用対効果、セールなど）"}}

RULE = "総合的な賛辞や、理由を伴わない評価（「神ゲー」「最高」「微妙」など）は、どの観点にも含めず「言及なし」としてください。"

def q_choice(k):   # 第2弾 V0 に規約を足したもの
    d = DESC["V0"][k]
    return {"type": "choice",
            "instructions": f"このゲームレビューは、観点「{k}: {d}」についてどう述べていますか。書かれていないことは推測せず、言及がなければ「言及なし」を選んでください。"+RULE,
            "criteria": {"肯定": "この観点について、具体的な良い点（理由）だけが書かれている",
                         "否定": "この観点について、具体的な悪い点（理由）だけが書かれている",
                         "混在": "この観点について、具体的な良い点と悪い点の両方が書かれている",
                         "言及なし": "この観点について、具体的な内容が書かれていない（書かれていないことを推測で補わない）"}}

def q_mention(k):  # 第2弾 V0 の noul に規約を足したもの
    d = DESC["V0"][k]
    return {"type": "noul", "instructions": f"このゲームレビューは、観点「{k}: {d}」について、具体的な内容を書いていますか。"+RULE,
            "criteria": {"true": "この観点についての具体的な記述がレビューにある", "false": "この観点についての具体的な記述がレビューにない"}}

def q_pn(k, pol, var):
    if var == "V0":
        d = DESC["V0"][k]
        w = "肯定的な評価（良い、満足している）" if pol == "P" else "否定的な評価（悪い、不満）"
        s = "肯定的" if pol == "P" else "否定的"
        return {"type": "noul",
                "instructions": f"このゲームレビューは、観点「{k}: {d}」について、{w}を具体的な理由とともに述べていますか。書かれていないことは推測しないでください。"+RULE,
                "criteria": {"true": f"この観点についての{s}な評価が、具体的な内容とともにレビューに書かれている",
                             "false": f"この観点についての{s}な評価は、レビューに書かれていない"}}
    d = DESC["V2"][k]
    w = "好意的・満足している内容" if pol == "P" else "不満・批判の内容"
    return {"type": "noul",
            "instructions": f"次のレビュー文の書き手は、{d}について、{w}を、理由となる具体的な内容とともに書いていますか。書かれていないことは推測しないでください。"+RULE,
            "criteria": {"true": f"{w}が、具体的な内容とともに書かれている", "false": f"{w}は書かれていない"}}

def build(cond):
    qs = {}
    if cond == "B0":
        for k in ASPECTS:
            qs[f"{k}_choice"] = q_choice(k); qs[f"{k}_noul"] = q_mention(k)
    elif cond == "A1":
        for k in ASPECTS:
            qs[f"{k}_P"] = q_pn(k, "P", "V0"); qs[f"{k}_N"] = q_pn(k, "N", "V0")
    elif cond == "A1-order":
        for k in ASPECTS: qs[f"{k}_P"] = q_pn(k, "P", "V0")
        for k in ASPECTS: qs[f"{k}_N"] = q_pn(k, "N", "V0")
    elif cond == "A1-V2":
        for k in ASPECTS:
            qs[f"{k}_P"] = q_pn(k, "P", "V2"); qs[f"{k}_N"] = q_pn(k, "N", "V2")
    elif cond == "A2":
        for k in ASPECTS:
            qs[f"{k}_P"] = q_pn(k, "P", "V0"); qs[f"{k}_N"] = q_pn(k, "N", "V0")
            qs[f"{k}_M"] = q_mention(k)
    return qs

CONDS = ["B0", "A1", "A1-order", "A1-V2"]

def post(model, text, questions):
    body = json.dumps({"model": model, "state": text, "questions": questions}).encode()
    for attempt in range(1, 4):
        req = urllib.request.Request(BASE + model, data=body, method="POST",
            headers={"Authorization": f"Bearer {TOK}", "Content-Type": "application/json"})
        t = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        except Exception as e:
            status, raw = None, type(e).__name__.encode()
        sec = time.perf_counter() - t
        if status == 200:
            res = json.loads(raw)["result"]
            return {"status": 200, "sec": sec, "attempts": attempt, "answers": res["answers"], "usage": res["usage"]}
        time.sleep(2 * attempt)
    return {"status": status, "sec": sec, "attempts": 3, "error": raw[:200].decode("utf-8", "replace")}

rows = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8")]
out = []
for model in ("clef", "clef-flash"):
    for cond in CONDS:
        qs = build(cond)
        for x in rows:
            r = post(model, x["text"], qs)
            r.update(sample=x["id"], recommendationid=x["recommendationid"], model=model, cond=cond)
            out.append(r)
            print(model, cond, x["id"], r["status"], round(r["sec"], 2), flush=True)
json.dump({"records": out}, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
