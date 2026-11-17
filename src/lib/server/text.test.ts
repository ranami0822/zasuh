import { describe, expect, it } from 'vitest';
import { jaccard, normalizeText, shingles } from './text';

describe('文面のならし', () => {
	it('全角と半角、大文字と小文字、空白と記号の違いを、同じにする', () => {
		expect(normalizeText('ＡＢＣ　Ａｂｃ！！ ａｂｃ')).toBe('abcabcabc');
		expect(normalizeText('戦闘が、とても 面白い。😀')).toBe('戦闘がとても面白い');
	});

	it('重なりの割合: 同じ文は 1、無関係な文は 0 に近い、空は 0', () => {
		const a = shingles(normalizeText('戦闘のテンポが良くて、敵の種類も豊富で飽きない'));
		const same = shingles(normalizeText('戦闘のテンポが良くて 敵の種類も豊富で、飽きない！'));
		const other = shingles(normalizeText('ロード時間が長く、起動のたびに待たされるのが不満'));
		expect(jaccard(a, same)).toBe(1);
		expect(jaccard(a, other)).toBeLessThan(0.1);
		expect(jaccard(a, new Set())).toBe(0);
	});

	it('一部だけ変えた文は、高い割合になる', () => {
		const a = shingles(normalizeText('戦闘のテンポが良くて、敵の種類も豊富で飽きない。音楽も最高に良かったです'));
		const b = shingles(normalizeText('戦闘のテンポが良くて、敵の種類も豊富で飽きない。音楽もとても良かったです'));
		expect(jaccard(a, b)).toBeGreaterThan(0.6);
	});
});
