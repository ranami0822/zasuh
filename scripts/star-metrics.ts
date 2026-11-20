/**
 * 星の実験（experiments/clef-mention/README.md の第7弾）の指標。通信も、ファイルの読み書きもしない純粋な関数。
 * 星は、1〜5 の整数（ラベル）と、1〜5 の小数（モデルの score）を、区別して扱う。
 */

export type Pair = [label: number, predicted: number];

export const roundStar = (score: number): number => Math.round(score);

/** 完全一致の割合。モデルの score は、四捨五入してから比べる。 */
export function exactRate(pairs: Pair[]): number {
	return rate(pairs, (l, p) => roundStar(p) === l);
}

/** ±tolerance 以内の割合。 */
export function withinRate(pairs: Pair[], tolerance = 1): number {
	return rate(pairs, (l, p) => Math.abs(roundStar(p) - l) <= tolerance);
}

function rate(pairs: Pair[], ok: (l: number, p: number) => boolean): number {
	return pairs.length === 0 ? NaN : pairs.filter(([l, p]) => ok(l, p)).length / pairs.length;
}

/** 「ラベルでいちばん多い星を、いつも答える」場合の、完全一致と ±1 以内の割合。同数なら、小さい星。 */
export function modeBaseline(labels: number[]): { star: number; exact: number; within1: number } | null {
	if (labels.length === 0) return null;
	const counts = new Map<number, number>();
	for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
	const star = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
	return {
		star,
		exact: labels.filter((l) => l === star).length / labels.length,
		within1: labels.filter((l) => Math.abs(l - star) <= 1).length / labels.length
	};
}

/** 二次の重み付きκ（段階のずれが大きいほど、重く数える）。ラベルも予測も 1〜levels の整数として扱う。1 は完全一致、0 は偶然と同じ。 */
export function weightedKappa(pairs: Pair[], levels = 5): number {
	const n = pairs.length;
	if (n === 0) return NaN;
	const observed = Array.from({ length: levels }, () => new Array<number>(levels).fill(0));
	const rows = new Array<number>(levels).fill(0);
	const cols = new Array<number>(levels).fill(0);
	for (const [l, p] of pairs) {
		const i = clamp(l, levels) - 1;
		const j = clamp(roundStar(p), levels) - 1;
		observed[i][j]++;
		rows[i]++;
		cols[j]++;
	}
	let num = 0;
	let den = 0;
	for (let i = 0; i < levels; i++) {
		for (let j = 0; j < levels; j++) {
			const w = ((i - j) / (levels - 1)) ** 2;
			num += w * observed[i][j];
			den += (w * rows[i] * cols[j]) / n;
		}
	}
	return den === 0 ? NaN : 1 - num / den;
}

const clamp = (x: number, levels: number) => Math.min(levels, Math.max(1, x));

/** 予測の平均 - ラベルの平均。正なら、モデルが高めに付けている。 */
export function bias(pairs: Pair[]): number {
	if (pairs.length === 0) return NaN;
	const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	return mean(pairs.map(([, p]) => p)) - mean(pairs.map(([l]) => l));
}

/** 四捨五入した星ごとの件数（1〜levels）。4〜5 に集まっていないかを見る。 */
export function distribution(stars: number[], levels = 5): number[] {
	const out = new Array<number>(levels).fill(0);
	for (const s of stars) out[clamp(roundStar(s), levels) - 1]++;
	return out;
}

/**
 * ラベル付け者どうしの一致率（上限の目安）。votes は、項目ごとの、各ラベル付け者の星。
 * 同じ項目の、すべての2人の組で、完全一致と ±tolerance 以内を数える。
 */
export function pairwiseAgreement(votes: number[][], tolerance = 1): { exact: number; within: number; pairs: number } {
	let pairs = 0;
	let exact = 0;
	let within = 0;
	for (const v of votes) {
		for (let i = 0; i < v.length; i++) {
			for (let j = i + 1; j < v.length; j++) {
				pairs++;
				if (v[i] === v[j]) exact++;
				if (Math.abs(v[i] - v[j]) <= tolerance) within++;
			}
		}
	}
	return { exact: pairs ? exact / pairs : NaN, within: pairs ? within / pairs : NaN, pairs };
}

export type StarDirection = 'positive' | 'negative' | 'mixed';

/** 星から向きを出す。4〜5 は肯定、1〜2 は否定、3 は混在。 */
export function directionFromStar(score: number): StarDirection {
	const s = roundStar(score);
	return s >= 4 ? 'positive' : s <= 2 ? 'negative' : 'mixed';
}

/**
 * S3（向きを外す案）の向きの出し方。**実行前に固定した規則**（第7弾の条件の節）:
 * `noul` が 0.5 未満なら「言及なし」。それ以外は、星から出す。
 */
export function directionWithoutChoice(mentionProb: number, score: number): StarDirection | 'none' {
	return mentionProb < 0.5 ? 'none' : directionFromStar(score);
}

/** 同じ項目を、条件（言い換え、順序、繰り返し）を変えて読んだ2回の星を比べる。四捨五入した星が変わる割合と、score の差の平均。 */
export function stability(a: number[], b: number[]): { changed: number; meanAbsDiff: number; n: number } {
	const n = Math.min(a.length, b.length);
	if (n === 0) return { changed: NaN, meanAbsDiff: NaN, n: 0 };
	let changed = 0;
	let diff = 0;
	for (let i = 0; i < n; i++) {
		if (roundStar(a[i]) !== roundStar(b[i])) changed++;
		diff += Math.abs(a[i] - b[i]);
	}
	return { changed: changed / n, meanAbsDiff: diff / n, n };
}
