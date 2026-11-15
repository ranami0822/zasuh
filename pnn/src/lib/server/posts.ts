import type { D1Database } from '@cloudflare/workers-types';
import type { Viewer } from './auth';

/** 匿名を外すのに要る、いいねの数 */
export const THRESHOLD = 20;
/** これより新しいアカウントのいいねは、閾値に数えない（3日は私の案） */
export const NEW_ACCOUNT_MS = 3 * 24 * 3600 * 1000;
export const LIMITS = { title: 200, body: 20000, reply: 2000, name: 40, bio: 400 };
export const HANDLE = /^[a-z0-9_]{3,20}$/;

export class Problem extends Error {
	constructor(public status: number, message: string) { super(message); }
}

export type Visibility = 'public' | 'limited';

/** 画面に出す投稿。仮名や利用者 ID は、外に出さない（投稿どうしが結びつくため） */
export interface PostView {
	id: string;
	title: string;
	body: string;
	visibility: Visibility;
	createdAt: number;
	updatedAt: number;
	likes: number;
	replies: number;
	/** 名乗っているときだけ */
	author: { handle: string; name: string } | null;
}

interface PostRow {
	id: string; author: string; title: string; body: string; visibility: Visibility; reveal_user: string | null;
	created_at: number; updated_at: number; like_count: number; counted: number; reply_count: number; handle: string | null; name: string | null;
}

const SELECT_POST = `SELECT p.id, p.author, p.title, p.body, p.visibility, p.reveal_user, p.created_at, p.updated_at,
	(SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
	(SELECT COALESCE(SUM(l.counts), 0) FROM likes l WHERE l.post_id = p.id) AS counted,
	(SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id AND r.hidden = 0) AS reply_count,
	u.handle, u.name
	FROM posts p LEFT JOIN users u ON u.id = p.reveal_user`;

export function isRevealed(r: Pick<PostRow, 'reveal_user' | 'counted' | 'handle'>): boolean {
	return !!r.reveal_user && !!r.handle && r.counted >= THRESHOLD;
}

function view(r: PostRow): PostView {
	return {
		id: r.id, title: r.title, body: r.body, visibility: r.visibility, createdAt: r.created_at, updatedAt: r.updated_at,
		likes: r.like_count, replies: r.reply_count,
		author: isRevealed(r) ? { handle: r.handle!, name: r.name || r.handle! } : null
	};
}

function need(v: Viewer | null): Viewer {
	if (!v) throw new Problem(401, 'login required');
	return v;
}

function text(s: unknown, max: number, field: string, allowEmpty = true): string {
	if (typeof s !== 'string') throw new Problem(400, `${field} must be a string`);
	if (s.length > max) throw new Problem(413, `${field} is too long`);
	if (!allowEmpty && s.trim() === '') throw new Problem(400, `${field} is empty`);
	return s;
}

async function postRow(db: D1Database, id: string): Promise<PostRow | null> {
	return db.prepare(`${SELECT_POST} WHERE p.id = ?`).bind(id).first<PostRow>();
}

// ---- 書く人 ----

