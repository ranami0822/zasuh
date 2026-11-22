/** 星の段階の数。 */
export const STAR_COUNT = 5;
/** 信頼水準 95% の z 値。 */
const Z95 = 1.959964;
/** 幅を出す最小の件数。これ未満は、幅を出さない。 */
export const MIN_N_FOR_SE = 5;
/**
 * 件数が少ないときの、共通の標準偏差。実験の 70 件の実測は、約 1.46（docs/mvp-design.md の 20.8）。未検証の初期値。
 */
export const COMMON_SD = 1.5;

/** 1件の答え。levels は、段階ごとの確率（低い順。星1〜5）。 */
export interface StarItem {
	levels: number[];
}

export interface StarSummary {
	/** 数えた答えの件数。 */
	n: number;
	/** 段階ごとの確率の合計（ソフトな件数。星1〜5）。 */
	soft: number[];
	/** 平均（1〜5。連続値）。n が 0 なら null。 */
	mean: number | null;
	/** 平均の幅（標準誤差）。n が MIN_N_FOR_SE 未満なら null。 */
	se: number | null;
	/** 控えめな値（平均 - 1.96 × 幅）。順位に使う。n が少ないときは、共通の標準偏差で幅を代用する。n が 0 なら null。 */
	lower: number | null;
}

/**
 * 星の答えを集計する。
 * レビュー r の平均 m_r と分散 v_r を、段階ごとの確率から出し、
 * 平均 M は m_r の平均、幅は √((m_r の分散（n-1 で割る） + v_r の平均) / n)。
 * 根拠: 70 件の実験データで、全体の平均が M ± 1.96×幅に入る割合を試した（n=5 で 96%、n=10 で 99%）。
 */
export function starSummary(items: StarItem[]): StarSummary {
	const n = items.length;
	const soft = Array<number>(STAR_COUNT).fill(0);
	if (n === 0) return { n, soft, mean: null, se: null, lower: null };

	const means: number[] = [];
	let withinTotal = 0;
	for (const { levels } of items) {
		const total = levels.reduce((s, p) => s + p, 0);
		const p = levels.map((x) => x / total);
		const m = p.reduce((s, x, i) => s + (i + 1) * x, 0);
		withinTotal += p.reduce((s, x, i) => s + (i + 1 - m) ** 2 * x, 0);
		means.push(m);
		p.forEach((x, i) => (soft[i] += x));
	}
	const mean = means.reduce((s, m) => s + m, 0) / n;

	if (n < MIN_N_FOR_SE) {
		return { n, soft, mean, se: null, lower: mean - Z95 * (COMMON_SD / Math.sqrt(n)) };
	}
	const between = means.reduce((s, m) => s + (m - mean) ** 2, 0) / (n - 1);
	const se = Math.sqrt((between + withinTotal / n) / n);
	return { n, soft, mean, se, lower: mean - Z95 * se };
}
