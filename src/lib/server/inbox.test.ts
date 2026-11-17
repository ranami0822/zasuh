import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listMessages, MESSAGES_PER_DEVICE_PER_DAY, openMessageCount, sendMessage, setMessageStatus, type MessageInput } from './inbox';
import { deviceTokenHash, ipDayHash } from './reviews';
import { createClock, createTestDb } from './testing/db';

describe('受信箱', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock('2026-11-17T03:00:00.000Z');
	});
	afterEach(() => dispose());

	const input = async (over: Partial<MessageInput> = {}): Promise<MessageInput> => ({
		kind: 'contact',
		body: '不具合の報告です。通報の画面が開きません。',
		contact: '',
		workName: '',
		category: '',
		url: '',
		deviceHash: await deviceTokenHash('a'),
		ipHash: null,
		...over
	});
	const send = async (over: Partial<MessageInput> = {}) => sendMessage(db, await input(over), clock.now());

	it('お問い合わせを保存する。連絡先は、書いたときだけ保存する', async () => {
		expect(await send()).toEqual({ ok: true });
		clock.advance(1000);
		expect(await send({ kind: 'dispute', contact: ' maker@example.com ', deviceHash: await deviceTokenHash('b') })).toEqual({ ok: true });
		const items = await listMessages(db);
		expect(items.map((i) => [i.kind, i.contact, i.status])).toEqual([
			['dispute', 'maker@example.com', 'open'],
			['contact', null, 'open']
		]);
	});

	it('作品の追加依頼は、作品名・分野・リンクを検証して、保存する。ほかの種類では、これらを保存しない', async () => {
		expect(await send({ kind: 'work_request', workName: '', category: 'game' })).toEqual({ ok: false, error: 'bad_name' });
		expect(await send({ kind: 'work_request', workName: '星屑の鉄道', category: 'music' })).toEqual({ ok: false, error: 'bad_category' });
		expect(await send({ kind: 'work_request', workName: '星屑の鉄道', category: 'game', url: 'javascript:alert(1)' })).toEqual({ ok: false, error: 'bad_url' });
		expect(await send({ kind: 'work_request', workName: '星屑の鉄道', category: 'game', url: 'https://example.com/' })).toEqual({ ok: true });
		expect(await send({ kind: 'contact', workName: '無視される', category: 'game', url: 'https://example.com/' })).toEqual({ ok: true });
		const items = await listMessages(db);
		expect(items.find((i) => i.kind === 'work_request')).toMatchObject({ workName: '星屑の鉄道', category: 'game', url: 'https://example.com/' });
		expect(items.find((i) => i.kind === 'contact')).toMatchObject({ workName: null, category: null, url: null });
	});

	it('入力を検証する: 種類、短すぎる、長すぎる、連絡先', async () => {
		expect(await send({ kind: 'spam' })).toEqual({ ok: false, error: 'bad_kind' });
		expect(await send({ body: 'あ' })).toEqual({ ok: false, error: 'body_too_short' });
		expect(await send({ body: 'あ'.repeat(2001) })).toEqual({ ok: false, error: 'body_too_long' });
		expect(await send({ contact: 'あ'.repeat(201) })).toEqual({ ok: false, error: 'contact_too_long' });
		expect(await listMessages(db)).toEqual([]);
	});

	it('端末ごとの上限と、送信元ごとの上限。24時間たつと、また送れる', async () => {
		for (let i = 0; i < MESSAGES_PER_DEVICE_PER_DAY; i++) expect(await send()).toEqual({ ok: true });
		expect(await send()).toEqual({ ok: false, error: 'device_limit' });
		clock.advance(24 * 3_600_000);
		expect(await send()).toEqual({ ok: true });

		const ip = await ipDayHash('198.51.100.9', 'secret', clock.now());
		for (let i = 0; i < 10; i++) expect(await send({ deviceHash: await deviceTokenHash(`d${i}`), ipHash: ip })).toEqual({ ok: true });
		expect(await send({ deviceHash: await deviceTokenHash('d10'), ipHash: ip })).toEqual({ ok: false, error: 'ip_limit' });
	});

	it('種類で絞れる。済みにすると、未対応の数が減り、一覧の後ろに回る。戻せる', async () => {
		await send();
		clock.advance(1000);
		await send({ kind: 'dispute', deviceHash: await deviceTokenHash('b') });
		const [first, second] = await listMessages(db);
		expect([first.kind, second.kind]).toEqual(['dispute', 'contact']);
		expect(await listMessages(db, { kind: 'contact' })).toHaveLength(1);
		expect(await listMessages(db, { kind: 'bogus' })).toHaveLength(2);
		expect(await openMessageCount(db)).toBe(2);
		expect(await setMessageStatus(db, first.id, 'closed')).toBe(true);
		expect(await openMessageCount(db)).toBe(1);
		expect((await listMessages(db)).map((i) => i.status)).toEqual(['open', 'closed']);
		expect(await setMessageStatus(db, first.id, 'open')).toBe(true);
		expect(await setMessageStatus(db, 'missing', 'closed')).toBe(false);
	});
});