export async function publishDoc(
	db: D1Database, viewer: Viewer | null, docId: string,
	input: { title: unknown; body: unknown; visibility: unknown; reveal: unknown }, now: number
): Promise<{ id: string }> {
	const v = need(viewer);
	if (!/^[\w-]{8,64}$/.test(docId)) throw new Problem(400, 'bad doc id');
	const title = text(input.title, LIMITS.title, 'title');
	const body = text(input.body, LIMITS.body, 'body');
	if (title.trim() === '' && body.trim() === '') throw new Problem(400, 'empty');
	if (input.visibility !== 'public' && input.visibility !== 'limited') throw new Problem(400, 'bad visibility');
	const reveal = input.reveal === true ? v.userId : null;
	const existing = await db.prepare('SELECT id FROM posts WHERE author = ? AND doc_id = ?').bind(v.pseudo, docId).first<{ id: string }>();
	if (existing) {
		await db.prepare('UPDATE posts SET title = ?, body = ?, visibility = ?, reveal_user = ?, updated_at = ? WHERE id = ?')
			.bind(title, body, input.visibility, reveal, now, existing.id).run();
		return existing;
	}
	const id = crypto.randomUUID();
	await db.prepare('INSERT INTO posts (id, author, doc_id, title, body, visibility, reveal_user, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(id, v.pseudo, docId, title, body, input.visibility, reveal, now, now).run();
	return { id };
}

/** 下書きに戻す: サーバーから消す（いいね・返信・保存も） */
export async function unpublishDoc(db: D1Database, viewer: Viewer | null, docId: string): Promise<void> {
	const v = need(viewer);
	const row = await db.prepare('SELECT id FROM posts WHERE author = ? AND doc_id = ?').bind(v.pseudo, docId).first<{ id: string }>();
	if (!row) return;
	await db.batch([
		db.prepare('DELETE FROM likes WHERE post_id = ?').bind(row.id),
		db.prepare('DELETE FROM saves WHERE post_id = ?').bind(row.id),
		db.prepare('DELETE FROM replies WHERE post_id = ?').bind(row.id),
		db.prepare('DELETE FROM posts WHERE id = ?').bind(row.id)
	]);
}

// ---- 読む ----

export async function feed(db: D1Database, before: number | null, limit = 20): Promise<{ posts: PostView[]; next: number | null }> {
	const rows = (await db.prepare(`${SELECT_POST} WHERE p.visibility = 'public' AND p.created_at < ? ORDER BY p.created_at DESC LIMIT ?`)
		.bind(before ?? Number.MAX_SAFE_INTEGER, limit + 1).all<PostRow>()).results;
	const more = rows.length > limit;
	const page = rows.slice(0, limit);
	return { posts: page.map(view), next: more ? page[page.length - 1].created_at : null };
}

export interface ReplyView { id: string; body: string; createdAt: number; byAuthor: boolean; mine: boolean; hidden: boolean }

export interface PostDetail {
	post: PostView;
	replies: ReplyView[];
	liked: boolean;
	saved: boolean;
	isAuthor: boolean;
	/** 書いた人にだけ: 名乗るトグルと、閾値までの数 */
	own?: { reveal: boolean; counted: number; threshold: number; hasHandle: boolean };
}

export async function getPost(db: D1Database, viewer: Viewer | null, id: string): Promise<PostDetail> {
	const r = await postRow(db, id);
	if (!r) throw new Problem(404, 'not found');
	const isAuthor = !!viewer && viewer.pseudo === r.author;
	const replies = (await db.prepare('SELECT id, author, body, hidden, created_at FROM replies WHERE post_id = ? ORDER BY created_at ASC')
		.bind(id).all<{ id: string; author: string; body: string; hidden: number; created_at: number }>()).results
		.filter((x) => !x.hidden || isAuthor || x.author === viewer?.pseudo)
		.map((x) => ({ id: x.id, body: x.body, createdAt: x.created_at, byAuthor: x.author === r.author, mine: x.author === viewer?.pseudo, hidden: !!x.hidden }));
	let liked = false, saved = false;
	if (viewer) {
		liked = !!(await db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND liker = ?').bind(id, viewer.pseudo).first());
		saved = !!(await db.prepare('SELECT 1 FROM saves WHERE post_id = ? AND owner = ?').bind(id, viewer.pseudo).first());
	}
	const detail: PostDetail = { post: view(r), replies, liked, saved, isAuthor };
	if (isAuthor) {
		const u = await db.prepare('SELECT handle FROM users WHERE id = ?').bind(viewer!.userId).first<{ handle: string | null }>();
		detail.own = { reveal: !!r.reveal_user, counted: r.counted, threshold: THRESHOLD, hasHandle: !!u?.handle };
	}
	return detail;
}

// ---- 反応 ----

export async function like(db: D1Database, viewer: Viewer | null, postId: string, now: number): Promise<void> {
	const v = need(viewer);
	const p = await db.prepare('SELECT author FROM posts WHERE id = ?').bind(postId).first<{ author: string }>();
	if (!p) throw new Problem(404, 'not found');
	if (p.author === v.pseudo) throw new Problem(400, 'cannot like own post');
	const counts = now - v.createdAt >= NEW_ACCOUNT_MS ? 1 : 0;
	await db.prepare('INSERT OR IGNORE INTO likes (post_id, liker, counts, created_at) VALUES (?, ?, ?, ?)').bind(postId, v.pseudo, counts, now).run();
}

export async function unlike(db: D1Database, viewer: Viewer | null, postId: string): Promise<void> {
	const v = need(viewer);
	await db.prepare('DELETE FROM likes WHERE post_id = ? AND liker = ?').bind(postId, v.pseudo).run();
}

export async function save(db: D1Database, viewer: Viewer | null, postId: string, now: number): Promise<void> {
	const v = need(viewer);
	if (!(await db.prepare('SELECT 1 FROM posts WHERE id = ?').bind(postId).first())) throw new Problem(404, 'not found');
	await db.prepare('INSERT OR IGNORE INTO saves (owner, post_id, created_at) VALUES (?, ?, ?)').bind(v.pseudo, postId, now).run();
}

export async function unsave(db: D1Database, viewer: Viewer | null, postId: string): Promise<void> {
	const v = need(viewer);
	await db.prepare('DELETE FROM saves WHERE owner = ? AND post_id = ?').bind(v.pseudo, postId).run();
}

export async function saves(db: D1Database, viewer: Viewer | null): Promise<PostView[]> {
	const v = need(viewer);
	const rows = (await db.prepare(`${SELECT_POST} JOIN saves s ON s.post_id = p.id WHERE s.owner = ? ORDER BY s.created_at DESC`).bind(v.pseudo).all<PostRow>()).results;
	return rows.map(view);
}

export async function reply(db: D1Database, viewer: Viewer | null, postId: string, body: unknown, now: number): Promise<{ id: string }> {
	const v = need(viewer);
	const b = text(body, LIMITS.reply, 'body', false);
	if (!(await db.prepare('SELECT 1 FROM posts WHERE id = ?').bind(postId).first())) throw new Problem(404, 'not found');
	const id = crypto.randomUUID();
	await db.prepare('INSERT INTO replies (id, post_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, postId, v.pseudo, b, now).run();
	return { id };
}

/** 書いた人だけが、返信を隠す／戻す */
export async function hideReply(db: D1Database, viewer: Viewer | null, replyId: string, hidden: boolean): Promise<void> {
	const v = need(viewer);
	const r = await db.prepare('SELECT p.author FROM replies r JOIN posts p ON p.id = r.post_id WHERE r.id = ?').bind(replyId).first<{ author: string }>();
	if (!r) throw new Problem(404, 'not found');
	if (r.author !== v.pseudo) throw new Problem(403, 'only the author can hide replies');
	await db.prepare('UPDATE replies SET hidden = ? WHERE id = ?').bind(hidden ? 1 : 0, replyId).run();
}

// ---- 人 ----

export interface Profile { handle: string; name: string; bio: string; posts: PostView[]; following: boolean; isMe: boolean }

export async function profile(db: D1Database, viewer: Viewer | null, handle: string): Promise<Profile> {
	const u = await db.prepare('SELECT id, handle, name, bio FROM users WHERE handle = ?').bind(handle).first<{ id: string; handle: string; name: string; bio: string }>();
	if (!u) throw new Problem(404, 'not found');
	const rows = (await db.prepare(`${SELECT_POST} WHERE p.reveal_user = ? AND p.visibility = 'public' ORDER BY p.created_at DESC`).bind(u.id).all<PostRow>()).results;
	const following = !!viewer && !!(await db.prepare('SELECT 1 FROM follows WHERE follower = ? AND followee = ?').bind(viewer.userId, u.id).first());
	// 名乗った投稿だけ（閾値を超えたもの）
	return { handle: u.handle, name: u.name || u.handle, bio: u.bio, posts: rows.filter(isRevealed).map(view), following, isMe: viewer?.userId === u.id };
}

export async function follow(db: D1Database, viewer: Viewer | null, handle: string, on: boolean, now: number): Promise<void> {
	const v = need(viewer);
	const u = await db.prepare('SELECT id FROM users WHERE handle = ?').bind(handle).first<{ id: string }>();
	if (!u) throw new Problem(404, 'not found');
	if (u.id === v.userId) throw new Problem(400, 'cannot follow yourself');
	if (on) await db.prepare('INSERT OR IGNORE INTO follows (follower, followee, created_at) VALUES (?, ?, ?)').bind(v.userId, u.id, now).run();
	else await db.prepare('DELETE FROM follows WHERE follower = ? AND followee = ?').bind(v.userId, u.id).run();
}

export interface Me { handle: string | null; name: string; bio: string; followers: number; createdAt: number; posts: PostView[] }

/** フォロワーの数は、本人だけが見る */
export async function me(db: D1Database, viewer: Viewer | null): Promise<Me> {
	const v = need(viewer);
	const u = await db.prepare('SELECT handle, name, bio, created_at FROM users WHERE id = ?').bind(v.userId).first<{ handle: string | null; name: string; bio: string; created_at: number }>();
	if (!u) throw new Problem(401, 'login required');
	const f = await db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee = ?').bind(v.userId).first<{ n: number }>();
	const posts = (await db.prepare(`${SELECT_POST} WHERE p.author = ? ORDER BY p.updated_at DESC`).bind(v.pseudo).all<PostRow>()).results.map(view);
	return { handle: u.handle, name: u.name, bio: u.bio, followers: f?.n ?? 0, createdAt: u.created_at, posts };
}

export async function updateMe(db: D1Database, viewer: Viewer | null, input: { handle?: unknown; name?: unknown; bio?: unknown }): Promise<void> {
	const v = need(viewer);
	if (input.handle !== undefined) {
		if (typeof input.handle !== 'string' || !HANDLE.test(input.handle)) throw new Problem(400, 'handle: 3-20 chars of a-z 0-9 _');
		const taken = await db.prepare('SELECT id FROM users WHERE handle = ? AND id != ?').bind(input.handle, v.userId).first();
		if (taken) throw new Problem(409, 'handle taken');
		await db.prepare('UPDATE users SET handle = ? WHERE id = ?').bind(input.handle, v.userId).run();
	}
	if (input.name !== undefined) await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(text(input.name, LIMITS.name, 'name'), v.userId).run();
	if (input.bio !== undefined) await db.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(text(input.bio, LIMITS.bio, 'bio'), v.userId).run();
}
