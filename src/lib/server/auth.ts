import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse
} from '@simplewebauthn/server';
import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/server';
import type { D1Database } from '@cloudflare/workers-types';
import type { Mailer } from './mail';
import { recoverMail, verifyMail } from './mail';
import { DEVICE_TTL_MS, deviceTokenHash, findReviewer } from './reviews';
import { sha256Hex } from './text';

/** 許す origin。RP ID は、ホスト名そのもの（親ドメインにしない）。変えると、登録したパスキーが、すべて使えなくなる。 */
const ORIGINS: Record<string, string> = {
	'review.anami.party': 'https://review.anami.party',
	localhost: 'http://localhost:8787'
};

export interface AuthConfig {
	rpID: string;
	rpName: string;
	origin: string;
}

/** 要求のホスト名から設定を作る。許していないホスト名では、null。 */
export function authConfigFor(url: URL): AuthConfig | null {
	const origin = ORIGINS[url.hostname];
	if (!origin) return null;
	// localhost は、ポートが変わる（wrangler dev の 8787、8788 など）。
	return { rpID: url.hostname, rpName: 'Zasuh', origin: url.hostname === 'localhost' ? url.origin : origin };
}

/** ES256（secp256r1）だけを受け付ける。Sui のアドレスを、あとから作れるようにするため。 */
export const ALGORITHMS = [-7];
const MIN = 60_000;
export const CHALLENGE_TTL_MS = 5 * MIN;
const MAX_LIVE_CHALLENGES = 4000;
export const STEPUP_TTL_MS = 5 * MIN;
export const VERIFY_LINK_TTL_MS = 60 * MIN;
export const RECOVER_LINK_TTL_MS = 15 * MIN;
const RECOVERY_REQUESTS_PER_EMAIL_PER_HOUR = 3;
const EMAIL_LINKS_PER_IP_PER_DAY = 10;

export type AuthError =
	| 'config'
	| 'challenge'
	| 'verify_failed'
	| 'duplicate_credential'
	| 'unknown_credential'
	| 'not_found'
	| 'last_credential'
	| 'stepup_required'
	| 'bad_email'
	| 'email_disabled'
	| 'email_taken'
	| 'bad_token';

export type AuthResult<T = object> = ({ ok: true } & T) | { ok: false; error: AuthError };

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomToken = (bytes = 32): string => b64(crypto.getRandomValues(new Uint8Array(bytes)));

// --- チャレンジ ---

async function saveChallenge(
	db: D1Database,
	challenge: string,
	purpose: 'register' | 'login' | 'stepup' | 'recover',
	reviewerId: string | null,
	ref: string | null,
	now: Date
): Promise<void> {
	await db.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(now.toISOString()).run();
	// ログインの開始は、誰でも呼べるので、有効なチャレンジが増え続けないよう、新しい 3,999 件だけを残して、1件足す（合計 4,000 件まで）。
	await db
		.prepare('DELETE FROM challenges WHERE created_at < (SELECT created_at FROM challenges ORDER BY created_at DESC LIMIT 1 OFFSET ?)')
		.bind(MAX_LIVE_CHALLENGES - 2)
		.run();
	await db
		.prepare('INSERT INTO challenges (challenge, purpose, reviewer_id, ref, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(challenge, purpose, reviewerId, ref, new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(), now.toISOString())
		.run();
}

/** チャレンジを、一度だけ使えるように、取り出して消す。用途と持ち主が合わなければ、使えない。 */
async function consumeChallenge(
	db: D1Database,
	challenge: string,
	purpose: string,
	reviewerId: string | null,
	now: Date
): Promise<{ ref: string | null; reviewerId: string | null } | null> {
	const row = await db
		.prepare('DELETE FROM challenges WHERE challenge = ? AND purpose = ? AND expires_at > ? RETURNING reviewer_id AS reviewerId, ref')
		.bind(challenge, purpose, now.toISOString())
		.first<{ reviewerId: string | null; ref: string | null }>();
	if (!row) return null;
	if (reviewerId !== null && row.reviewerId !== reviewerId) return null;
	return row;
}

// --- 登録 ---

async function userHandle(db: D1Database, reviewerId: string): Promise<Uint8Array> {
	const row = await db.prepare('SELECT user_handle AS h FROM reviewers WHERE id = ?').bind(reviewerId).first<{ h: string | null }>();
	if (row?.h) return unb64(row.h);
	const handle = randomToken(64);
	await db.prepare('UPDATE reviewers SET user_handle = ? WHERE id = ? AND user_handle IS NULL').bind(handle, reviewerId).run();
	const again = await db.prepare('SELECT user_handle AS h FROM reviewers WHERE id = ?').bind(reviewerId).first<{ h: string }>();
	return unb64(again!.h);
}

export async function registrationOptions(
	db: D1Database,
	cfg: AuthConfig,
	reviewerId: string,
	now: Date,
	opts: { purpose?: 'register' | 'recover'; ref?: string } = {}
): Promise<PublicKeyCredentialCreationOptionsJSON> {
	const handle = await userHandle(db, reviewerId);
	const { results } = await db
		.prepare('SELECT id, transports FROM credentials WHERE reviewer_id = ?')
		.bind(reviewerId)
		.all<{ id: string; transports: string | null }>();
	const options = await generateRegistrationOptions({
		rpName: cfg.rpName,
		rpID: cfg.rpID,
		userName: `zasuh-${b64(handle).slice(0, 6)}`,
		userDisplayName: 'Zasuh のアカウント',
		userID: handle as Uint8Array<ArrayBuffer>,
		attestationType: 'none',
		authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
		supportedAlgorithmIDs: ALGORITHMS,
		excludeCredentials: results.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined }))
	});
	await saveChallenge(db, options.challenge, opts.purpose ?? 'register', reviewerId, opts.ref ?? null, now);
	return options;
}

