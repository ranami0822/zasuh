"""第2弾の実行。使い方: python3 -I run2.py STAGE  (STAGE = A | B0 | B | C)
  A : 揺れ。samples.json の10件 x 4観点 x {choice,noul} を 1問ずつ、Clef で3回
  B0: 1問ずつ送る基準。34件 x 8問、Clef と Clef-flash（V0）
  B : 8問を1リクエストにまとめる。34件、Clef と Clef-flash（V0）
  C : 言い換え V1・V2 を B の方式で。34件、Clef と Clef-flash
認証は環境変数 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN から読む。"""
import json, os, sys, time, urllib.request, urllib.error

ACC = os.environ["CLOUDFLARE_ACCOUNT_ID"]
TOK = os.environ["CLOUDFLARE_API_TOKEN"]
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACC}/ai/run/@cf/cloudflare/"
ASPECTS = ["gameplay", "music", "comfort", "price"]
KINDS = ["choice", "noul"]
OPT_IDS = ["肯定", "否定", "混在", "言及なし"]

# --- 質問文の3通り。選択肢の id（肯定/否定/混在/言及なし）は共通で、説明だけを変える ---
V = {}
# V0: 第1弾 run.py と同じ
V["V0"] = dict(
    desc={"gameplay": "ゲーム性・内容（戦闘、システム、難易度、ボリュームなど）",
          "music": "音楽・音（BGM、サウンドトラック、効果音など）",
          "comfort": "快適さ（ロード時間、不具合・バグ、操作性など）",
          "price": "価格（値段、コストパフォーマンス、セールなど）"},
    choice_ins=lambda k, d: f"このゲームレビューは、観点「{k}: {d}」についてどう述べていますか。書かれていないことは推測せず、言及がなければ「言及なし」を選んでください。",
    opts={"肯定": "この観点について、肯定的な評価だけが書かれている",
          "否定": "この観点について、否定的な評価だけが書かれている",
          "混在": "この観点について、肯定的な評価と否定的な評価の両方が書かれている",
          "言及なし": "この観点について、レビューに何も書かれていない（書かれていないことを推測で補わない）"},
    noul_ins=lambda k, d: f"このゲームレビューは、観点「{k}: {d}」について言及していますか。",
    noul_crit={"true": "この観点についての記述がレビューにある", "false": "この観点についての記述がレビューにない"})
# V1: 短い言い方
V["V1"] = dict(
    desc={"gameplay": "ゲーム性・内容", "music": "音楽・音", "comfort": "快適さ", "price": "価格"},
    choice_ins=lambda k, d: f"このレビューの「{k}」（{d}）への評価は？ 触れていなければ「言及なし」。",
    opts={"肯定": "良いと言っている", "否定": "悪いと言っている",
          "混在": "良い点も悪い点もある", "言及なし": "触れていない"},
    noul_ins=lambda k, d: f"このレビューは「{k}」（{d}）に触れていますか。",
    noul_crit={"true": "触れている", "false": "触れていない"})
# V2: 別の言い回し
V["V2"] = dict(
    desc={"gameplay": "ゲームの遊び心地や内容面（戦闘・システム・難易度・ボリュームなど）",
          "music": "音楽や音まわり（BGM・サントラ・効果音など）",
          "comfort": "遊ぶうえでの快適さ（ロードの待ち時間、不具合、操作のしやすさなど）",
          "price": "値段まわり（価格、費用対効果、セールなど）"},
    choice_ins=lambda k, d: f"次のレビュー文の書き手は、{d}について、どのような見方を示していますか。レビューに書かれていない場合は、推測せずに「言及なし」と答えてください。",
    opts={"肯定": "好意的・満足している内容だけが書かれている",
          "否定": "不満・批判の内容だけが書かれている",
          "混在": "好意的な内容と不満の内容が両方書かれている",
          "言及なし": "この話題はレビューに出てこない"},
    noul_ins=lambda k, d: f"次のレビュー文には、{d}についての記述が含まれていますか。",
    noul_crit={"true": "その話題についての記述がある", "false": "その話題についての記述はまったくない"})

def question(var, kind, key):
    v = V[var]; d = v["desc"][key]
    if kind == "choice":
        return {"type": "choice", "instructions": v["choice_ins"](key, d), "criteria": v["opts"]}
    return {"type": "noul", "instructions": v["noul_ins"](key, d), "criteria": v["noul_crit"]}

def qid(key, kind): return f"{key}_{kind}"

def post(model, text, questions):
    url = BASE + model          # model は "clef" または "clef-flash"（第1弾で確認した呼び方）
    body = json.dumps({"model": model, "state": text, "questions": questions}).encode()
    for attempt in range(1, 4):
        req = urllib.request.Request(url, data=body, method="POST",
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
            return {"status": 200, "sec": sec, "attempts": attempt, "answers": res["answers"],
                    "usage": res["usage"]}
        time.sleep(2 * attempt)
    return {"status": status, "sec": sec, "attempts": 3, "error": raw[:200].decode("utf-8", "replace")}

def load(fn):
    return json.load(open(fn))["samples"]
S1 = load("samples.json"); S2 = load("samples2.json")
AMBIG = {10} | {s["id"] for s in S2 if s.get("ambiguous")}
for s in S1: s["ambiguous"] = s["id"] in AMBIG
ALL = S1 + S2

def meta(s):
    return {"sample": s["id"], "ambiguous": s["ambiguous"], "expected": s["expected"]}

def single(model, var, s, key, kind, extra=None):
    r = post(model, s["text"], {"q": question(var, kind, key)})
    r.update(meta(s), model=model, variant=var, mode="single", aspect=key, kind=kind, **(extra or {}))
    if r["status"] == 200: r["answers"] = {"q": r["answers"]["q"]}
    return r

def batch(model, var, s):
    qs = {qid(k, kd): question(var, kd, k) for k in ASPECTS for kd in KINDS}
    r = post(model, s["text"], qs)
    r.update(meta(s), model=model, variant=var, mode="batch")
    return r

stage = sys.argv[1]
out = []
def log(r):
    out.append(r)
    print(stage, r["model"], r["variant"], r["sample"], r.get("aspect", "-"), r.get("kind", "-"),
          r["status"], round(r["sec"], 2), flush=True)

if stage == "A":
    for run in (1, 2, 3):
        for s in S1:
            for k in ASPECTS:
                for kd in KINDS:
                    log(single("clef", "V0", s, k, kd, {"run": run}))
elif stage == "B0":
    for m in ("clef", "clef-flash"):
        for s in ALL:
            for k in ASPECTS:
                for kd in KINDS:
                    log(single(m, "V0", s, k, kd))
elif stage == "B":
    for m in ("clef", "clef-flash"):
        for s in ALL:
            log(batch(m, "V0", s))
elif stage == "C":
    for m in ("clef", "clef-flash"):
        for var in ("V1", "V2"):
            for s in ALL:
                log(batch(m, var, s))
json.dump({"stage": stage, "records": out}, open(f"results2_{stage}.json", "w"), ensure_ascii=False, indent=1)
