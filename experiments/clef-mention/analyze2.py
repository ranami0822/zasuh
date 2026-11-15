"""第2弾の集計。python3 -I analyze2.py  （results2_*.json と第1弾の results.json を読む）"""
import json, statistics as st
from collections import defaultdict
NO = "言及なし"
def L(st_): return json.load(open(f"results2_{st_}.json"))["records"]
A, B0, B, C = L("A"), L("B0"), L("B"), L("C")
R1 = json.load(open("results.json"))
for name, rs in (("A", A), ("B0", B0), ("B", B), ("C", C)):
    assert all(r["status"] == 200 for r in rs), name
    print(f"stage {name}: {len(rs)} リクエスト、再試行あり {sum(r['attempts']>1 for r in rs)}")

def choice_of(a): return a["choice"]
def probs(a): return a["probabilities"]
def top(a): return max(a["probabilities"].values())

# 回答を (model, variant, mode, sample, aspect) -> {choice:{...}, noul:float} に展開
def flatten(rs):
    d = {}
    for r in rs:
        if r["mode"] == "batch":
            for k in ("gameplay", "music", "comfort", "price"):
                d[(r["model"], r["variant"], "batch", r["sample"], k)] = dict(
                    c=r["answers"][f"{k}_choice"], n=r["answers"][f"{k}_noul"]["noul"],
                    exp=r["expected"][k], amb=r["ambiguous"])
        else:
            key = (r["model"], r["variant"], "single", r["sample"], r["aspect"])
            e = d.setdefault(key, {"exp": r["expected"][r["aspect"]], "amb": r["ambiguous"]})
            if r["kind"] == "choice": e["c"] = r["answers"]["q"]
            else: e["n"] = r["answers"]["q"]["noul"]
    return d
fB0, fB, fC = flatten(B0), flatten(B), flatten(C)

print("\n===== A. 同一入力の揺れ（Clef、1問ずつ、3回）=====")
by = defaultdict(list)
for r in A:
    by[(r["sample"], r["aspect"], r["kind"])].append(r)
mx = {"choice": 0.0, "noul": 0.0}; nz = {"choice": 0, "noul": 0}; flips = 0
for (s, k, kd), rs in by.items():
    assert len(rs) == 3
    if kd == "choice":
        ps = [r["answers"]["q"]["probabilities"] for r in rs]
        diff = max(max(p[o] for p in ps) - min(p[o] for p in ps) for o in ps[0])
        flips += len({r["answers"]["q"]["choice"] for r in rs}) > 1
    else:
        vs = [r["answers"]["q"]["noul"] for r in rs]; diff = max(vs) - min(vs)
    mx[kd] = max(mx[kd], diff); nz[kd] += diff > 0
print("質問数:", {kd: sum(1 for k in by if k[2] == kd) for kd in ("choice", "noul")})
print("3回で確率が1回でも違った質問数:", nz)
print("確率の差の最大値:", {k: round(v, 5) for k, v in mx.items()}, " choice の最高確率の選択肢が変わった質問:", flips)
# 第1弾(別日・別実行)との差
r1 = {(r["sample"], r["aspect"], r["kind"]): r["a"] if "a" in r else r["body"]["result"]["answers"]["q"]
      for r in R1 if r["model"] == "clef"}
mx1 = 0
for (s, k, kd), rs in by.items():
    a1 = r1[(s, k, kd)]
    for r in rs:
        a = r["answers"]["q"]
        d = max(abs(a["probabilities"][o] - a1["probabilities"][o]) for o in a["probabilities"]) if kd == "choice" else abs(a["noul"] - a1["noul"])
        mx1 = max(mx1, d)
print("参考: 第1弾（前日の実行）との確率の差の最大値:", round(mx1, 5))

def sel(f, model, var, mode, amb):
    return {k: v for k, v in f.items() if k[0] == model and k[1] == var and k[2] == mode and v["amb"] == amb}

def acc(d):
    n = len(d)
    ok = sum(v["c"]["choice"] == v["exp"] for v in d.values())
    nok = sum((v["n"] >= .5) == (v["exp"] != NO) for v in d.values())
    exp_no = [v for v in d.values() if v["exp"] == NO]; exp_yes = [v for v in d.values() if v["exp"] != NO]
    return dict(n=n, choice正解=ok, noul正解=nok,
                言及なし正解_言及なし選択=f"{sum(v['c']['choice']==NO for v in exp_no)}/{len(exp_no)}",
                言及あり正解_言及なしと誤る=f"{sum(v['c']['choice']==NO for v in exp_yes)}/{len(exp_yes)}",
                誤り中の混在=f"{sum(v['c']['choice']=='混在' for v in d.values() if v['c']['choice']!=v['exp'])}/{n-ok}")

