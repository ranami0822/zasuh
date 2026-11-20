import { describe, expect, it } from 'vitest';
import { shareMeta } from './share';

const origin = 'https://review.anami.party';

describe('共有のメタ情報（shareMeta）', () => {
	it('URL と、向きの件数の説明を作る。点数の言葉は入れない', () => {
		const m = shareMeta({ slug: 'omori', overall: { nMention: 10, nPos: 6, nNeg: 3, nMix: 1 } }, origin);
		expect(m.url).toBe('https://review.anami.party/works/omori');
		expect(m.description).toBe('肯定 6・否定 3・混在 1（10 件の言及）');
		expect(m.description).not.toMatch(/点|スコア|評価/);
	});

	it('読み取りがない作品は、その旨を書く（overall が null でも、nMention が 0 でも）', () => {
		const empty = 'まだ、読み取れたレビューがありません。';
		expect(shareMeta({ slug: 'a', overall: null }, origin).description).toBe(empty);
		expect(shareMeta({ slug: 'a', overall: { nMention: 0, nPos: 0, nNeg: 0, nMix: 0 } }, origin).description).toBe(empty);
	});
});
