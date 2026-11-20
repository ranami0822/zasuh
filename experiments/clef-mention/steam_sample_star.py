"""第7弾（星の実験）の採点用データを、Steam の公式API（GetAppReviews）から取る。
使い方: python3 -I steam_sample_star.py <出力ディレクトリ> <除外するrecommendationidのJSON> [件数=70] [乱数の種=20261120]
  出力先はリポジトリの外にすること。本文は local_reviews.jsonl にだけ保存する（書き手の情報は保存しない）。標準出力には件数だけを出す。

仕様（experiments/clef-mention/README.md の第7弾「データ」）:
- 30〜600字、日本語が半数以上、URLなし。さらに、80字以上（言及のある項目を増やすため）。
- 作品は、第3・4弾と同じ13作品。各作品から、filter=recent（新しい順）と filter=all（期間365日。役に立った順に偏る）を、それぞれ最大10ページ、または、条件に合う候補が60件になるまで。
  （最初の実行は、recent だけで 52 件しか取れなかったので、all を足した。）
- 除外: 第3・4弾で使ったレビュー（除外のJSON）。
- 件数の半分（既定 35）は「混在の候補」: 逆接の言葉（が、けど、しかし、ただ、一方、反面、とはいえ）を含む、100字以上の文。
  **この正規表現は、抽出にだけ使う。ラベルにも、読み取りにも使わない。**
- 残りは、それ以外の80字以上の文。どちらも、おすすめする / しない を半々にし、作品を順に回す。
- id は 101 から（第3・4弾の id と重ならないように）。"""
import json, os, random, re, sys, time, urllib.parse, urllib.request

APPS = [1245620, 1086940, 413150, 367520, 1145360, 1091500, 275850, 1623730, 2246340, 2054970,
        1716740, 2358720, 1966720]
OUTDIR = sys.argv[1]
EXCLUDE = set(json.load(open(sys.argv[2])))
N = int(sys.argv[3]) if len(sys.argv) > 3 else 70
SEED = int(sys.argv[4]) if len(sys.argv) > 4 else 20261120
URL = "https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/"
JP = re.compile(r"[぀-ヿ㐀-鿿]")
CONTRAST = re.compile(r"(が、|けど|けれど|しかし|ただ|一方|反面|とはいえ|ものの)")

def fetch_one(appid, flt, pages=10, enough=60):
    """Steam は、1ページ（100件）を取ってから、言語で絞る。cursor が変わらなくなるまで、または、
    条件に合う候補が enough 件に届くまで続ける。filter=all は、期間（day_range）の指定が要る。"""
    cursor, out, seen = "*", [], set()
    for _ in range(pages):
        params = {"appid": appid, "filter": flt, "num_per_page": 100, "cursor": cursor, "languages[0]": "japanese"}
        if flt == "all":
            params["day_range"] = 365
        with urllib.request.urlopen(f"{URL}?{urllib.parse.urlencode(params)}", timeout=60) as r:
            d = json.load(r)["response"]
        out += d.get("reviews", [])
        nxt = d.get("cursor")
        seen.add(cursor)
        if not nxt or nxt in seen:
            break
        cursor = nxt
        if sum(1 for x in out if ok(x["review"])) >= enough:
            break
        time.sleep(1)
    return out

def fetch(appid):
    """recent（新しい順）と、all（期間365日。役に立った順に偏る）の両方を取って、重複を除く。"""
    return fetch_one(appid, "recent") + fetch_one(appid, "all")

def ok(text):
    t = text.strip()
    if not 80 <= len(t) <= 600 or "http" in t:
        return False
    return len(JP.findall(t)) / len(t) >= 0.5

rng = random.Random(SEED)
pool = {}
for app in APPS:
    seen, cands = set(), []
    for r in fetch(app):
        rid = r["recommendationid"]
        t = r["review"].strip()
        if rid in seen or rid in EXCLUDE or not ok(t):
            continue
        seen.add(rid)
        cands.append({"appid": app, "recommendationid": rid, "voted_up": bool(r["voted_up"]),
                      "mixed_candidate": len(t) >= 100 and bool(CONTRAST.search(t)), "text": t})
    pool[app] = cands
    print(app, "候補", len(cands), "（混在候補", sum(c["mixed_candidate"] for c in cands), "）", flush=True)

picked = []
half = N // 2
for group, want in ((True, half), (False, N - half)):
    for voted in (False, True):
        by = {a: [c for c in pool[a] if c["mixed_candidate"] == group and c["voted_up"] == voted] for a in APPS}
        for a in APPS:
            rng.shuffle(by[a])
        n, target = 0, want // 2 + (want % 2 if voted else 0)
        while n < target and any(by[a] for a in APPS):
            for a in APPS:
                if by[a] and n < target:
                    picked.append(by[a].pop()); n += 1
rng.shuffle(picked)
for i, x in enumerate(picked, 101):
    x["id"] = i
os.makedirs(OUTDIR, exist_ok=True)
with open(os.path.join(OUTDIR, "local_reviews.jsonl"), "w", encoding="utf-8") as f:
    for x in picked:
        f.write(json.dumps(x, ensure_ascii=False) + "\n")
print("抽出", len(picked), "件（混在候補", sum(x["mixed_candidate"] for x in picked), "、おすすめ", sum(x["voted_up"] for x in picked), "）")