/** 検証して、パスキーを保存する。同じクレデンシャル ID が、すでにあれば、上書きせず、断る。 */
export async function finishRegistration(
	db: D1Database,
	cfg: AuthConfig,
	reviewerId: string,
	response: RegistrationResponseJSON,
	now: Date,
	opts: { purpose?: 'register' | 'recover'; label?: string } = {}
): Promise<AuthResult<{ credentialId: string; ref: string | null }>> {
	let ref: string | null = null;
	let verification;
	try {
		verification = await verifyRegistrationResponse({
			response,
			expectedChallenge: async (challenge) => {
				const used = await consumeChallenge(db, challenge, opts.purpose ?? 'register', reviewerId, now);
				ref = used?.ref ?? null;
				return used !== null;
			},
			expectedOrigin: cfg.origin,
			expectedRPID: cfg.rpID,
			requireUserVerification: false,
			supportedAlgorithmIDs: ALGORITHMS
		});
	} catch {
		return { ok: false, error: 'verify_failed' };
	}
	if (!verification.verified || !verification.registrationInfo) return { ok: false, error: 'verify_failed' };
	const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
	const taken = await db.prepare('SELECT 1 AS x FROM credentials WHERE id = ?').bind(credential.id).first();
	if (taken) return { ok: false, error: 'duplicate_credential' };
	try {
		await db.batch([
		db
			.prepare(
				`INSERT INTO credentials (id, reviewer_id, public_key, counter, transports, device_type, backed_up, label, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				credential.id,
				reviewerId,
				b64(credential.publicKey),
				credential.counter,
				credential.transports ? JSON.stringify(credential.transports) : null,
				credentialDeviceType,
				credentialBackedUp ? 1 : 0,
				opts.label?.slice(0, 40) || null,
				now.toISOString()
			),
		db.prepare("UPDATE reviewers SET kind = 'passkey' WHERE id = ?").bind(reviewerId)
		]);
	} catch {
		// 同時の登録で、同じクレデンシャル ID が先に入った（主キーの重複）。上書きは、しない。
		return { ok: false, error: 'duplicate_credential' };
	}
	return { ok: true, credentialId: credential.id, ref };
}

// --- ログインと、本人確認 ---

export async function loginOptions(
	db: D1Database,
	cfg: AuthConfig,
	now: Date,
	opts: { purpose?: 'login' | 'stepup'; reviewerId?: string } = {}
): Promise<PublicKeyCredentialRequestOptionsJSON> {
	const options = await generateAuthenticationOptions({ rpID: cfg.rpID, userVerification: 'preferred', allowCredentials: [] });
	await saveChallenge(db, options.challenge, opts.purpose ?? 'login', opts.reviewerId ?? null, null, now);
	return options;
}

/** パスキーでの認証を検証する。成功したら、そのパスキーの持ち主（アカウント）を返す。 */
export async function finishLogin(
	db: D1Database,
	cfg: AuthConfig,
	response: AuthenticationResponseJSON,
	now: Date,
	opts: { purpose?: 'login' | 'stepup'; reviewerId?: string } = {}
): Promise<AuthResult<{ reviewerId: string }>> {
	const row = await db
		.prepare('SELECT id, reviewer_id AS reviewerId, public_key AS publicKey, counter, transports FROM credentials WHERE id = ?')
		.bind(response.id)
		.first<{ id: string; reviewerId: string; publicKey: string; counter: number; transports: string | null }>();
	if (!row) return { ok: false, error: 'unknown_credential' };
	if (opts.reviewerId && row.reviewerId !== opts.reviewerId) return { ok: false, error: 'unknown_credential' };
	let verification;
	try {
		verification = await verifyAuthenticationResponse({
			response,
			expectedChallenge: async (challenge) =>
				(await consumeChallenge(db, challenge, opts.purpose ?? 'login', opts.reviewerId ?? null, now)) !== null,
			expectedOrigin: cfg.origin,
			expectedRPID: cfg.rpID,
			requireUserVerification: false,
			credential: {
				id: row.id,
				publicKey: unb64(row.publicKey) as Uint8Array<ArrayBuffer>,
				counter: row.counter,
				transports: row.transports ? JSON.parse(row.transports) : undefined
			}
		});
	} catch {
		return { ok: false, error: 'verify_failed' };
	}
	if (!verification.verified) return { ok: false, error: 'verify_failed' };
	const { newCounter } = verification.authenticationInfo;
	// 同期型のパスキーは、回数を進めないことが多い。減ったときだけ、記録する（拒否はしない）。
	if (newCounter !== 0 && newCounter < row.counter) console.warn(JSON.stringify({ event: 'passkey_counter_decreased', credential: row.id.slice(0, 8) }));
	await db
		.prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?')
		.bind(Math.max(newCounter, row.counter), now.toISOString(), row.id)
		.run();
	return { ok: true, reviewerId: row.reviewerId };
}

// --- ログイン中の端末 ---

/** このアカウントの端末として、新しい印を作る。返した文字列を、Cookie に入れる。 */
export async function issueDevice(db: D1Database, reviewerId: string, now: Date, opts: { stepup?: boolean } = {}): Promise<string> {
	const token = randomToken();
	await db
		.prepare('INSERT INTO device_tokens (token_hash, reviewer_id, expires_at, stepup_until, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(
			await deviceTokenHash(token),
			reviewerId,
			new Date(now.getTime() + DEVICE_TTL_MS).toISOString(),
			opts.stepup ? new Date(now.getTime() + STEPUP_TTL_MS).toISOString() : null,
			now.toISOString(),
			now.toISOString()
		)
		.run();
	return token;
}

/** 現在の端末の印（ログインなしの印）を、アカウントの端末として登録し直す。登録のときに使う（投稿者の行が、そのままアカウントになる）。 */
export async function adoptDevice(db: D1Database, reviewerId: string, tokenHash: string, now: Date): Promise<void> {
	await db
		.prepare(
			`INSERT INTO device_tokens (token_hash, reviewer_id, expires_at, stepup_until, created_at, last_used_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (token_hash) DO UPDATE SET reviewer_id = excluded.reviewer_id, expires_at = excluded.expires_at, stepup_until = excluded.stepup_until`
		)
		.bind(tokenHash, reviewerId, new Date(now.getTime() + DEVICE_TTL_MS).toISOString(), new Date(now.getTime() + STEPUP_TTL_MS).toISOString(), now.toISOString(), now.toISOString())
		.run();
	// 以前の「ログインなしの印」は、ここから、アカウントの端末の印に置き換わる。
	await db.prepare('UPDATE reviewers SET token_hash = NULL WHERE id = ? AND token_hash = ?').bind(reviewerId, tokenHash).run();
}

export async function markStepup(db: D1Database, tokenHash: string, now: Date): Promise<void> {
	await db
		.prepare('UPDATE device_tokens SET stepup_until = ? WHERE token_hash = ?')
		.bind(new Date(now.getTime() + STEPUP_TTL_MS).toISOString(), tokenHash)
		.run();
}

/** この端末が、直前（5分以内）に、パスキーで認証したか。 */
export async function hasRecentStepup(db: D1Database, tokenHash: string, now: Date): Promise<boolean> {
	const row = await db.prepare('SELECT stepup_until AS s FROM device_tokens WHERE token_hash = ?').bind(tokenHash).first<{ s: string | null }>();
	return !!row?.s && row.s > now.toISOString();
}

export async function logout(db: D1Database, tokenHash: string): Promise<void> {
	await db.prepare('DELETE FROM device_tokens WHERE token_hash = ?').bind(tokenHash).run();
}

/** このアカウントの、すべての端末のログインを取り消す。 */
export async function logoutEverywhere(db: D1Database, reviewerId: string): Promise<void> {
	await db.batch([
		db.prepare('DELETE FROM device_tokens WHERE reviewer_id = ?').bind(reviewerId),
		db.prepare('UPDATE reviewers SET token_hash = NULL WHERE id = ?').bind(reviewerId)
	]);
}

/**
 * ログインなしの投稿者（この端末で、これまでに投稿した分）を、アカウントにまとめる。
 * 同じ作品に、両方のレビューがある場合は、そのレビューは、まとめない。
 */
export async function mergeAnonymous(db: D1Database, fromReviewerId: string, intoReviewerId: string): Promise<void> {
	if (fromReviewerId === intoReviewerId) return;
	const from = await db.prepare('SELECT kind FROM reviewers WHERE id = ?').bind(fromReviewerId).first<{ kind: string }>();
	if (from?.kind !== 'anon') return;
	await db.batch([
		db
			.prepare(
				`UPDATE reviews SET reviewer_id = ?
				  WHERE reviewer_id = ? AND work_id NOT IN (SELECT work_id FROM reviews WHERE reviewer_id = ?)`
			)
			.bind(intoReviewerId, fromReviewerId, intoReviewerId),
		db.prepare('UPDATE reports SET reporter_id = ? WHERE reporter_id = ?').bind(intoReviewerId, fromReviewerId),
		db.prepare('UPDATE messages SET sender_id = ? WHERE sender_id = ?').bind(intoReviewerId, fromReviewerId)
	]);
}

// --- パスキーの一覧と削除 ---

export interface CredentialInfo {
	id: string;
	createdAt: string;
	lastUsedAt: string | null;
	deviceType: string;
	backedUp: boolean;
	label: string | null;
}

export async function listCredentials(db: D1Database, reviewerId: string): Promise<CredentialInfo[]> {
	const { results } = await db
		.prepare(
			`SELECT id, created_at AS createdAt, last_used_at AS lastUsedAt, device_type AS deviceType, backed_up AS backedUp, label
			   FROM credentials WHERE reviewer_id = ? ORDER BY created_at`
		)
		.bind(reviewerId)
		.all<Omit<CredentialInfo, 'backedUp'> & { backedUp: number }>();
	return results.map((r) => ({ ...r, backedUp: r.backedUp === 1 }));
}

/** パスキーを削除する。最後の1つは、削除できない。 */
export async function deleteCredential(db: D1Database, reviewerId: string, credentialId: string): Promise<AuthResult> {
	const all = await listCredentials(db, reviewerId);
	if (!all.some((c) => c.id === credentialId)) return { ok: false, error: 'not_found' };
	if (all.length <= 1) return { ok: false, error: 'last_credential' };
	await db.prepare('DELETE FROM credentials WHERE id = ? AND reviewer_id = ?').bind(credentialId, reviewerId).run();
	return { ok: true };
}

// --- メール ---

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeEmail = (email: string): string => email.normalize('NFKC').trim().toLowerCase();

export async function accountEmail(db: D1Database, reviewerId: string): Promise<{ email: string; verified: boolean } | null> {
	const row = await db.prepare('SELECT email, verified_at AS v FROM account_emails WHERE reviewer_id = ?').bind(reviewerId).first<{ email: string; v: string | null }>();
	return row ? { email: row.email, verified: row.v !== null } : null;
}

async function createEmailToken(
	db: D1Database,
	purpose: 'verify' | 'recover',
	reviewerId: string,
	email: string,
	ttl: number,
	ipHash: string | null,
	now: Date
): Promise<string> {
	const token = randomToken();
	await db
		.prepare('INSERT INTO email_tokens (token_hash, purpose, reviewer_id, email, expires_at, ip_day_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
		.bind(await sha256Hex(`email-token:${token}`), purpose, reviewerId, email, new Date(now.getTime() + ttl).toISOString(), ipHash, now.toISOString())
		.run();
	return token;
}

/** 復旧用のメールアドレスを登録して、確認のリンクを送る。確認するまでは、復旧には使わない。 */
export async function setEmail(
	db: D1Database,
	reviewerId: string,
	rawEmail: string,
	opts: { mailer: Mailer | null; origin: string; ipHash: string | null },
	now: Date
): Promise<AuthResult> {
	if (!opts.mailer) return { ok: false, error: 'email_disabled' };
	const email = normalizeEmail(rawEmail);
	if (email.length > 254 || !EMAIL_PATTERN.test(email)) return { ok: false, error: 'bad_email' };
	if (opts.ipHash) {
		const n = await db.prepare('SELECT COUNT(*) AS n FROM email_tokens WHERE ip_day_hash = ?').bind(opts.ipHash).first<{ n: number }>();
		if ((n?.n ?? 0) >= EMAIL_LINKS_PER_IP_PER_DAY) return { ok: true }; // 上限は、知らせない
	}
	// 他人のアドレスに、確認のメールを、何通も送りつけられないよう、アドレスごとにも制限する。
	const hourAgo = new Date(now.getTime() - 60 * MIN).toISOString();
	const sentToEmail = await db
		.prepare("SELECT COUNT(*) AS n FROM email_tokens WHERE email = ? AND purpose = 'verify' AND created_at > ?")
		.bind(email, hourAgo)
		.first<{ n: number }>();
	if ((sentToEmail?.n ?? 0) >= RECOVERY_REQUESTS_PER_EMAIL_PER_HOUR) return { ok: true };
	await db
		.prepare(
			`INSERT INTO account_emails (reviewer_id, email, verified_at, created_at) VALUES (?, ?, NULL, ?)
			 ON CONFLICT (reviewer_id) DO UPDATE SET email = excluded.email, verified_at = NULL, created_at = excluded.created_at`
		)
		.bind(reviewerId, email, now.toISOString())
		.run();
	// すでに別のアカウントが確認済みのアドレスでも、同じ応答にする（登録の有無を、教えない）。確認のときに、断る。
	const token = await createEmailToken(db, 'verify', reviewerId, email, VERIFY_LINK_TTL_MS, opts.ipHash, now);
	const mail = verifyMail(`${opts.origin}/auth/verify?token=${token}`);
	await opts.mailer.send({ to: email, ...mail });
	return { ok: true };
}

export async function removeEmail(db: D1Database, reviewerId: string): Promise<void> {
	await db.prepare('DELETE FROM account_emails WHERE reviewer_id = ?').bind(reviewerId).run();
}

async function findEmailToken(db: D1Database, token: string, purpose: 'verify' | 'recover', now: Date) {
	return db
		.prepare(
			`SELECT token_hash AS hash, reviewer_id AS reviewerId, email FROM email_tokens
			  WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?`
		)
		.bind(await sha256Hex(`email-token:${token}`), purpose, now.toISOString())
		.first<{ hash: string; reviewerId: string; email: string }>();
}

/** リンクの確認。リンクを開いただけでは、使い切らない（このあとの、ボタンの操作で、使う）。 */
export async function checkEmailToken(db: D1Database, token: string, purpose: 'verify' | 'recover', now: Date): Promise<boolean> {
	return (await findEmailToken(db, token, purpose, now)) !== null;
}

async function useEmailToken(db: D1Database, hash: string, now: Date): Promise<boolean> {
	const r = await db
		.prepare('UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
		.bind(now.toISOString(), hash, now.toISOString())
		.run();
	return (r.meta?.changes ?? 0) === 1;
}

export async function confirmEmail(db: D1Database, token: string, now: Date): Promise<AuthResult> {
	const row = await findEmailToken(db, token, 'verify', now);
	if (!row) return { ok: false, error: 'bad_token' };
	const current = await db.prepare('SELECT email FROM account_emails WHERE reviewer_id = ?').bind(row.reviewerId).first<{ email: string }>();
	if (!current || current.email !== row.email) return { ok: false, error: 'bad_token' }; // あとで、別のアドレスに変えた
	const taken = await db
		.prepare('SELECT 1 AS x FROM account_emails WHERE email = ? AND verified_at IS NOT NULL AND reviewer_id != ?')
		.bind(row.email, row.reviewerId)
		.first();
	if (taken) return { ok: false, error: 'email_taken' };
	if (!(await useEmailToken(db, row.hash, now))) return { ok: false, error: 'bad_token' };
	await db.prepare('UPDATE account_emails SET verified_at = ? WHERE reviewer_id = ?').bind(now.toISOString(), row.reviewerId).run();
	return { ok: true };
}

/**
 * 復旧のリンクを送る。確認済みのアドレスがなくても、呼び出した側には、同じ結果を返す（登録の有無を、教えない）。
 * アドレスごと（1時間に3通）と、送信元ごと（1日10通）に、制限する。
 */
export async function requestRecovery(
	db: D1Database,
	rawEmail: string,
	opts: { mailer: Mailer | null; origin: string; ipHash: string | null },
	now: Date
): Promise<AuthResult> {
	if (!opts.mailer) return { ok: false, error: 'email_disabled' };
	const email = normalizeEmail(rawEmail);
	if (email.length > 254 || !EMAIL_PATTERN.test(email)) return { ok: false, error: 'bad_email' };
	const hourAgo = new Date(now.getTime() - 60 * MIN).toISOString();
	const byEmail = await db.prepare("SELECT COUNT(*) AS n FROM email_tokens WHERE email = ? AND purpose = 'recover' AND created_at > ?").bind(email, hourAgo).first<{ n: number }>();
	if ((byEmail?.n ?? 0) >= RECOVERY_REQUESTS_PER_EMAIL_PER_HOUR) return { ok: true };
	if (opts.ipHash) {
		const byIp = await db.prepare('SELECT COUNT(*) AS n FROM email_tokens WHERE ip_day_hash = ?').bind(opts.ipHash).first<{ n: number }>();
		if ((byIp?.n ?? 0) >= EMAIL_LINKS_PER_IP_PER_DAY) return { ok: true };
	}
	const owner = await db
		.prepare('SELECT reviewer_id AS reviewerId FROM account_emails WHERE email = ? AND verified_at IS NOT NULL')
		.bind(email)
		.first<{ reviewerId: string }>();
	if (!owner) return { ok: true };
	const token = await createEmailToken(db, 'recover', owner.reviewerId, email, RECOVER_LINK_TTL_MS, opts.ipHash, now);
	await opts.mailer.send({ to: email, ...recoverMail(`${opts.origin}/recover/${token}`) });
	return { ok: true };
}

/** 復旧のリンクから、新しいパスキーの登録を始める。リンクは、まだ使い切らない（登録が終わったときに、使う）。 */
export async function recoveryRegistrationOptions(db: D1Database, cfg: AuthConfig, token: string, now: Date) {
	const row = await findEmailToken(db, token, 'recover', now);
	if (!row) return null;
	return registrationOptions(db, cfg, row.reviewerId, now, { purpose: 'recover', ref: row.hash });
}

/**
 * 復旧の登録を終える。新しいパスキーを検証してから、リンクを使い切り、**それまでのパスキーと、ログイン中の端末を、すべて取り消して**、
 * 新しいパスキーだけを残す。新しい端末の印を返す。
 */
export async function finishRecovery(
	db: D1Database,
	cfg: AuthConfig,
	token: string,
	response: RegistrationResponseJSON,
	now: Date
): Promise<AuthResult<{ reviewerId: string; deviceToken: string }>> {
	const row = await findEmailToken(db, token, 'recover', now);
	if (!row) return { ok: false, error: 'bad_token' };
	const old = await db.prepare('SELECT id FROM credentials WHERE reviewer_id = ?').bind(row.reviewerId).all<{ id: string }>();
	const registered = await finishRegistration(db, cfg, row.reviewerId, response, now, { purpose: 'recover' });
	if (!registered.ok) return registered;
	if (registered.ref !== row.hash) return { ok: false, error: 'challenge' };
	if (!(await useEmailToken(db, row.hash, now))) {
		// 同時に、別の要求が、リンクを使い切った。いま登録したパスキーは、残さない。
		await db.prepare('DELETE FROM credentials WHERE id = ?').bind(registered.credentialId).run();
		return { ok: false, error: 'bad_token' };
	}
	await db.batch([
		...old.results.map((c) => db.prepare('DELETE FROM credentials WHERE id = ?').bind(c.id)),
		db.prepare('DELETE FROM device_tokens WHERE reviewer_id = ?').bind(row.reviewerId),
		db.prepare('UPDATE reviewers SET token_hash = NULL WHERE id = ?').bind(row.reviewerId)
	]);
	return { ok: true, reviewerId: row.reviewerId, deviceToken: await issueDevice(db, row.reviewerId, now, { stepup: true }) };
}

export { findReviewer };
