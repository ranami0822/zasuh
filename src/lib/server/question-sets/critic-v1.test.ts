import { describe, expect, it } from 'vitest';
import { ASPECT_SPECS, star } from '../../../../scripts/star-questions';
import { interpretAnswers } from '../reading';
import { answersFor, clefAnswers } from '../testing/db';
import { criticV1 } from './critic-v1';
import { gameV1 } from './game-v1';
import { QUESTION_SETS, toClefQuestions } from './index';

const OVERALL = '作品全体への評価（個別の観点ではなく、作品をどう評価しているか）';

describe('専門家用 critic-v1', () => {
	it('ゲーム用 v1 の8問、4観点の星、総合の向きと星の、14問を、この順序で送る', () => {
		expect(criticV1).toMatchObject({ category: 'game', version: 1, model: 'clef-flash' });
		expect(criticV1.aspects).toEqual([...gameV1.aspects, { key: 'overall', label: '総合' }]);
		const keys = Object.keys(toClefQuestions(criticV1));
		expect(keys).toEqual([
			'gameplay_choice',
			'gameplay_noul',
			'music_choice',
			'music_noul',
			'comfort_choice',
			'comfort_noul',
			'price_choice',
			'price_noul',
			'gameplay_star',
			'music_star',
			'comfort_star',
			'price_star',
			'overall_choice',
			'overall_star'
		]);
		expect(new Set(criticV1.questions.map((q) => q.key)).size).toBe(14);
		expect(Object.values(toClefQuestions(criticV1)).map((q) => q.type)).toEqual([
			...Array(4).fill(['choice', 'noul']).flat(),
			...Array(4).fill('score'),
			'choice',
			'score'
		]);
	});

	it('先頭の8問はゲーム用 v1、4観点の星は星の実験（scripts/star-questions.ts）と、文面まで同じ', () => {
		expect(criticV1.questions.slice(0, 8)).toEqual(gameV1.questions);
		expect(criticV1.questions.slice(8, 12)).toEqual(ASPECT_SPECS.map(star));
	});

	it('総合の2問は、試験（22.7）と同じ文面', () => {
		expect(criticV1.questions.slice(12)).toEqual([
			{
				key: 'overall_choice',
				aspect: 'overall',
				kind: 'direction',
				instructions: `次のゲームレビューの抜粋は、${OVERALL}について、どのような見方を示していますか。作品全体を評価する言葉（「傑作」「失望」「おすすめ」など）も、評価として数えてください。事実の説明だけで、評価が読み取れないときは「言及なし」にしてください。書かれていないことは推測しないでください。`,
				options: [
					{ id: '肯定', value: 'positive', description: '作品全体を、好意的に評価している' },
					{ id: '否定', value: 'negative', description: '作品全体を、否定的に評価している' },
					{ id: '混在', value: 'mixed', description: '作品全体について、良い評価と悪い評価の両方が、同じ程度書かれている' },
					{ id: '言及なし', value: 'none', description: '作品全体への評価が読み取れない（書かれていないことを推測で補わない）' }
				]
			},
			{
				key: 'overall_star',
				aspect: 'overall',
				kind: 'star',
				instructions: `次のゲームレビューの抜粋は、${OVERALL}について、どのくらい強く肯定または否定していますか。作品全体を評価する言葉も、評価として数えてください。書かれていないことは推測しないでください。`,
				levels: [
					'作品全体を、強い言葉で否定している（失敗作、おすすめしない、など）',
					'作品全体を、否定的に評価している、または欠点が目立つと述べている',
					'作品全体を、良くも悪くもない、または、良い点と悪い点が釣り合っていると述べている',
					'作品全体を、好意的に評価している（良作、楽しめる、など）',
					'作品全体を、強い言葉で絶賛している（傑作、必携、など）'
				]
			}
		]);
	});

	it('一般のレビューの質問セット（QUESTION_SETS）には、含まれない', () => {
		expect(QUESTION_SETS).not.toContain(criticV1);
	});

	it('偽の Clef（answersFor、clefAnswers）は、14問すべてに答え、その答えは interpretAnswers を通る。星は、向きに応じた値になる', () => {
		const directions = { gameplay: 'positive', music: 'negative', comfort: 'mixed', overall: 'positive' } as const;
		for (const answers of [answersFor(toClefQuestions(criticV1), directions), clefAnswers(directions, criticV1)]) {
			const out = interpretAnswers(criticV1, answers);
			expect(out).toHaveLength(14);
			const stars = Object.fromEntries(out.filter((a) => a.kind === 'star').map((a) => [a.aspect, a.value]));
			expect(stars).toEqual({ gameplay: '5', music: '1', comfort: '3', price: '3', overall: '5' });
			for (const a of out.filter((a) => a.kind === 'star')) {
				expect(a.star!.levels).toHaveLength(5);
				expect(a.star!.levels!.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 9);
				expect(a.star!.confidence).toBe(0.9);
			}
			expect(out.find((a) => a.questionKey === 'overall_choice')!.value).toBe('positive');
		}
	});
});
