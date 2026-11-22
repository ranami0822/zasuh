import { describe, expect, it } from 'vitest';
import { shareMeta } from './share';
import { EMPTY_STAR_STAT } from './stats';

const origin = 'https://review.anami.party';

describe('共有のメタ情報（shareMeta）', () => {
	it('URL と、星の平均と件数の説明を作る。平均は丸めず、小数1桁で書く', () => {
		const m = shareMeta({ slug: 'omori', overall: { n: 10, soft: [1, 1, 2, 3, 3], mean: 3.84, se: null } }, origin);
		expect(m.url).toBe('https://review.anami.party/works/omori');
		expect(m.description).toBe('星の平均 3.8（5段階。10 件の言及）');
	});

	it('幅があるときは、± を添える（幅は 1.96 × 標準誤差）', () => {
		const m = shareMeta({ slug: 'a', overall: { n: 20, soft: [0, 0, 0, 0, 0], mean: 4.0, se: 0.1 } }, origin);
		expect(m.description).toBe('星の平均 4.0 ± 0.2（5段階。20 件の言及）');
	});

	it('読み取りがない作品は、その旨を書く', () => {
		expect(shareMeta({ slug: 'a', overall: EMPTY_STAR_STAT }, origin).description).toBe('まだ、読み取れたレビューがありません。');
	});
});
