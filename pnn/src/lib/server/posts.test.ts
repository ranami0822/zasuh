import type { D1Database } from '@cloudflare/workers-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, createUser, deleteSession, viewerFromToken, type Viewer } from './auth';
import { pseudonym } from './crypto';
import {
	feed, follow, getPost, hideReply, like, me, NEW_ACCOUNT_MS, profile, publishDoc, reply, save, saves, THRESHOLD,
	unlike, unpublishDoc, updateMe, Problem
} from './posts';
import { createTestDb } from './testing/db';

const SECRET = 'test-secret';
const DAY = 24 * 3600 * 1000;
let db: D1Database;
let dispose: () => Promise<void>;
let n = 0;

beforeAll(async () => { ({ db, dispose } = await createTestDb()); });
afterAll(async () => { await dispose(); });

async function person(createdAt = 0): Promise<Viewer> {
	const id = `u${++n}`;
	await createUser(db, id, createdAt);
	return { userId: id, createdAt, pseudo: await pseudonym(SECRET, id) };
}
const doc = (t = '題', b = '本文') => ({ title: t, body: b, visibility: 'public', reveal: false });
const later = 10 * DAY;

describe('仮名とセッション', () => {
	it('仮名は、同じ人なら同じで、別の人とは違う', async () => {
		expect(await pseudonym(SECRET, 'a')).toBe(await pseudonym(SECRET, 'a'));
		expect(await pseudonym(SECRET, 'a')).not.toBe(await pseudonym(SECRET, 'b'));
		expect(await pseudonym(SECRET, 'a', 'novel')).not.toBe(await pseudonym(SECRET, 'a'));
	});
	it('セッションで、仮名つきの閲覧者になり、消すと戻らない', async () => {
		const p = await person(5);
		const token = await createSession(db, p.userId, 10);
		const v = await viewerFromToken(db, SECRET, token, 11);
		expect(v).toEqual(p);
		await deleteSession(db, token);
		expect(await viewerFromToken(db, SECRET, token, 12)).toBeNull();
	});
});

describe('公開', () => {
	it('公開すると、フィードに出る。同じ文書は更新になる', async () => {
		const a = await person();
		const { id } = await publishDoc(db, a, 'doc-aaaa-1', doc('一'), 100);
		const again = await publishDoc(db, a, 'doc-aaaa-1', doc('二'), 200);
		expect(again.id).toBe(id);
		const f = await feed(db, null);
		const p = f.posts.find((x) => x.id === id)!;
		expect(p.title).toBe('二');
		expect(p.author).toBeNull();
	});
	it('限定は、フィードに出ないが、ID で読める', async () => {
		const a = await person();
		const { id } = await publishDoc(db, a, 'doc-limited', { ...doc(), visibility: 'limited' }, 300);
		expect((await feed(db, null)).posts.some((x) => x.id === id)).toBe(false);
		expect((await getPost(db, null, id)).post.id).toBe(id);
	});
	it('下書きに戻すと、消える', async () => {
		const a = await person();
		const { id } = await publishDoc(db, a, 'doc-gone-1', doc(), 400);
		await unpublishDoc(db, a, 'doc-gone-1');
		await expect(getPost(db, null, id)).rejects.toThrow(Problem);
	});
	it('ログインなしでは、公開できない。空や長すぎるものは拒む', async () => {
		await expect(publishDoc(db, null, 'doc-x-1234', doc(), 1)).rejects.toMatchObject({ status: 401 });
		const a = await person();
		await expect(publishDoc(db, a, 'doc-x-1234', doc('', ' '), 1)).rejects.toMatchObject({ status: 400 });
		await expect(publishDoc(db, a, 'doc-x-1234', doc('あ'.repeat(201)), 1)).rejects.toMatchObject({ status: 413 });
	});
	it('画面に出す形に、仮名と利用者 ID が入らない', async () => {
		const a = await person();
		const { id } = await publishDoc(db, a, 'doc-leak-1', { ...doc(), reveal: true }, 500);
		const json = JSON.stringify([await getPost(db, null, id), await feed(db, null)]);
		expect(json).not.toContain(a.pseudo);
		expect(json).not.toContain(`"${a.userId}"`);
	});
});

