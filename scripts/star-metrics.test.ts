import { describe, expect, it } from 'vitest';
import {
	bias,
	directionFromStar,
	directionWithoutChoice,
	distribution,
	exactRate,
	modeBaseline,
	pairwiseAgreement,
	stability,
	weightedKappa,
	withinRate,
	type Pair
} from './star-metrics';
import { ASPECT_SPECS, buildCondition, CONDITION_NAMES, star, STAR_LEVELS, STAR_LEVELS_V2 } from './star-questions';
import { compareRuns, type Results } from './star-results';
import { interpretAnswers, type ReadingAnswer } from '../src/lib/server/reading';
import { toClefQuestions } from '../src/lib/server/question-sets';

describe('星の指標', () => {
	const pairs: Pair[] = [
		[4, 4.2],
		[4, 3.6], // 四捨五入で 4
		[5, 4.4], // 四捨五入で 4（±1 以内）
		[2, 4.0] // 2 ずれる
	];

	it('完全一致と ±1 以内は、モデルの score を四捨五入してから数える', () => {
		expect(exactRate(pairs)).toBe(0.5);
		expect(withinRate(pairs, 1)).toBe(0.75);
		expect(withinRate(pairs, 2)).toBe(1);
		expect(exactRate([])).toBeNaN();
	});

	it('基準（いつも、いちばん多い星）。同数なら、小さい星', () => {
		expect(modeBaseline([4, 4, 5, 2])).toEqual({ star: 4, exact: 0.5, within1: 0.75 });
		expect(modeBaseline([5, 1])?.star).toBe(1);
		expect(modeBaseline([])).toBeNull();
	});

	it('重み付きκ: 完全に一致なら 1。常に同じ星を答えると 0 以下。ずれが大きいほど下がる', () => {
		const labels = [1, 2, 3, 4, 5, 3, 4, 2];
		expect(weightedKappa(labels.map((l) => [l, l] as Pair))).toBeCloseTo(1, 9);
		expect(weightedKappa(labels.map((l) => [l, 4] as Pair))).toBeLessThanOrEqual(1e-9);
		const off1 = weightedKappa(labels.map((l) => [l, Math.min(5, l + 1)] as Pair));
		const off2 = weightedKappa(labels.map((l) => [l, Math.min(5, l + 2)] as Pair));
		expect(off1).toBeGreaterThan(off2);
		expect(weightedKappa([])).toBeNaN();
	});

	it('偏り: 予測の平均 - ラベルの平均。分布は 1〜5 ごと', () => {
		expect(bias([[3, 4], [3, 5]])).toBe(1.5);
		expect(bias([[4, 3], [4, 3]])).toBe(-1);
		expect(distribution([1, 1.4, 2.6, 5, 4.5])).toEqual([2, 0, 1, 0, 2]); // 4.5 は 5 に丸まる
	});

	it('ラベル付け者どうしの一致: 同じ項目の、すべての2人の組で数える', () => {
		const r = pairwiseAgreement([[4, 4, 5], [2, 2, 2]]);
		expect(r.pairs).toBe(6);
		expect(r.exact).toBeCloseTo(4 / 6, 9); // (4,4) と、2 の3組
		expect(r.within).toBe(1);
		expect(pairwiseAgreement([[1, 3]], 1)).toMatchObject({ exact: 0, within: 0, pairs: 1 });
		expect(pairwiseAgreement([]).exact).toBeNaN();
	});

	it('星から向き: 4〜5 肯定、1〜2 否定、3 混在。境は四捨五入', () => {
		expect(directionFromStar(5)).toBe('positive');
		expect(directionFromStar(3.6)).toBe('positive');
		expect(directionFromStar(3.4)).toBe('mixed');
		expect(directionFromStar(2.6)).toBe('mixed');
		expect(directionFromStar(2.4)).toBe('negative');
		expect(directionFromStar(1)).toBe('negative');
	});

	it('S3（向きなし）の向き: noul が 0.5 未満なら言及なし。それ以外は、星から出す', () => {
		expect(directionWithoutChoice(0.49, 5)).toBe('none');
		expect(directionWithoutChoice(0.5, 5)).toBe('positive');
		expect(directionWithoutChoice(0.9, 1.2)).toBe('negative');
		expect(directionWithoutChoice(0.9, 3)).toBe('mixed');
	});

	it('安定性: 四捨五入した星が変わる割合と、score の差の平均', () => {
		const r = stability([3.4, 4.6, 2], [3.6, 4.7, 2]);
		expect(r.n).toBe(3);
		expect(r.changed).toBeCloseTo(1 / 3, 9); // 3.4→3、3.6→4 だけ変わる
		expect(r.meanAbsDiff).toBeCloseTo((0.2 + 0.1 + 0) / 3, 9);
		expect(stability([], [1]).n).toBe(0);
	});
});

