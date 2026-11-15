"""第4弾の集計。python3 -I analyze4.py <results4.json> （同じディレクトリの round4_labels.json を読む）"""
import json, sys, statistics as st
NO = "言及なし"; A = ["gameplay", "music", "comfort", "price"]
L = {x["id"]: x for x in json.load(open("round4_labels.json"))["labels"]}
R = json.load(open(sys.argv[1]))["records"]
def pn(P, N): return {(1, 0): "肯定", (0, 1): "否定", (1, 1): "混在", (0, 0): NO}[(int(P), int(N))]
def derive(r, k):
    a, c = r["answers"], r["cond"]
    if c == "B0": return a[f"{k}_choice"]["choice"]
    return pn(a[f"{k}_P"]["noul"] >= .5, a[f"{k}_N"]["noul"] >= .5)
def items(model, cond):
    for r in R:
        if r["model"] == model and r["cond"] == cond and r["status"] == 200:
            for k in A:
                if L[r["sample"]][k] is not None:
                    yield r, k, L[r["sample"]][k], derive(r, k)
allv = [(x["id"], k, x[k], x.get("agree", {}).get(k)) for x in L.values() for k in A if x[k] is not None]
print("評価対象の回答:", len(allv), " 正解の内訳:", {g: sum(1 for v in allv if v[2] == g) for g in ("肯定", "否定", "混在", NO)})
print("すべて「言及なし」と答える基準の正解数:", sum(1 for v in allv if v[2] == NO), "/", len(allv))
print("ラベルの一致（3人一致 / 2人一致）:", sum(1 for v in allv if v[3] == 3), "/", sum(1 for v in allv if v[3] == 2))
print("失敗したリクエスト:", sum(r["status"] != 200 for r in R), "/", len(R))
res = {}
for m in ("clef", "clef-flash"):
    print("\n==", m)
    for c in ("B0", "A1", "A1-order", "A1-V2"):
        I = list(items(m, c))
        ok = sum(g == p for _, _, g, p in I)
        fn = sum(g != NO and p == NO for _, _, g, p in I)     # あるものを言及なしと誤る
        fp = sum(g == NO and p != NO for _, _, g, p in I)     # ないものをあると答える
        mix_t = sum(p == "混在" for *_, p in I); mix_ok = sum(p == "混在" and g == "混在" for _, _, g, p in I)
        mix_g = sum(g == "混在" for _, _, g, p in I)
        to_mix = sum(p == "混在" and g != "混在" for _, _, g, p in I)
        sec = st.mean(r["sec"] for r in R if r["model"] == m and r["cond"] == c and r["status"] == 200)
        res[(m, c)] = dict(ok=ok, fn=fn, fp=fp, n=len(I))
        print(f"{c:9s} 正解 {ok}/{len(I)}  あるのに言及なし {fn}  ないのにある {fp}  "
              f"混在と答えた {mix_t}（うち正解 {mix_ok}、正解が混在 {mix_g}、誤って混在 {to_mix}）  平均 {sec:.2f}秒")
    for c in ("B0", "A1"):
        I = list(items(m, c)); u = sum(1 for r, k, g, p in I if g == p and L[r['sample']].get('agree', {}).get(k) == 3); n3 = sum(1 for r, k, g, p in I if L[r['sample']].get('agree', {}).get(k) == 3)
        print(f"-- {c}: 3人一致のラベルでの正解 {u}/{n3}")
        print(f"-- {c} の誤り")
        for r, k, g, p in items(m, c):
            if g != p: print(f"   s{r['sample']} {k}: 正={g} 答={p}")
    # 安定性（A1 と、順序・文面を変えたもの）
    base = {(r["sample"], k): p for r, k, g, p in items(m, "A1")}
    for c in ("A1-order", "A1-V2"):
        ch = sum(base[(r["sample"], k)] != p for r, k, g, p in items(m, c))
        print(f"A1 と {c} で向きが変わった: {ch}/{len(base)}")
    # 要確認（P・N の確率が 0.3〜0.7）
    flag = err = cap = 0
    for r, k, g, p in items(m, "A1"):
        a = r["answers"]; f = any(.3 <= a[f"{k}_{s}"]["noul"] <= .7 for s in "PN")
        flag += f; err += (g != p); cap += (f and g != p)
    print(f"A1 要確認（0.3〜0.7）: {flag} 件、誤り {err} 件のうち {cap} 件を拾った")
    # 判定
    b, a1 = res[(m, "B0")], res[(m, "A1")]
    cond1 = a1["ok"] - b["ok"] >= 5
    cond2 = a1["fn"] <= b["fn"] and a1["fp"] <= b["fp"]
    print(f"判定: A1 が B0 より {a1['ok']-b['ok']:+d} 件（5件以上 {cond1}）、言及なしの誤りが増えない {cond2} → "
          + ("A1 を採用候補" if cond1 and cond2 else "差なし（または採用候補とならない）"))
