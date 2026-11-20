"""第7弾（星の実験）の、ラベル付け者3人の出力を、多数決でまとめる。
使い方: python3 -I aggregate_star_labels.py <labels_A.json> <labels_B.json> <labels_C.json> <local_reviews.jsonl> <出力ディレクトリ>
  出力: round7_labels.json（識別子とラベルだけ。本文は入れない）、round7_text_hashes.json（本文の SHA-256。取り直したときに、変わっていないか確かめる）。標準出力には、集計だけを出す。

多数決の規則（実行前に固定）:
- 向き: 3人のうち2人以上が同じならそれ。全員が違えば null（割れた）。多数が「判断不能」でも null。
- 星: 向きが、肯定・否定・混在のときだけ。星を付けた人（整数）のうち、2人以上が同じならそれ。違えば null（割れた）。
- 向きが「言及なし」「判断不能」「割れた」のとき、星は null。
- votes は、3人の星（付けなかった人は null）。dir_votes は、3人の向き。"""
import hashlib, itertools, json, os, sys
from collections import Counter

paths, reviews_path, outdir = sys.argv[1:4], sys.argv[4], sys.argv[5]
ASPECTS = ["gameplay", "music", "comfort", "price"]
raters = [{r["id"]: r for r in json.load(open(p, encoding="utf-8"))["labels"]} for p in paths]
meta = {}
for line in open(reviews_path, encoding="utf-8"):
    x = json.loads(line)
    meta[x["id"]] = x
ids = sorted(meta)
assert all(set(r) == set(ids) for r in raters), "ids が一致しません"

def majority(values):
    c = Counter(v for v in values if v is not None)
    if not c:
        return None
    v, n = c.most_common(1)[0]
    return v if n >= 2 else None

out, items = [], []
for i in ids:
    row = {"id": i, "recommendationid": meta[i]["recommendationid"], "appid": meta[i]["appid"], "voted_up": meta[i]["voted_up"], "mixed_candidate": meta[i]["mixed_candidate"]}
    for a in ASPECTS:
        dv = [r[i][a]["direction"] for r in raters]
        sv = [r[i][a]["star"] for r in raters]
        d = majority(dv)
        if d == "判断不能":
            d = None
        s = majority([x for x in sv if isinstance(x, int)]) if d in ("肯定", "否定", "混在") else None
        row[a] = {"star": s, "direction": d, "votes": sv, "dir_votes": dv}
        items.append((i, a, dv, sv, d, s))
    out.append(row)
os.makedirs(outdir, exist_ok=True)
json.dump({"note": "第7弾の採点用ラベル（AI 3人の多数決）。本文は含まない。規約は rubric.md v2 と rubric-stars.md。", "labels": out},
          open(os.path.join(outdir, "round7_labels.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump({"sha256": {meta[i]["recommendationid"]: hashlib.sha256(meta[i]["text"].encode("utf-8")).hexdigest() for i in ids}},
          open(os.path.join(outdir, "round7_text_hashes.json"), "w"), indent=1)

n = len(items)
print("項目", n, "（70件 × 4観点）")
print("向きの最終ラベル:", dict(Counter(x[4] if x[4] else "除外" for x in items)))
print("星の最終ラベルの分布:", dict(sorted(Counter(x[5] for x in items if x[5] is not None).items())), " 割れた（向きは言及あり、星は割れ）:", sum(1 for x in items if x[4] in ("肯定", "否定", "混在") and x[5] is None))
print("混在の項目の星:", dict(sorted(Counter(x[5] for x in items if x[4] == "混在").items(), key=lambda t: (t[0] is None, t[0]))))
print("向きの3人一致:", sum(1 for x in items if len(set(x[2])) == 1), "/", n)
for (p, q) in itertools.combinations(range(3), 2):
    agree = sum(1 for x in items if x[2][p] == x[2][q])
    both = [x for x in items if isinstance(x[3][p], int) and isinstance(x[3][q], int)]
    exact = sum(1 for x in both if x[3][p] == x[3][q]); within = sum(1 for x in both if abs(x[3][p] - x[3][q]) <= 1)
    print("ペア %s-%s: 向き一致 %d/%d (%.1f%%)、星（両者が付けた %d 項目）完全一致 %d (%.1f%%)、±1 以内 %d (%.1f%%)" % (
        "ABC"[p], "ABC"[q], agree, n, 100 * agree / n, len(both), exact, 100 * exact / max(1, len(both)), within, 100 * within / max(1, len(both))))