print("\n===== B. 1問ずつ(B0) と 8問まとめ(B) の比較 =====")
for m in ("clef", "clef-flash"):
    for amb in (False, True):
        tag = "主集計(曖昧を除く)" if not amb else "曖昧のみ"
        print(f"[{m}] {tag}")
        print("  1問ずつ:", acc(sel(fB0, m, "V0", "single", amb)))
        print("  8問まとめ:", acc(sel(fB, m, "V0", "batch", amb)))
    # 同じ質問での差
    ch = 0; mxp = 0; nflip = 0; n = 0
    for k, v in fB.items():
        if k[0] != m: continue
        b0 = fB0[(k[0], k[1], "single", k[3], k[4])]
        n += 1; ch += v["c"]["choice"] != b0["c"]["choice"]
        nflip += (v["n"] >= .5) != (b0["n"] >= .5)
        mxp = max(mxp, max(abs(v["c"]["probabilities"][o] - b0["c"]["probabilities"][o]) for o in v["c"]["probabilities"]), abs(v["n"] - b0["n"]))
    print(f"  同じ質問で 1問ずつ vs まとめ: 全{n}回答中 choiceの答えが変わった={ch}、noulの0.5判定が変わった={nflip}、確率の差の最大={mxp:.3f}")
    # 応答時間
    t_single = defaultdict(float)
    for r in B0:
        if r["model"] == m: t_single[r["sample"]] += r["sec"]
    t_batch = [r["sec"] for r in B if r["model"] == m]
    t_one = [r["sec"] for r in B0 if r["model"] == m]
    print(f"  応答時間: 1問ずつ 1リクエスト平均{st.mean(t_one):.3f}s（8問で1サンプルあたり合計 平均{st.mean(t_single.values()):.2f}s）/ まとめ 1リクエスト平均{st.mean(t_batch):.3f}s（中央{st.median(t_batch):.3f}s、最大{max(t_batch):.3f}s）")

print("\n===== C. 言い換え（8問まとめ、V0/V1/V2）=====")
allB = {**fB, **fC}
for m in ("clef", "clef-flash"):
    for var in ("V0", "V1", "V2"):
        print(f"[{m}/{var}] 主集計:", acc(sel(allB, m, var, "batch", False)), "| 曖昧:", {k: v for k, v in acc(sel(allB, m, var, "batch", True)).items() if k in ("n", "choice正解", "noul正解")})
    for amb in (False, True):
        keys = [(s, a) for (mm, v, md, s, a), x in allB.items() if mm == m and v == "V0" and x["amb"] == amb]
        chg = [(s, a) for s, a in keys if len({allB[(m, v, "batch", s, a)]["c"]["choice"] for v in ("V0", "V1", "V2")}) > 1]
        nchg = [(s, a) for s, a in keys if len({allB[(m, v, "batch", s, a)]["n"] >= .5 for v in ("V0", "V1", "V2")}) > 1]
        mxp = 0
        for s, a in keys:
            ps = [allB[(m, v, "batch", s, a)]["c"]["probabilities"] for v in ("V0", "V1", "V2")]
            mxp = max(mxp, max(max(p[o] for p in ps) - min(p[o] for p in ps) for o in ps[0]))
        print(f"  [{m}] {'曖昧' if amb else '主集計'}: 3通りで choice の答えが変わった {len(chg)}/{len(keys)}、noul の0.5判定が変わった {len(nchg)}/{len(keys)}、choice確率の差の最大 {mxp:.3f}")
        if not amb:
            for s, a in chg:
                print("     変化:", s, a, {v: (allB[(m, v, 'batch', s, a)]['c']['choice'], round(top(allB[(m, v, 'batch', s, a)]['c']), 2)) for v in ('V0', 'V1', 'V2')}, "正解", allB[(m, 'V0', 'batch', s, a)]["exp"])

print("\n===== D. 食い違い（noul と choice）による誤りの検出 =====")
def mismatch(v):
    c_no = v["c"]["choice"] == NO; n_no = v["n"] < .5
    return c_no != n_no
