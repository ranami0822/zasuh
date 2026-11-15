"""第3弾の集計。python3 -I analyze3.py <results3.json> （同じディレクトリの round3_labels.json を読む）"""
import json, sys, statistics as st
NO = "言及なし"; A = ["gameplay", "music", "comfort", "price"]
L = {x["id"]: x for x in json.load(open("round3_labels.json"))["labels"]}
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
print("失敗したリクエスト:", sum(r["status"] != 200 for r in R), "/", len(R))
res = {}
for m in ("clef", "clef-flash"):
    print("\n==", m)
    for c in ("B0", "A1", "A1-order", "A1-V2", "A2"):
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