describe('いいねと、匿名を外す仕組み', () => {
	it('自分の投稿には、いいねできない。1人1回', async () => {
		const a = await person(); const b = await person();
		const { id } = await publishDoc(db, a, 'doc-like-1', doc(), 1);
		await expect(like(db, a, id, later)).rejects.toMatchObject({ status: 400 });
		await like(db, b, id, later); await like(db, b, id, later);
		expect((await getPost(db, null, id)).post.likes).toBe(1);
		await unlike(db, b, id);
		expect((await getPost(db, null, id)).post.likes).toBe(0);
	});

	it('閾値を超え、トグルが入っていて、名前（handle）があるときだけ名乗る。トグルを切ると戻る', async () => {
		const a = await person();
		await updateMe(db, a, { handle: 'writer_a', name: 'エー' });
		const { id } = await publishDoc(db, a, 'doc-reveal-1', { ...doc(), reveal: true }, 1);
		const fans: Viewer[] = [];
		for (let i = 0; i < THRESHOLD; i++) fans.push(await person(0));
		for (const f of fans.slice(0, THRESHOLD - 1)) await like(db, f, id, later);
		expect((await getPost(db, null, id)).post.author).toBeNull();
		await like(db, fans[THRESHOLD - 1], id, later);
		expect((await getPost(db, null, id)).post.author).toEqual({ handle: 'writer_a', name: 'エー' });
		expect((await profile(db, null, 'writer_a')).posts.map((p) => p.id)).toContain(id);
		// 匿名に戻す
		await publishDoc(db, a, 'doc-reveal-1', { ...doc(), reveal: false }, 2);
		expect((await getPost(db, null, id)).post.author).toBeNull();
		expect((await profile(db, null, 'writer_a')).posts.map((p) => p.id)).not.toContain(id);
	});

	it('新しいアカウントのいいねは、数には出るが、閾値に数えない', async () => {
		const a = await person();
		await updateMe(db, a, { handle: 'writer_b' });
		const { id } = await publishDoc(db, a, 'doc-new-acc', { ...doc(), reveal: true }, 1);
		const now = 100 * DAY;
		for (let i = 0; i < THRESHOLD; i++) await like(db, await person(now - NEW_ACCOUNT_MS + DAY), id, now);
		const d = await getPost(db, null, id);
		expect(d.post.likes).toBe(THRESHOLD);
		expect(d.post.author).toBeNull();
		expect((await getPost(db, a, id)).own).toMatchObject({ counted: 0, threshold: THRESHOLD, reveal: true });
	});

	it('トグルが切れていれば、閾値を超えても名乗らない', async () => {
		const a = await person();
		await updateMe(db, a, { handle: 'writer_c' });
		const { id } = await publishDoc(db, a, 'doc-noreveal', doc(), 1);
		for (let i = 0; i < THRESHOLD; i++) await like(db, await person(0), id, later);
		expect((await getPost(db, null, id)).post.author).toBeNull();
	});
});

describe('返信と保存', () => {
	it('返信は双方向。書いた人の返信には印が付く', async () => {
		const a = await person(); const b = await person();
		const { id } = await publishDoc(db, a, 'doc-reply-1', doc(), 1);
		await reply(db, b, id, 'わかる', 2);
		await reply(db, a, id, 'ありがとう', 3);
		const r = (await getPost(db, null, id)).replies;
		expect(r.map((x) => [x.body, x.byAuthor])).toEqual([['わかる', false], ['ありがとう', true]]);
	});
	it('書いた人だけが、返信を隠せる。隠した返信は、他の人には見えない', async () => {
		const a = await person(); const b = await person(); const c = await person();
		const { id } = await publishDoc(db, a, 'doc-hide-1', doc(), 1);
		const { id: rid } = await reply(db, b, id, 'いやなこと', 2);
		await expect(hideReply(db, b, rid, true)).rejects.toMatchObject({ status: 403 });
		await hideReply(db, a, rid, true);
		expect((await getPost(db, c, id)).replies).toHaveLength(0);
		expect((await getPost(db, a, id)).replies[0].hidden).toBe(true);
		expect((await getPost(db, null, id)).post.replies).toBe(0);
	});
	it('保存は、自分の一覧に出る', async () => {
		const a = await person(); const b = await person();
		const { id } = await publishDoc(db, a, 'doc-save-1', doc(), 1);
		await save(db, b, id, 2);
		expect((await saves(db, b)).map((p) => p.id)).toEqual([id]);
		expect((await getPost(db, b, id)).saved).toBe(true);
	});
	it('空の返信は拒む', async () => {
		const a = await person();
		const { id } = await publishDoc(db, a, 'doc-empty-r', doc(), 1);
		await expect(reply(db, a, id, '  ', 2)).rejects.toMatchObject({ status: 400 });
	});
});

describe('人', () => {
	it('フォロワーの数は、本人の me にだけ出る', async () => {
		const a = await person(); const b = await person();
		await updateMe(db, a, { handle: 'writer_d' });
		await follow(db, b, 'writer_d', true, 1);
		expect((await me(db, a)).followers).toBe(1);
		const p = await profile(db, b, 'writer_d');
		expect(p.following).toBe(true);
		expect(JSON.stringify(p)).not.toContain('followers');
		await expect(follow(db, a, 'writer_d', true, 1)).rejects.toMatchObject({ status: 400 });
	});
	it('handle は形が決まっていて、重複できない', async () => {
		const a = await person(); const b = await person();
		await updateMe(db, a, { handle: 'same_name' });
		await expect(updateMe(db, b, { handle: 'same_name' })).rejects.toMatchObject({ status: 409 });
		await expect(updateMe(db, b, { handle: 'NO SPACE' })).rejects.toMatchObject({ status: 400 });
	});
});
