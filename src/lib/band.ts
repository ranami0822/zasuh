/** タイトルの帯（グラデーション）の色と、その上の文字の色。サーバーと画面の両方で使う（外部に依存しない）。 */

export const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** 帯の上の文字の候補。明るい帯には墨、暗い帯には白に近い色。 */
const TEXT_CHOICES = [
	{ fg: '#171717', muted: '#262626' },
	{ fg: '#f5f5f5', muted: '#d4d4d4' }
] as const;

/** 文字に必要な、コントラスト比。4.5:1 に、粒状感で明るさが動く分の余裕を足した。 */
export const MIN_CONTRAST = 5;

export interface Band {
	from: string;
	to: string;
	fg: string;
	muted: string;
}

function channel(hex: string, i: number): number {
	return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}

function luminance(rgb: [number, number, number]): number {
	const [r, g, b] = rgb.map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const la = luminance([channel(a, 0), channel(a, 1), channel(a, 2)]);
	const lb = luminance([channel(b, 0), channel(b, 1), channel(b, 2)]);
	const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

function mix(a: string, b: string, t: number): string {
	const part = (i: number) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, '0');
	return `#${part(0)}${part(1)}${part(2)}`;
}

/**
 * 2色から、文字の色を決める。どの文字の色でも、帯の全体（両端と途中）で、基準に届かないなら null（読みにくい組み合わせ）。
 * 大文字は小文字にそろえる。
 */
export function bandFor(fromColor: string, toColor: string): Band | null {
	const from = fromColor.toLowerCase();
	const to = toColor.toLowerCase();
	if (!HEX_COLOR.test(from) || !HEX_COLOR.test(to)) return null;
	const samples = [from, mix(from, to, 0.25), mix(from, to, 0.5), mix(from, to, 0.75), to];
	let best: { choice: (typeof TEXT_CHOICES)[number]; worst: number } | null = null;
	for (const choice of TEXT_CHOICES) {
		const worst = Math.min(...samples.map((s) => contrast(choice.muted, s)));
		if (!best || worst > best.worst) best = { choice, worst };
	}
	if (!best || best.worst < MIN_CONTRAST) return null;
	return { from, to, fg: best.choice.fg, muted: best.choice.muted };
}
