const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

export function randomToken(bytes = 32): string {
	return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(s: string): Promise<string> {
	return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

/**
 * 空間ごとの仮名。データベースには、利用者 ID との対応表を置かない。
 * 限界: 秘密の鍵を持つ運営は、計算し直せる（docs/pnn-server-design.md の第3節）。
 */
export async function pseudonym(secret: string, userId: string, space = 'pnn'): Promise<string> {
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${userId}:${space}`)));
	return b64url(sig.slice(0, 16));
}
