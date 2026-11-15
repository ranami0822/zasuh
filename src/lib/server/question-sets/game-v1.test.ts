import { describe, expect, it } from 'vitest';
import { CONDITIONS, buildDefinition } from '../../../../scripts/eval-question-count';
import { FILLER_ASPECTS } from '../../../../scripts/question-count-fillers';
import { definitionHash, toClefQuestions } from './index';
import { gameV1 } from './game-v1';

describe('ゲーム用 v1', () => {
	it('定義が変わっていない（変えるときは、版を上げて新しい定義として追加する）', async () => {
		// 実験（第5弾）で読んだときに記録した値。
		expect(await definitionHash(gameV1)).toBe('0915d5c4e79994fc3e83e9374e5bdbbb22813dec82170b589aff0b09b706c0e7');
	});
});

describe('質問数の実験の組み立て', () => {
	it('質問の数が条件どおりで、キーが重ならず、64問を超えない', () => {
		for (const c of CONDITIONS) {
			const questions = toClefQuestions(buildDefinition(c));
			const keys = Object.keys(questions);
			expect(keys).toHaveLength(c.size);
			expect(new Set(keys).size).toBe(c.size);
			expect(c.size).toBeLessThanOrEqual(64);
		}
		expect(FILLER_ASPECTS).toHaveLength(28);
	});

	it('q8 は、本番の質問と同じ（文面も順序も）', () => {
		const q8 = CONDITIONS.find((c) => c.name === 'q8')!;
		expect(toClefQuestions(buildDefinition(q8))).toEqual(toClefQuestions(gameV1));
		expect(Object.keys(toClefQuestions(buildDefinition(q8)))).toEqual(Object.keys(toClefQuestions(gameV1)));
	});

	it('並びの条件: 元の4観点が、先頭か末尾か、逆順になる', () => {
		const keys = (name: string) => Object.keys(toClefQuestions(buildDefinition(CONDITIONS.find((c) => c.name === name)!)));
		expect(keys('q64').slice(0, 2)).toEqual(['gameplay_choice', 'gameplay_noul']);
		expect(keys('q64-fillers-first').slice(-2)).toEqual(['price_choice', 'price_noul']);
		expect(keys('q8-reversed').slice(0, 2)).toEqual(['price_choice', 'price_noul']);
		expect(keys('q16').slice(8, 10)).toEqual(['graphics_choice', 'graphics_noul']);
	});
});
