const COOKIE = 'zs_admin';
export const ADMIN_COOKIE = COOKIE;
export const ADMIN_SESSION_MS = 12 * 3_600_000;

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 時間をかけずに比べる（先頭から違いを見つけて止まらない）。 */
export function safeEqual(a: string, b: string): boolean {
	const x = encoder.encode(a);
	const y = encoder.encode(b);
	let diff = x.length ^ y.length;
	for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return diff === 0;
}

/** 合言葉が合っていれば、12時間有効な印（期限と署名）を返す。合言葉は Cookie に入れない。secret がなければ null（管理画面は開かない）。 */
export async function loginAdmin(secret: string | undefined, given: string, now: Date): Promise<string | null> {
	if (!secret || !safeEqual(given, secret)) return null;
	const expires = String(now.getTime() + ADMIN_SESSION_MS);
	return `${expires}.${await hmac(secret, `admin:${expires}`)}`;
}

export async function isAdmin(secret: string | undefined, cookie: string | undefined, now: Date): Promise<boolean> {
	if (!secret || !cookie) return false;
	const [expires, signature] = cookie.split('.');
	if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < now.getTime()) return false;
	return safeEqual(signature, await hmac(secret, `admin:${expires}`));
}
