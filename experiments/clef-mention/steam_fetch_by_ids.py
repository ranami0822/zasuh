"""ラベルのファイルにある識別子（recommendationid）のレビュー本文を、Steam の公式APIから取り直す。
評価に使う本文はリポジトリに置かないので、手元の本文がなくなったときに使う。

使い方: python3 -I steam_fetch_by_ids.py <labels.json> <hashes.json> <出力ディレクトリ>
  出力先はリポジトリの外にすること。local_reviews.jsonl（id, recommendationid, appid, voted_up, text）を書く。
  標準出力には件数だけを出す。本文が当時と変わっているもの（書き手による編集）と、見つからないものは、数を報告して出力から除く。"""
import hashlib, json, os, sys, time, urllib.parse, urllib.request

URL = "https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/"
MAX_PAGES = 30

labels = json.load(open(sys.argv[1], encoding="utf-8"))["labels"]
hashes = json.load(open(sys.argv[2], encoding="utf-8"))["sha256"]
outdir = sys.argv[3]

wanted = {}
for row in labels:
    wanted.setdefault(row["appid"], {})[row["recommendationid"]] = row["id"]

found, changed = [], 0
for appid, ids in wanted.items():
    cursor, remaining = "*", dict(ids)
    for _ in range(MAX_PAGES):
        q = urllib.parse.urlencode({"appid": appid, "filter": "recent", "num_per_page": 100,
                                    "cursor": cursor, "languages[0]": "japanese"})
        with urllib.request.urlopen(f"{URL}?{q}", timeout=60) as r:
            d = json.load(r)["response"]
        for rv in d.get("reviews", []):
            rid = rv["recommendationid"]
            if rid not in remaining:
                continue
            text = rv["review"].strip()
            if hashlib.sha256(text.encode("utf-8")).hexdigest() != hashes.get(rid):
                changed += 1
            else:
                found.append({"id": remaining[rid], "recommendationid": rid, "appid": appid,
                              "voted_up": bool(rv["voted_up"]), "text": text})
            del remaining[rid]
        cursor = d.get("cursor")
        if not remaining or not d.get("reviews") or not cursor:
            break
        time.sleep(1)
    print(appid, "必要", len(ids), "未発見", len(remaining), flush=True)

found.sort(key=lambda x: x["id"])
os.makedirs(outdir, exist_ok=True)
with open(os.path.join(outdir, "local_reviews.jsonl"), "w", encoding="utf-8") as f:
    for x in found:
        f.write(json.dumps(x, ensure_ascii=False) + "\n")
print("取得", len(found), "件 / 必要", len(labels), "件。本文が変わっていて除いたもの", changed, "件")
