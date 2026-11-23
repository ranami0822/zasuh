/**
 * 専門家の欄（作品ページ）に出すデータの形。サーバーとブラウザの両方から読む（型だけ。サーバーの処理は入れない）。
 * 決定は docs/mvp-design.md の 22.1（本文・抜粋・媒体の点数・ロゴは出さない。出典に OpenCritic を載せる）と、
 * 2026-11-23 のユーザーの回答（画面は 22.10）。
 */

/** 言及のあった観点（専門家の抜粋は、ほぼ総合を述べるので、付くのは、まれ）。 */
export interface CriticAspect {
	key: 'gameplay' | 'music' | 'comfort' | 'price';
	/** 画面に出す名前（例: ゲーム性）。 */
	label: string;
	/** 星（1〜5の連続値。丸めない）。 */
	stars: number;
}

export interface CriticItem {
	/** 媒体名（OpenCritic が載せている名前のまま。個人名のこともある）。 */
	outlet: string;
	/** 公開日（YYYY-MM-DD）。不明なら null。 */
	publishedOn: string | null;
	/** 元の記事の URL。 */
	url: string;
	/** 総合の星（1〜5の連続値。丸めない）。 */
	stars: number;
	aspects: CriticAspect[];
}

export interface CriticPane {
	/** 総合の星が読めた専門家のレビューの数。 */
	n: number;
	/** 星1〜5の、確率の合計（ソフトな件数。長さ 5）。 */
	soft: number[];
	/** 平均（1〜5）。n が 0 なら null。 */
	mean: number | null;
	/** 平均の幅（標準誤差）。n が少ないと null（読者の欄と同じ決まり。MIN_N_FOR_SE）。 */
	se: number | null;
	/** 新しい順（公開日の降順。公開日が不明なものは、最後）。 */
	items: CriticItem[];
	/** 出典（OpenCritic）のリンク先。 */
	sourceUrl: string;
}

/**
 * 媒体の帯（自動で横に流れる）の、次の位置（scrollLeft）。純粋な関数（画面の部品から呼ぶ。テストできる形）。
 * 項目の集まりを2組（2組めは複製）並べ、位置が1組の幅に達したら、その幅を引いて戻す（切れ目なく回す）。
 * 経過時間が大きいとき（タブの切り替えなど）や、手で複製の組まで動かしたあとでも、1組の幅の中に収める。
 * 1組の幅が 0 以下（流さない）、速さが 0 以下、経過時間が負のときは、進めない。
 */
export function tickerAdvance(scrollLeft: number, dtMs: number, speedPxPerSec: number, setWidth: number): number {
	if (!(setWidth > 0)) return scrollLeft;
	const next = scrollLeft + (Math.max(0, dtMs) * Math.max(0, speedPxPerSec)) / 1000;
	return next >= setWidth ? next % setWidth : next;
}

/**
 * AI の総合の星と、媒体自身の点数（0〜100）の差が、これより大きい抜粋は、専門家の欄に入れない（ラフな閾値。
 * docs/mvp-design.md の 22.12）。
 */
export const CRITIC_DISAGREE_POINTS = 30;

/**
 * AI の総合の星（1〜5）を 100 点満点にした値（星×20）と、媒体の点数の差の絶対値が、閾値より大きいか。
 * 媒体の点数が null（点数がない）なら、ずれていないとみなす。差がちょうど閾値なら、ずれていない。
 */
export function criticDisagrees(stars: number, ocScore: number | null, threshold = CRITIC_DISAGREE_POINTS): boolean {
	if (ocScore === null) return false;
	return Math.abs(stars * 20 - ocScore) > threshold;
}
