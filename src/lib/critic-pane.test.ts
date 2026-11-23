import { describe, expect, it } from 'vitest';
import { tickerAdvance } from './critic-pane';

describe('専門家の欄の帯: 次の位置（tickerAdvance）', () => {
	it('速さと経過時間の分だけ進む（30px/秒で 100ms なら 3px）', () => {
		expect(tickerAdvance(10, 100, 30, 500)).toBeCloseTo(13);
	});

	it('1組の幅に達したら、その幅を引いて戻す（切れ目なく回す）', () => {
		expect(tickerAdvance(499, 100, 30, 500)).toBeCloseTo(2);
		expect(tickerAdvance(497, 100, 30, 500)).toBeCloseTo(0);
	});

	it('経過時間が大きくても、1組の幅の中に収まる', () => {
		const next = tickerAdvance(100, 60_000, 30, 500);
		expect(next).toBeGreaterThanOrEqual(0);
		expect(next).toBeLessThan(500);
		expect(next).toBeCloseTo((100 + 1800) % 500);
	});

	it('手で、複製の組まで動かしたあとでも、1組の幅の中に戻す', () => {
		expect(tickerAdvance(1200, 0, 30, 500)).toBeCloseTo(200);
	});

	it('1組の幅が 0 なら、動かさない', () => {
		expect(tickerAdvance(0, 100, 30, 0)).toBe(0);
		expect(tickerAdvance(7, 100, 30, 0)).toBe(7);
	});

	it('速さが 0 なら、動かさない', () => {
		expect(tickerAdvance(42, 100, 0, 500)).toBe(42);
	});

	it('経過時間が負（時計の戻り）なら、進まない', () => {
		expect(tickerAdvance(42, -50, 30, 500)).toBe(42);
	});
});
