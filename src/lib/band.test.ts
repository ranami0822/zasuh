import { describe, expect, it } from 'vitest';
import { bandFor, contrast, MIN_CONTRAST } from './band';

describe('タイトルの帯の色', () => {
	it('コントラスト比を、WCAG の式で出す', () => {
		expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
		expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
	});

	it('明るい帯には墨、暗い帯には白に近い文字を選ぶ。大文字は小文字にそろえる', () => {
		expect(bandFor('#F5F5F5', '#A3A3A3')).toEqual({ from: '#f5f5f5', to: '#a3a3a3', fg: '#171717', muted: '#262626' });
		expect(bandFor('#525252', '#171717')).toEqual({ from: '#525252', to: '#171717', fg: '#f5f5f5', muted: '#d4d4d4' });
	});

	it('選んだ文字の色が、帯の全体で基準に届く', () => {
		for (const [a, b] of [['#ffd7b0', '#d9a77a'], ['#1d3557', '#264773'], ['#f5f5f5', '#a3a3a3']] as const) {
			const band = bandFor(a, b)!;
			expect(band).not.toBeNull();
			expect(Math.min(contrast(band.muted, a), contrast(band.muted, b))).toBeGreaterThanOrEqual(MIN_CONTRAST);
		}
	});

	it('どちらの文字でも読めない中間の明るさと、正しくない色は、null', () => {
		expect(bandFor('#808080', '#909090')).toBeNull();
		expect(bandFor('red', '#ffffff')).toBeNull();
		expect(bandFor('#fff', '#000')).toBeNull();
	});
});