describe('星の実験の質問', () => {
	it('条件ごとの質問の数と並び', () => {
		const keys = (name: (typeof CONDITION_NAMES)[number]) => Object.keys(toClefQuestions(buildCondition(name)));
		expect(keys('B0')).toHaveLength(8);
		expect(keys('S1')).toHaveLength(12);
		expect(keys('S1').slice(0, 8)).toEqual(keys('B0')); // 星は、B0 のあとに足す
		expect(keys('S1').slice(8)).toEqual(['gameplay_star', 'music_star', 'comfort_star', 'price_star']);
		expect(keys('S1-order').slice(0, 4)).toEqual(['gameplay_star', 'music_star', 'comfort_star', 'price_star']);
		expect(keys('S1-order').slice(4)).toEqual(keys('B0'));
		expect(keys('S3')).toEqual(['gameplay_noul', 'gameplay_star', 'music_noul', 'music_star', 'comfort_noul', 'comfort_star', 'price_noul', 'price_star']);
	});

	it('星の質問は score 型で、段階は 5 つ（低い順）。「言及なし」と答えさせる文は含まない', () => {
		const q = toClefQuestions(buildCondition('S1')).gameplay_star;
		expect(q.type).toBe('score');
		expect(q.criteria).toHaveLength(5);
		expect(q.criteria).toEqual(STAR_LEVELS.map((t) => `この観点について、${t}`));
		expect(q.instructions).toContain('gameplay');
		expect(q.instructions).not.toContain('「言及なし」');
		// 規約の最終版: 熱量（分量）は、強さの手がかりにしてよい。ただし、関係のない長さと水増しは、しない
		expect(q.instructions).toContain('熱を込めて書いているときは、強い言葉がなくても、強さの手がかり');
		expect(q.instructions).toContain('水増しは、手がかりにしません');
		expect(q.instructions).not.toContain('星に入れません');
	});

	it('星の基準は、ユーザーの決定のとおり（rubric-stars.md v0.1）', () => {
		const [s1, s2, s3, s4, s5] = STAR_LEVELS;
		// 星5・星1: 具体的な根拠 + 強い言い方。根拠は1点でよい
		expect(s5).toContain('具体的な根拠があり、強い言い方、またはそれに相当する熱量');
		expect(s5).toContain('1点でも');
		expect(s1).toContain('具体的な悪い点があり、強い言い方、またはそれに相当する熱量');
		expect(s1).toContain('1点でも');
		// 星4・星2: 強い言い方でなくてよい。混在は、多いほうに寄せる
		expect(s4).toContain('強い言い方でなくてもよい');
		expect(s4).toContain('良い点が多く、悪い点が少しだけ');
		expect(s2).toContain('強い言い方でなくてもよい');
		expect(s2).toContain('悪い点が多く、良い点が少しだけ');
		// 星3: 釣り合った混在、または、良くも悪くもない
		expect(s3).toContain('同じ程度');
		expect(s3).toContain('良くも悪くもない');
		// 深さ（複数の点）は、段階の条件に入れない
		for (const level of STAR_LEVELS) expect(level).not.toContain('複数');
	});

	it('各観点に、星の質問が1つ。キーは観点ごとに違う', () => {
		const stars = ASPECT_SPECS.map(star);
		expect(new Set(stars.map((q) => q.key)).size).toBe(4);
		expect(stars.map((q) => q.aspect)).toEqual(['gameplay', 'music', 'comfort', 'price']);
	});
});

