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
