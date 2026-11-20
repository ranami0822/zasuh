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
import { ASPECT_SPECS, buildCondition, CONDITION_NAMES, star, STAR_LEVELS } from './star-questions';
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
		expect(STAR_LEVELS[0]).toContain('大きく否定');
		expect(STAR_LEVELS[4]).toContain('大きく肯定');
	});

	it('各観点に、星の質問が1つ。キーは観点ごとに違う', () => {
		const stars = ASPECT_SPECS.map(star);
		expect(new Set(stars.map((q) => q.key)).size).toBe(4);
		expect(stars.map((q) => q.aspect)).toEqual(['gameplay', 'music', 'comfort', 'price']);
	});
});
