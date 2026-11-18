import { encodeCBOR } from '@levischuck/tiny-cbor';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let i = 0;
	for (const p of parts) {
		out.set(p, i);
		i += p.length;
	}
	return out;
};
const sha256 = async (data: Uint8Array): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));

/** 生の署名（r || s）を、認証器が返す形（DER）に直す。 */
function toDer(raw: Uint8Array): Uint8Array {
	const int = (bytes: Uint8Array): Uint8Array => {
		let i = 0;
		while (i < bytes.length - 1 && bytes[i] === 0) i++;
		let v: Uint8Array = bytes.slice(i);
		if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
		return concat(new Uint8Array([0x02, v.length]), v);
	};
	const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
	return concat(new Uint8Array([0x30, body.length]), body);
}

export interface TestAuthenticatorOptions {
	rpID?: string;
	origin?: string;
	/** 同期できるパスキー（BE と BS のフラグ）。 */
	backedUp?: boolean;
}

/** テスト用の、ソフトウェアの認証器（ES256、証明なし）。ブラウザの代わりに、登録と認証の応答を作る。 */
export class TestAuthenticator {
	readonly credentialId: Uint8Array = crypto.getRandomValues(new Uint8Array(16));
	counter = 0;
	private keys!: CryptoKeyPair;
	constructor(private readonly opts: TestAuthenticatorOptions = {}) {}

	get id(): string {
		return b64(this.credentialId);
	}
	private get rpID() {
		return this.opts.rpID ?? 'localhost';
	}
	private get origin() {
		return this.opts.origin ?? 'http://localhost:8787';
	}

	private async ensureKeys() {
		this.keys ??= (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
	}

	private async clientData(type: string, challenge: string, origin = this.origin): Promise<Uint8Array> {
		return encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
	}

	async register(options: { challenge: string }, over: { origin?: string; rpID?: string } = {}): Promise<RegistrationResponseJSON> {
		await this.ensureKeys();
		const jwk = await crypto.subtle.exportKey('jwk', this.keys.publicKey);
		const cose = encodeCBOR(
			new Map<number, number | Uint8Array>([
				[1, 2],
				[3, -7],
				[-1, 1],
				[-2, unb64(jwk.x!)],
				[-3, unb64(jwk.y!)]
			])
		);
		const flags = 0x01 | 0x04 | 0x40 | (this.opts.backedUp ? 0x08 | 0x10 : 0);
		const authData = concat(
			await sha256(encoder.encode(over.rpID ?? this.rpID)),
			new Uint8Array([flags]),
			new Uint8Array([0, 0, 0, this.counter]),
			new Uint8Array(16),
			new Uint8Array([0, this.credentialId.length]),
			this.credentialId,
			cose
		);
		const attestationObject = encodeCBOR(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
		return {
			id: this.id,
			rawId: this.id,
			type: 'public-key',
			response: {
				clientDataJSON: b64(await this.clientData('webauthn.create', options.challenge, over.origin)),
				attestationObject: b64(attestationObject),
				transports: ['internal']
			},
			clientExtensionResults: {},
			authenticatorAttachment: 'platform'
		};
	}

	async authenticate(options: { challenge: string }, over: { origin?: string; rpID?: string; counter?: number } = {}): Promise<AuthenticationResponseJSON> {
		await this.ensureKeys();
		this.counter = over.counter ?? this.counter + 1;
		const flags = 0x01 | 0x04 | (this.opts.backedUp ? 0x08 | 0x10 : 0);
		const authData = concat(await sha256(encoder.encode(over.rpID ?? this.rpID)), new Uint8Array([flags]), new Uint8Array([0, 0, 0, this.counter]));
		const clientDataJSON = await this.clientData('webauthn.get', options.challenge, over.origin);
		const signed = concat(authData, await sha256(clientDataJSON));
		const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, signed as BufferSource));
		return {
			id: this.id,
			rawId: this.id,
			type: 'public-key',
			response: { clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authData), signature: b64(toDer(raw)) },
			clientExtensionResults: {},
			authenticatorAttachment: 'platform'
		};
	}
}
