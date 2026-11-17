/** 文面をならす: 全角と半角をそろえ、小文字にして、文字と数字以外（空白、記号、絵文字）を取り除く。 */
export function normalizeText(text: string): string {
	return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

const SHINGLE = 3;

/** ならした文面を、3文字ずつに区切った集まり。 */
export function shingles(normalized: string): Set<string> {
	const out = new Set<string>();
	const chars = [...normalized];
	for (let i = 0; i + SHINGLE <= chars.length; i++) out.add(chars.slice(i, i + SHINGLE).join(''));
	return out;
}

/** 2つの集まりの重なりの割合（0〜1）。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let common = 0;
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	for (const x of small) if (large.has(x)) common++;
	return common / (a.size + b.size - common);
}

/** ならした文面が、これより短いレビューは、重複の判定に使わない。 */
export const MIN_DUPLICATE_LENGTH = 30;
/** 重なりが、これ以上なら「ほぼ同じ」。 */
export const DUPLICATE_THRESHOLD = 0.8;
/** 比べる相手の数（同じ作品の、新しい順）。 */
export const DUPLICATE_SCAN_LIMIT = 500;

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
