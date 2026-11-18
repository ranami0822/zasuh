import type { D1Database } from '@cloudflare/workers-types';
import { findReviewer } from './reviews';

export const MESSAGE_KINDS = ['work_request', 'contact', 'dispute'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export const MESSAGE_BODY_MAX = 2000;
export const MESSAGE_BODY_MIN = 5;
export const MESSAGES_PER_DEVICE_PER_DAY = 5;
export const MESSAGES_PER_IP_PER_DAY = 10;
const DAY_MS = 24 * 3_600_000;

export type InboxError =
	| 'bad_kind'
	| 'body_too_short'
	| 'body_too_long'
	| 'contact_too_long'
	| 'bad_name'
	| 'bad_category'
	| 'bad_url'
	| 'device_limit'
	| 'ip_limit'
	| 'not_found';

export interface MessageInput {
	kind: string;
	body: string;
	contact: string;
	workName: string;
	category: string;
	url: string;
	deviceHash: string;
	ipHash: string | null;
}

function validUrl(value: string): boolean {
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

async function ensureSender(db: D1Database, tokenHash: string, now: Date): Promise<string> {
	const existing = await findReviewer(db, tokenHash, now);
	if (existing) return existing;
	await db
		.prepare("INSERT OR IGNORE INTO reviewers (id, kind, token_hash, created_at) VALUES (?, 'anon', ?, ?)")
		.bind(crypto.randomUUID(), tokenHash, now.toISOString())
		.run();
	return (await findReviewer(db, tokenHash, now))!;
}

/** 受信箱に書き込む。種類ごとの項目（追加依頼なら、作品名・分野・リンク）を検証する。 */
export async function sendMessage(db: D1Database, input: MessageInput, now: Date): Promise<{ ok: true } | { ok: false; error: InboxError }> {
	if (!(MESSAGE_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: 'bad_kind' };
	const length = [...input.body.trim()].length;
	if (length < MESSAGE_BODY_MIN) return { ok: false, error: 'body_too_short' };
	if (length > MESSAGE_BODY_MAX) return { ok: false, error: 'body_too_long' };
	if ([...input.contact].length > 200) return { ok: false, error: 'contact_too_long' };

	let workName: string | null = null;
	let category: string | null = null;
	let url: string | null = null;
	if (input.kind === 'work_request') {
		const name = input.workName.trim();
		if (name.length === 0 || [...name].length > 100) return { ok: false, error: 'bad_name' };
		if (!['game', 'software'].includes(input.category)) return { ok: false, error: 'bad_category' };
		if (input.url.trim() && !validUrl(input.url.trim())) return { ok: false, error: 'bad_url' };
		workName = name;
		category = input.category;
		url = input.url.trim() || null;
	}

	const senderId = await ensureSender(db, input.deviceHash, now);
	const since = new Date(now.getTime() - DAY_MS).toISOString();
	const device = await db
		.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND created_at > ?')
		.bind(senderId, since)
		.first<{ n: number }>();
	if ((device?.n ?? 0) >= MESSAGES_PER_DEVICE_PER_DAY) return { ok: false, error: 'device_limit' };
	if (input.ipHash) {
		const ip = await db.prepare('SELECT COUNT(*) AS n FROM messages WHERE ip_day_hash = ?').bind(input.ipHash).first<{ n: number }>();
		if ((ip?.n ?? 0) >= MESSAGES_PER_IP_PER_DAY) return { ok: false, error: 'ip_limit' };
	}
	await db
		.prepare(
			`INSERT INTO messages (id, kind, body, work_name, category, url, contact, sender_id, ip_day_hash, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), input.kind, input.body.trim(), workName, category, url, input.contact.trim() || null, senderId, input.ipHash, now.toISOString())
		.run();
	return { ok: true };
}

export interface InboxItem {
	id: string;
	kind: MessageKind;
	body: string;
	workName: string | null;
	category: string | null;
	url: string | null;
	contact: string | null;
	status: 'open' | 'closed';
	createdAt: string;
}

/** 受信箱の一覧。未対応を先に、新しい順。 */
export async function listMessages(db: D1Database, opts: { kind?: string; limit?: number } = {}): Promise<InboxItem[]> {
	const kind = (MESSAGE_KINDS as readonly string[]).includes(opts.kind ?? '') ? opts.kind : null;
	const { results } = await db
		.prepare(
			`SELECT id, kind, body, work_name AS workName, category, url, contact, status, created_at AS createdAt
			   FROM messages WHERE (? IS NULL OR kind = ?)
			  ORDER BY (status = 'closed'), created_at DESC LIMIT ?`
		)
		.bind(kind, kind, opts.limit ?? 100)
		.all<InboxItem>();
	return results;
}

export async function setMessageStatus(db: D1Database, id: string, status: 'open' | 'closed'): Promise<boolean> {
	const r = await db.prepare('UPDATE messages SET status = ? WHERE id = ?').bind(status, id).run();
	return (r.meta?.changes ?? 0) > 0;
}

export async function openMessageCount(db: D1Database): Promise<number> {
	const row = await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'open'").first<{ n: number }>();
	return row?.n ?? 0;
}
