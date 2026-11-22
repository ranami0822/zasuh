import { describe, expect, it } from 'vitest';
import { COMMON_SD, MIN_N_FOR_SE, starSummary } from './star-stats';

/** 1つの段階に確率 1 を置いた答え。 */
const sure = (star: 1 | 2 | 3 | 4 | 5) => ({ levels: [1, 2, 3, 4, 5].map((k) => (k === star ? 1 : 0)) });

describe('starSummary（星の集計）', () => {
	it('件数 0 は、平均・幅・控えめな値がすべて null で、段階ごとの合計は 0', () => {
		expect(starSummary([])).toEqual({ n: 0, soft: [0, 0, 0, 0, 0], mean: null, se: null, lower: null });
	});

	it('段階ごとの確率を足して（ソフトな件数）、整数に丸めない', () => {
		const s = starSummary([{ levels: [0, 0, 0, 0.4, 0.6] }, { levels: [0.5, 0.5, 0, 0, 0] }]);
		expect(s.n).toBe(2);
		expect(s.soft).toEqual([0.5, 0.5, 0, 0.4, 0.6]);
		// 平均 = ((4×0.4 + 5×0.6) + (1×0.5 + 2×0.5)) / 2
		expect(s.mean).toBeCloseTo((4.6 + 1.5) / 2, 12);
	});

	it('確率の合計が 1 でなくても、1 に直してから使う（丸め誤差、0.9999 など）', () => {
		const s = starSummary([{ levels: [0, 0, 0, 0, 0.5] }]);
		expect(s.soft[4]).toBeCloseTo(1, 12);
		expect(s.mean).toBeCloseTo(5, 12);
	});

	it(`件数が ${MIN_N_FOR_SE} 以上なら、幅を、√((レビュー間の分散 + レビュー内の分散の平均) / n) で出す`, () => {
		// 全員が星3 と確実に答えているなら、ばらつきはない（幅 0）。
		const flat = starSummary(Array.from({ length: 5 }, () => sure(3)));
		expect(flat.se).toBeCloseTo(0, 12);
		expect(flat.lower).toBeCloseTo(3, 12);

		// 確実な答えで、星1 と星5 が交互 → レビュー間の分散（n-1 で割る）だけが効く。
		const items = [sure(1), sure(5), sure(1), sure(5), sure(1), sure(5)];
		const s = starSummary(items);
		const mean = 3;
		const variance = items.reduce((t, _, i) => t + ((i % 2 === 0 ? 1 : 5) - mean) ** 2, 0) / (items.length - 1);
		expect(s.se).toBeCloseTo(Math.sqrt(variance / items.length), 12);
		expect(s.lower).toBeCloseTo(mean - 1.959964 * s.se!, 12);

		// 確率がばらけているときは、レビュー内の分散が足される（同じ平均 3 で、全員が一様な確率）。
		const spread = starSummary(Array.from({ length: 5 }, () => ({ levels: [0.2, 0.2, 0.2, 0.2, 0.2] })));
		expect(spread.se).toBeCloseTo(Math.sqrt(2 / 5), 12); // 一様な 1〜5 の分散は 2
	});

	it(`件数が ${MIN_N_FOR_SE} 未満は、幅を出さない。控えめな値だけ、共通の標準偏差（${COMMON_SD}）で出す`, () => {
		const s = starSummary([sure(5), sure(5)]);
		expect(s.se).toBeNull();
		expect(s.lower).toBeCloseTo(5 - 1.959964 * (COMMON_SD / Math.sqrt(2)), 12);
		// 少ないほど、控えめな値は下がる。
		expect(starSummary([sure(5)]).lower!).toBeLessThan(s.lower!);
	});

	it('同じ平均なら、件数が多いほうが、控えめな値が高い（順位が少数で暴れない）', () => {
		const few = starSummary([sure(4), sure(4)]);
		const many = starSummary(Array.from({ length: 30 }, () => sure(4)));
		expect(many.lower!).toBeGreaterThan(few.lower!);
	});
});
