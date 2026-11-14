"""results.json を集計する（run.py の出力）。python3 -I analyze.py"""
import json, statistics as st
NO = "言及なし"
R = json.load(open("results.json"))
for r in R:
    r["a"] = r["body"]["result"]["answers"]["q"]
def pair(c, N):
    return next(x for x in N if x["sample"] == c["sample"] and x["aspect"] == c["aspect"])
for m in ("clef", "clef-flash"):
    C = [r for r in R if r["model"] == m and r["kind"] == "choice"]
    N = [r for r in R if r["model"] == m and r["kind"] == "noul"]
    yes = [r for r in C if r["expected"] != NO]; no = [r for r in C if r["expected"] == NO]
    print("==", m)
    print("言及なし正解 → argmax=言及なし:", sum(r["a"]["choice"] == NO for r in no), "/", len(no))
    print("言及あり正解 → 言及なしと誤る:", sum(r["a"]["choice"] == NO for r in yes), "/", len(yes))
    print("choice 正解率:", sum(r["a"]["choice"] == r["expected"] for r in C), "/", len(C))
    print("noul(>=0.5=言及あり) 正解率:", sum((n["a"]["noul"] >= .5) == (n["expected"] != NO) for n in N), "/", len(N))
    print("noul と choice の「言及なし」判定の食い違い:")
    for c in C:
        n = pair(c, N)
        if (c["a"]["choice"] == NO) != (n["a"]["noul"] < .5):
            print(f"  s{c['sample']} {c['aspect']} 正={c['expected']} choice={c['a']['choice']}(言及なし={c['a']['probabilities'][NO]:.3f}) noul={n['a']['noul']:.3f}")
    print("top確率の帯ごとの正解数:")
    for lo, hi in ((0, .5), (.5, .7), (.7, .9), (.9, 1.01)):
        sub = [r for r in C if lo <= max(r["a"]["probabilities"].values()) < hi]
        print(f"  {lo}-{hi}: n={len(sub)} 正解={sum(r['a']['choice'] == r['expected'] for r in sub)}")
    print("誤り:")
    for r in C:
        if r["a"]["choice"] != r["expected"]:
            print(f"  s{r['sample']} {r['aspect']} 正={r['expected']} 答={r['a']['choice']} top={max(r['a']['probabilities'].values()):.3f}")
    for k, L in (("choice", C), ("noul", N)):
        s = [r["sec"] for r in L]
        print(f"{k} 所要時間(秒) 平均{st.mean(s):.3f} 中央{st.median(s):.3f} 最大{max(s):.3f}")
