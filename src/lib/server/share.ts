import type { AspectCounts } from './stats';

export interface ShareMeta {
	description: string;
	/** 作品ページの絶対 URL。 */
	url: string;
}

export interface ShareInput {
	slug: string;
	/** 作品ページの総合の集計。読み取り済みのレビューがなければ null。 */
	overall: (AspectCounts & { nMention: number }) | null;
}

/** 作品ページを共有したときの、説明と URL。点数は出さない。純粋な関数（DB を使わない）。 */
export function shareMeta(input: ShareInput, origin: string): ShareMeta {
	const o = input.overall;
	const description =
		o === null || o.nMention === 0
			? 'まだ、読み取れたレビューがありません。'
			: `肯定 ${o.nPos}・否定 ${o.nNeg}・混在 ${o.nMix}（${o.nMention} 件の言及）`;
	return { description, url: `${origin}/works/${input.slug}` };
}