describe('言い換え（V2）の条件', () => {
	const keys = (name: (typeof CONDITION_NAMES)[number]) => Object.keys(toClefQuestions(buildCondition(name)));

	it('B0-V2 は、B0 と、質問のキーも、選択肢の id も同じで、文面だけが違う（同じ関数で解釈できる）', () => {
		expect(keys('B0-V2')).toEqual(keys('B0'));
		const b0 = toClefQuestions(buildCondition('B0'));
		const v2 = toClefQuestions(buildCondition('B0-V2'));
		for (const key of keys('B0')) {
			expect(v2[key].type).toBe(b0[key].type);
			expect(v2[key].instructions).not.toBe(b0[key].instructions);
		}
		expect(Object.keys(v2.gameplay_choice.criteria)).toEqual(['肯定', '否定', '混在', '言及なし']);
		expect(Object.keys(v2.gameplay_noul.criteria)).toEqual(['true', 'false']);
		// 規約 v2 の規則（不具合は快適さだけ、内容のない賛辞は言及なし）は、言い換えでも入っている
		expect(v2.gameplay_choice.instructions).toContain('「快適さ」だけに含め');
		expect(v2.gameplay_choice.instructions).toContain('「神ゲー」');
	});

	it('S1-V2 は、S1 と同じ並び・同じキーで、星の質問も言い換えてある。段階の意味は同じ（5段階、低い順）', () => {
		expect(keys('S1-V2')).toEqual(keys('S1'));
		const s1 = toClefQuestions(buildCondition('S1'));
		const v2 = toClefQuestions(buildCondition('S1-V2'));
		expect(v2.gameplay_star.type).toBe('score');
		expect(v2.gameplay_star.criteria).toHaveLength(5);
		expect(v2.gameplay_star.criteria).not.toEqual(s1.gameplay_star.criteria);
		expect(v2.gameplay_star.criteria).toEqual(STAR_LEVELS_V2.map((t) => `この観点について、${t}`));
		expect(v2.gameplay_star.instructions).not.toBe(s1.gameplay_star.instructions);
		// 熱量の手がかりも、言い換えで落とさない
		expect(v2.gameplay_star.instructions).toContain('熱を込めて書いているときは');
	});

	it('星の段階の意味は、言い換えでも、同じ決定を守る（強い言い方 / 熱量 / 1点でも / 多いほうに寄せる）', () => {
		const [s1, s2, s3, s4, s5] = STAR_LEVELS_V2;
		for (const level of [s1, s5]) {
			expect(level).toContain('熱量');
			expect(level).toContain('1点でも');
		}
		expect(s5).toContain('具体的な根拠');
		expect(s1).toContain('悪い点を具体的に');
		expect(s4).toContain('良い点が大半で、悪い点はわずか');
		expect(s2).toContain('悪い点が大半で、良い点はわずか');
		expect(s3).toContain('同じくらい');
		for (const level of STAR_LEVELS_V2) expect(level).not.toContain('複数');
	});

	it('B0-V2、S1-V2 の答えを、本番と同じ関数で解釈できる', () => {
		const answers = (name: (typeof CONDITION_NAMES)[number]) => {
			const out: Record<string, unknown> = {};
			for (const [key, q] of Object.entries(toClefQuestions(buildCondition(name)))) {
				out[key] =
					q.type === 'choice'
						? { type: 'choice', choice: '言及なし', probabilities: { 肯定: 0.02, 否定: 0.02, 混在: 0.02, 言及なし: 0.94 } }
						: q.type === 'noul'
							? { type: 'noul', noul: 0.03 }
							: { type: 'score', score: 3, probabilities: [0, 0.1, 0.1, 0.7, 0.1], confidence: 0.7 };
			}
			return out;
		};
		expect(interpretAnswers(buildCondition('B0-V2'), answers('B0-V2'))).toHaveLength(8);
		const s1 = interpretAnswers(buildCondition('S1-V2'), answers('S1-V2'));
		expect(s1).toHaveLength(12);
		expect(s1.filter((a) => a.kind === 'star').map((a) => a.value)).toEqual(['4', '4', '4', '4']);
	});
});

