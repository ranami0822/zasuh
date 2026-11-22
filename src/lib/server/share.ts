import type { StarStat } from './stats';

export interface ShareMeta {
	description: string;
	/** 作品ページの絶対 URL。 */
	url: string;
}

export interface ShareInput {
	slug: string;
	/** 作品ページの総合の集計。 */
	overall: StarStat;
}

/**
 * 作品ページを共有したときの、説明と URL。星の平均（連続値。整数に丸めない）と、件数を書く。
 * 件数が少なくて幅を出せないときは、幅を書かない。純粋な関数（DB を使わない）。
 */
export function shareMeta(input: ShareInput, origin: string): ShareMeta {
	const o = input.overall;
	const description =
		o.n === 0 || o.mean === null
			? 'まだ、読み取れたレビューがありません。'
			: `星の平均 ${o.mean.toFixed(1)}${o.se === null ? '' : ` ± ${(1.96 * o.se).toFixed(1)}`}（5段階。${o.n} 件の言及）`;
	return { description, url: `${origin}/works/${input.slug}` };
}
