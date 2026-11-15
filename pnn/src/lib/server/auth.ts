import type { D1Database } from '@cloudflare/workers-types';
import { pseudonym, randomToken, sha256 } from './crypto';

export const SESSION_MS = 90 * 24 * 3600 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;

/** ログインしている人。pseudo は、この空間での仮名 */
export interface Viewer {
	userId: string;
	createdAt: number;
	pseudo: string;
}

export async function createUser(db: D1Database, id: string, now: number): Promise<void> {
	await db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').bind(id, now).run();
}

export async function createSession(db: D1Database, userId: string, now: number): Promise<string> {
	const token = randomToken();
	await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, now + SESSION_MS).run();
	return token;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
	await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export async function viewerFromToken(db: D1Database, secret: string, token: string | undefined, now: number): Promise<Viewer | null> {
	if (!token) return null;
	const row = await db
		.prepare('SELECT u.id, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
		.bind(await sha256(token), now)
		.first<{ id: string; created_at: number }>();
	if (!row) return null;
	return { userId: row.id, createdAt: row.created_at, pseudo: await pseudonym(secret, row.id) };
}

export async function saveChallenge(db: D1Database, challenge: string, pendingUser: string | null, now: number): Promise<string> {
	const id = randomToken(16);
	await db.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(now).run();
	await db.prepare('INSERT INTO challenges (id, challenge, pending_user, expires_at) VALUES (?, ?, ?, ?)').bind(id, challenge, pendingUser, now + CHALLENGE_MS).run();
	return id;
}

/** 一回きり。取り出したら消す */
export async function takeChallenge(db: D1Database, id: string | undefined, now: number): Promise<{ challenge: string; pendingUser: string | null } | null> {
	if (!id) return null;
	const row = await db.prepare('SELECT challenge, pending_user, expires_at FROM challenges WHERE id = ?').bind(id).first<{ challenge: string; pending_user: string | null; expires_at: number }>();
	await db.prepare('DELETE FROM challenges WHERE id = ?').bind(id).run();
	if (!row || row.expires_at < now) return null;
	return { challenge: row.challenge, pendingUser: row.pending_user };
}

export interface StoredCredential {
	id: string;
	userId: string;
	publicKey: string;
	counter: number;
	transports: string[];
}

export async function addCredential(db: D1Database, c: StoredCredential, now: number): Promise<void> {
	await db
		.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(c.id, c.userId, c.publicKey, c.counter, JSON.stringify(c.transports), now)
		.run();
}

export async function getCredential(db: D1Database, id: string): Promise<StoredCredential | null> {
	const r = await db.prepare('SELECT id, user_id, public_key, counter, transports FROM credentials WHERE id = ?').bind(id).first<{ id: string; user_id: string; public_key: string; counter: number; transports: string }>();
	return r ? { id: r.id, userId: r.user_id, publicKey: r.public_key, counter: r.counter, transports: JSON.parse(r.transports) } : null;
}

export async function setCounter(db: D1Database, id: string, counter: number): Promise<void> {
	await db.prepare('UPDATE credentials SET counter = ? WHERE id = ?').bind(counter, id).run();
}