describe('compareRuns（安定性）', () => {
	const ans = (aspect: string, over: Partial<ReadingAnswer>): ReadingAnswer => ({ questionKey: aspect, aspect, kind: 'direction', value: 'none', prob: 0.9, probs: null, needsCheck: false, ...over });
	const rec = (sample: number, run: number, answers: ReadingAnswer[]) => ({ sample, run, status: 'ok' as const, answers });
	const star = (aspect: string, score: number) => ans(aspect, { kind: 'star', value: String(Math.round(score)), star: { score, levels: null, confidence: null } });
	const mention = (aspect: string, on: boolean) => ans(aspect, { kind: 'mention', value: on ? 'true' : 'false', prob: on ? 0.9 : 0.1 });
	const results = (condition: Results['condition'], records: Results['records']): Results => ({ condition, model: 'clef-flash', questionSetHash: 'x', records });

	it('B0 と B0-V2: 向きだけを比べる（星がなければ、星は null）', () => {
		const a = results('B0', [rec(1, 0, [ans('gameplay', { value: 'positive' }), ans('music', { value: 'none' })]), rec(2, 0, [ans('gameplay', { value: 'negative' })])]);
		const b = results('B0-V2', [rec(1, 0, [ans('gameplay', { value: 'mixed' }), ans('music', { value: 'none' })]), rec(2, 0, [ans('gameplay', { value: 'negative' })])]);
		const r = compareRuns(a, b);
		expect(r.star).toBeNull();
		expect(r.direction).toEqual({ n: 3, changed: 1 / 3 });
	});

	it('S1 と S1-V2: 星は、言及のある項目だけ比べる。言及のない項目の星は使わない', () => {
		const a = results('S1', [rec(1, 0, [mention('gameplay', true), star('gameplay', 4.4), mention('music', false), star('music', 1.0)])]);
		const b = results('S1-V2', [rec(1, 0, [mention('gameplay', true), star('gameplay', 4.7), mention('music', false), star('music', 5.0)])]);
		const r = compareRuns(a, b);
		expect(r.star!.n).toBe(1); // music は、どちらも言及なし
		expect(r.star!.changed).toBe(1); // 4.4 → 4、4.7 → 5
		expect(r.star!.meanAbsDiff).toBeCloseTo(0.3, 9);
	});

	it('どちらかが言及ありなら、比べる', () => {
		const a = results('S1', [rec(1, 0, [mention('music', false), star('music', 2)])]);
		const b = results('S1-V2', [rec(1, 0, [mention('music', true), star('music', 2)])]);
		expect(compareRuns(a, b).star).toMatchObject({ n: 1, changed: 0 });
	});

	it('同じファイルの、回を変えて、繰り返しの安定性を見る。失敗した読み取りは、使わない', () => {
		const r = results('S1', [
			rec(1, 0, [mention('gameplay', true), star('gameplay', 4)]),
			rec(1, 1, [mention('gameplay', true), star('gameplay', 5)]),
			{ sample: 2, run: 1, status: 'error' as const }
		]);
		expect(compareRuns(r, r, 0, 1).star).toMatchObject({ n: 1, changed: 1 });
		expect(compareRuns(r, r, 0, 0).star).toMatchObject({ n: 1, changed: 0 });
		expect(compareRuns(r, r, 0, 2).star).toBeNull(); // 2 回目はない
	});
});
