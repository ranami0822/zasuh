import { describe, expect, it } from 'vitest';
import { MIN_N_FOR_SE, showsShares } from './stars';
import { MIN_N_FOR_SE as SERVER_MIN_N } from './server/star-stats';

describe('星の分布の割合を出すか', () => {
	it('件数が 5 未満なら出さない。5 以上なら出す', () => {
		expect(MIN_N_FOR_SE).toBe(5);
		expect([0, 1, 4, 5, 20].map(showsShares)).toEqual([false, false, false, true, true]);
	});

	it('境目は、集計で幅を出す件数と同じ', () => {
		expect(SERVER_MIN_N).toBe(MIN_N_FOR_SE);
	});
});