for m in ("clef", "clef-flash"):
    for var in ("V0", "V1", "V2"):
        for amb in (False, True):
            d = sel(allB, m, var, "batch", amb)
            err = [k for k, v in d.items() if v["c"]["choice"] != v["exp"]]
            mm = [k for k, v in d.items() if mismatch(v)]
            caught = [k for k in err if mismatch(d[k])]
            false_alarm = [k for k in mm if d[k]["c"]["choice"] == d[k]["exp"]]
            print(f"[{m}/{var}/{'曖昧' if amb else '主'}] 回答{len(d)} 誤り{len(err)} 食い違い{len(mm)}  拾った誤り={len(caught)}/{len(err)}  食い違いのうち誤り={len(mm)-len(false_alarm)}/{len(mm)}  誤検出(正解なのに食い違い)={len(false_alarm)}")
    if True:
        d = sel(allB, m, "V0", "batch", False)
        print(f"  [{m}/V0] 食い違い一覧:")
        for k, v in sorted(d.items(), key=lambda x: (x[0][3], x[0][4])):
            if mismatch(v):
                print(f"     s{k[3]} {k[4]} 正={v['exp']} choice={v['c']['choice']}({top(v['c']):.2f}) 言及なし={v['c']['probabilities'][NO]:.2f} noul={v['n']:.2f}")
        print(f"  [{m}/V0] choice の誤り（食い違いなし=見逃し）:")
        for k, v in sorted(d.items(), key=lambda x: (x[0][3], x[0][4])):
            if v["c"]["choice"] != v["exp"] and not mismatch(v):
                print(f"     s{k[3]} {k[4]} 正={v['exp']} choice={v['c']['choice']}({top(v['c']):.2f}) noul={v['n']:.2f}")

print("\n===== 全体: 「混在」への寄り（8問まとめ V0、主集計、全34件のうち曖昧を除く29件）=====")
for m in ("clef", "clef-flash"):
    d = sel(allB, m, "V0", "batch", False)
    errs = [v for v in d.values() if v["c"]["choice"] != v["exp"]]
    print(f"[{m}] 誤り{len(errs)}件中、答えが「混在」={sum(v['c']['choice']=='混在' for v in errs)}、「言及なし」={sum(v['c']['choice']==NO for v in errs)}、他={sum(v['c']['choice'] not in ('混在', NO) for v in errs)}")
    # 閾値
    for th in (0.9, 0.8):
        hi = [v for v in d.values() if top(v["c"]) >= th]
        print(f"   最高確率>={th}: {len(hi)}/{len(d)}件、うち正解{sum(v['c']['choice']==v['exp'] for v in hi)}")

print("\n===== D'. 誤りの種類と、食い違いが拾えるか（8問まとめ V0、主集計）=====")
for m in ("clef", "clef-flash"):
    d = sel(allB, m, "V0", "batch", False)
    err = {k: v for k, v in d.items() if v["c"]["choice"] != v["exp"]}
    presence = {k: v for k, v in err.items() if (v["exp"] == NO) != (v["c"]["choice"] == NO)}   # 言及の有無を取り違えた
    polarity = {k: v for k, v in err.items() if k not in presence}                                 # 両方「言及あり」だが向きが違う
    print(f"[{m}] 誤り{len(err)}件 = 言及の有無の取り違え{len(presence)}件（食い違いで拾えた{sum(mismatch(v) for v in presence.values())}）"
          f" + 向きの誤り{len(polarity)}件（食い違いで拾えた{sum(mismatch(v) for v in polarity.values())}）")

print("\n===== 誤り一覧（8問まとめ V0）。ラベルの妥当性確認用 =====")
TXT = {s["id"]: s["text"] for f in ("samples.json", "samples2.json") for s in json.load(open(f))["samples"]}
for m in ("clef", "clef-flash"):
    for amb in (False, True):
        d = sel(allB, m, "V0", "batch", amb)
        print(f"[{m}] {'曖昧' if amb else '主集計'}")
        for k, v in sorted(d.items(), key=lambda x: (x[0][3], x[0][4])):
            if v["c"]["choice"] != v["exp"]:
                print(f"  s{k[3]:>2} {k[4]:<8} 正={v['exp']} 答={v['c']['choice']}({top(v['c']):.2f}) noul={v['n']:.2f} | {TXT[k[3]][:60]}")
