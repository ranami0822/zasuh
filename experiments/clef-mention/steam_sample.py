"""Steam の公式API（GetAppReviews）から日本語レビューを取得し、乱数で20件を抽出する。
使い方: python3 -I steam_sample.py <出力ディレクトリ>   （出力先はリポジトリの外にすること）
本文は出力先の local_reviews.jsonl にだけ保存する。書き手の情報は保存しない。標準出力には件数だけを出す。"""
import json, os, random, re, sys, time, urllib.parse, urllib.request

APPS = [1245620, 1086940, 413150, 367520, 1145360, 1091500, 275850, 1623730, 2246340, 2054970]
SEED = 20261115
URL = "https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/"
JP = re.compile(r"[぀-ヿ㐀-鿿]")

def fetch(appid, pages=3):
    cursor, out = "*", []
    for _ in range(pages):
        q = urllib.parse.urlencode({"appid": appid, "filter": "recent", "num_per_page": 100,
                                    "cursor": cursor, "languages[0]": "japanese"})
        with urllib.request.urlopen(f"{URL}?{q}", timeout=60) as r:
            d = json.load(r)["response"]
        out += d.get("reviews", [])
        cursor = d.get("cursor")
        if not d.get("reviews") or not cursor:
            break
        time.sleep(1)
    return out

def ok(text):
    t = text.strip()
    if not 30 <= len(t) <= 300 or "http" in t:
        return False
    return len(JP.findall(t)) / len(t) >= 0.5

outdir = sys.argv[1]
rng = random.Random(SEED)
pool = {}
for app in APPS:
    seen, cands = set(), []
    for r in fetch(app):
        rid = r["recommendationid"]
        if rid in seen or not ok(r["review"]):
            continue
        seen.add(rid)
        cands.append({"appid": app, "recommendationid": rid, "voted_up": bool(r["voted_up"]),
                      "text": r["review"].strip()})
    pool[app] = cands
    print(app, "候補", len(cands), "（おすすめ", sum(c["voted_up"] for c in cands), "）", flush=True)

picked = []
for app in APPS:
    for flag in (True, False):
        c = [x for x in pool[app] if x["voted_up"] == flag]
        if c:
            picked.append(rng.choice(c))
ids = {x["recommendationid"] for x in picked}
rest = [x for a in APPS for x in pool[a] if x["recommendationid"] not in ids]
rng.shuffle(rest)
while len(picked) < 20 and rest:
    picked.append(rest.pop())
rng.shuffle(picked)
picked = picked[:20]
for i, x in enumerate(picked, 1):
    x["id"] = i
os.makedirs(outdir, exist_ok=True)
with open(os.path.join(outdir, "local_reviews.jsonl"), "w", encoding="utf-8") as f:
    for x in picked:
        f.write(json.dumps(x, ensure_ascii=False) + "\n")
print("抽出", len(picked), "件 おすすめ", sum(x["voted_up"] for x in picked), "件")
