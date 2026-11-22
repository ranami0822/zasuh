import { describe, expect, it } from 'vitest';
import { buildCondition } from '../../../../scripts/star-questions';
import { latest, REGISTRY } from '../tags';
import { gameV1 } from './game-v1';
import { gameV2 } from './game-v2';

describe('ゲームの質問セット v2（言及＋星）', () => {
	it('実験の S3 条件と、同じ文面・同じ順序の8問。向きの質問は入っていない', () => {
		expect(gameV2.questions).toEqual(buildCondition('S3').questions);
		expect(gameV2.questions.map((q) => q.key)).toEqual([
			'gameplay_noul', 'gameplay_star', 'music_noul', 'music_star',
			'comfort_noul', 'comfort_star', 'price_noul', 'price_star'
		]);
		expect(gameV2.questions.some((q) => q.kind === 'direction')).toBe(false);
		expect(gameV2.version).toBe(2);
	});

	it('星の段階は5つ（低い順）', () => {
		for (const q of gameV2.questions) if (q.kind === 'star') expect(q.levels).toHaveLength(5);
	});
});

describe('タグの版', () => {
	it('どのタグも、最新の版は v2（言及＋星）。質問は2つで、向きは入らない', () => {
		const ids = new Set(REGISTRY.tags.map((t) => t.id));
		for (const id of ids) {
			const t = latest(REGISTRY, id);
			expect(t.version).toBe(2);
			expect(t.questions.map((q) => q.kind)).toEqual(['mention', 'star']);
			expect(t.questions.every((q) => q.aspect === t.key)).toBe(true);
		}
	});

	it('v1 の定義は、そのまま残っている（保存済みの読み取りと意味がずれないように）', () => {
		for (const a of gameV1.aspects) {
			const v1 = REGISTRY.tags.find((t) => t.id === `game/${a.key}` && t.version === 1)!;
			expect(v1.questions).toEqual(gameV1.questions.filter((q) => q.aspect === a.key));
		}
		// 追加のタグとソフトウェアのタグにも、v1（向き＋言及）がある。
		const v1 = REGISTRY.tags.find((t) => t.id === 'software/function' && t.version === 1)!;
		expect(v1.questions.map((q) => q.kind)).toEqual(['direction', 'mention']);
	});
});
