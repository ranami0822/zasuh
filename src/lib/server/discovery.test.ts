import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approveWorkCandidate, autoImportPopular, claimDiscoveryDay, discoverCandidates, discoveryDay, fitSummary, openWorkCandidates, rejectWorkCandidate, releaseDiscoveryDay, slugFor } from './discovery';
import type { ListKind, OcGameDetail, OcInfo, OcResult, OpenCriticListing } from './opencritic';
import type { WikipediaClient } from './wikipedia';
import { addWork, createTestDb } from './testing/db';
import { getWork } from './works';

const limit = { requestsRemaining: null, searchesRemaining: null };
const NOW = new Date('2026-11-23T10:00:00.000Z');

const emptyInfo: OcInfo = { description: null, releaseDate: null, platforms: [], genres: [], developers: [], publishers: [], steamId: null };

function listing(
	lists: Partial<Record<ListKind, { id: number; name: string }[]>>,
	error?: 'rate_limited',
	details: Record<number, Omit<Partial<OcGameDetail>, 'info'> & { info?: Partial<OcInfo> }> = {}
): OpenCriticListing & { detailCalls: number[] } {
	const detailCalls: number[] = [];
	return {
		detailCalls,
		async listGames(kind): Promise<OcResult<{ id: number; name: string }[]>> {
			if (error) return { ok: false, error };
			return { ok: true, value: lists[kind] ?? [], limit };
		},
		async gameById(id): Promise<OcResult<OcGameDetail>> {
			detailCalls.push(id);
			const d = details[id];
			const name = d?.name ?? lists.popular?.find((g) => g.id === id)?.name ?? `G${id}`;
			return { ok: true, value: { id, name, type: d?.type === undefined ? 'BASE' : d.type, fields: [], info: { ...emptyInfo, ...d?.info } }, limit };
		}
	};
}

const wikiWith = (titles: Record<string, string>): WikipediaClient => ({
	async findSummary(name) {
		const extract = titles[name];
		return extract ? { title: name, extract, url: `https://ja.wikipedia.org/wiki/${name}` } : null;
	}
});

describe('discovery', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
	});
	afterEach(() => dispose());

	it('一覧の作品を候補にし、Wikipedia の要約を添える。重なりは 1 件', async () => {
		const r = await discoverCandidates({
			db,
			oc: listing({ popular: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }], upcoming: [{ id: 2, name: 'Beta' }] }),
			wiki: wikiWith({ Alpha: 'アルファは、ゲームです。' }),
			now: NOW
		});
		expect(r).toMatchObject({ listed: 2, added: 2, withSummary: 1, error: null, more: false });
		const open = await openWorkCandidates(db);
		expect(open.map((c) => [c.ocId, c.wikiExtract, c.source])).toEqual([[1, 'アルファは、ゲームです。', 'popular'], [2, null, 'popular']]);
	});

	it('作品になっている ID と、候補になった ID（却下も）は、また出さない', async () => {
		const w = await addWork(db, { name: 'Taken' });
		await db.prepare('UPDATE works SET opencritic_id = 10 WHERE id = ?').bind(w).run();
		const oc = listing({ popular: [{ id: 10, name: 'Taken' }, { id: 11, name: 'Fresh' }] });
		await discoverCandidates({ db, oc, wiki: wikiWith({}), now: NOW });
		expect(await rejectWorkCandidate(db, 11)).toBe(true);
		const again = await discoverCandidates({ db, oc, wiki: wikiWith({}), now: NOW });
		expect(again.added).toBe(0);
		expect(await openWorkCandidates(db)).toEqual([]);
	});

	it('上限で止め、残りがあることを返す', async () => {
		const games = [1, 2, 3].map((id) => ({ id, name: `G${id}` }));
		const r = await discoverCandidates({ db, oc: listing({ popular: games }), wiki: wikiWith({}), now: NOW, limit: 2 });
		expect(r).toMatchObject({ added: 2, more: true });
	});

	it('一覧の取得に失敗したら、その理由を返し、何も足さない', async () => {
		const r = await discoverCandidates({ db, oc: listing({}, 'rate_limited'), wiki: wikiWith({}), now: NOW });
		expect(r).toMatchObject({ error: 'rate_limited', added: 0 });
	});

	it('承認すると、作品ができる。OpenCritic の ID と紹介文の出典が付く', async () => {
		await discoverCandidates({ db, oc: listing({ popular: [{ id: 5, name: 'Hades II' }] }), wiki: wikiWith({ 'Hades II': 'ハデスIIは、ゲームです。' }), now: NOW });
		const r = await approveWorkCandidate(db, 5, NOW);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const work = await getWork(db, { id: r.workId });
		expect(work).toMatchObject({
			slug: 'hades-ii',
			name: 'Hades II',
			category: 'game',
			summary: 'ハデスIIは、ゲームです。',
			summarySourceTitle: 'Hades II',
			summarySourceUrl: 'https://ja.wikipedia.org/wiki/Hades II'
		});
		expect(await db.prepare('SELECT opencritic_id AS id FROM works WHERE id = ?').bind(r.workId).first()).toEqual({ id: 5 });
		expect(await openWorkCandidates(db)).toEqual([]);
		expect(await approveWorkCandidate(db, 5, NOW)).toEqual({ ok: false, error: 'not_found' });
	});

	it('要約がない候補は、紹介文も出典もない作品になる。名前に英数字がなければ、URL は oc-ID', async () => {
		await discoverCandidates({ db, oc: listing({ popular: [{ id: 7, name: '日本語だけ' }] }), wiki: wikiWith({}), now: NOW });
		const r = await approveWorkCandidate(db, 7, NOW);
		if (!r.ok) throw new Error('approve failed');
		expect(await getWork(db, { id: r.workId })).toMatchObject({ slug: 'oc-7', summary: null, summarySourceTitle: null, summarySourceUrl: null });
	});

	it('URL 用の名前が使われていたら、ID を付ける', async () => {
		const taken = await addWork(db, { name: 'x' });
		await db.prepare('UPDATE works SET slug = ? WHERE id = ?').bind('alpha', taken).run();
		await discoverCandidates({ db, oc: listing({ popular: [{ id: 9, name: 'Alpha' }] }), wiki: wikiWith({}), now: NOW });
		const r = await approveWorkCandidate(db, 9, NOW);
		if (!r.ok) throw new Error('approve failed');
		expect((await getWork(db, { id: r.workId }))?.slug).toBe('alpha-9');
	});

	it('fitSummary と slugFor', () => {
		expect(fitSummary('あ。' + 'い'.repeat(600))).toBe('あ。');
		expect(fitSummary('い'.repeat(600))).toBe('い'.repeat(499) + '…');
		expect(fitSummary(' 短い。 ')).toBe('短い。');
		expect(slugFor('The Witcher 3: Wild Hunt')).toBe('the-witcher-3-wild-hunt');
		expect(slugFor('日本語')).toBe('');
	});

	it('自動の取り込み: 人気の作品を、承認なしで作品にする。Wikipedia は使わず、作品情報を保存する', async () => {
		const oc = listing(
			{ popular: [{ id: 21, name: 'Alpha Quest' }] },
			undefined,
			{ 21: { info: { description: 'An English description.', genres: ['Action'], developers: ['Dev'], steamId: '123' } } }
		);
		const r = await autoImportPopular({ db, oc, now: NOW });
		expect(r).toMatchObject({ listed: 1, added: 1, skipped: 0, error: null });
		const row = await db.prepare('SELECT id, slug, summary, auto_added AS auto, oc_info AS info, opencritic_id AS oc FROM works WHERE opencritic_id = 21').first<{ id: string; slug: string; summary: string | null; auto: number; info: string; oc: number }>();
		expect(row).toMatchObject({ slug: 'alpha-quest', summary: null, auto: 1, oc: 21 });
		const work = await getWork(db, { id: row!.id });
		expect(work?.ocInfo).toMatchObject({ description: 'An English description.', genres: ['Action'], developers: ['Dev'], steamId: '123' });
		expect(work).toMatchObject({ summarySourceUrl: null, bandFrom: null });
	});

	it('自動の取り込み: 1 回に limit 件まで。続きは、次の日（詳細の呼び出しも、limit 回まで）', async () => {
		const games = [31, 32, 33, 34, 35].map((id) => ({ id, name: `Game ${id}` }));
		const oc = listing({ popular: games });
		const r = await autoImportPopular({ db, oc, now: NOW, limit: 3 });
		expect(r).toMatchObject({ added: 3, more: true });
		expect(oc.detailCalls).toEqual([31, 32, 33]);
		const again = await autoImportPopular({ db, oc, now: NOW, limit: 3 });
		expect(again.added).toBe(2);
	});

	it('自動の取り込み: DLC は作品にせず、却下の候補として覚える（また取らない）。作品・候補になっている ID も飛ばす', async () => {
		const w = await addWork(db, { name: 'Have' });
		await db.prepare('UPDATE works SET opencritic_id = 41 WHERE id = ?').bind(w).run();
		const oc = listing({ popular: [{ id: 41, name: 'Have' }, { id: 42, name: 'Some DLC' }, { id: 43, name: 'Real' }] }, undefined, { 42: { type: 'DLC' } });
		const r = await autoImportPopular({ db, oc, now: NOW });
		expect(r).toMatchObject({ added: 1, skipped: 1 });
		expect(oc.detailCalls).toEqual([42, 43]);
		expect(await db.prepare("SELECT status FROM work_candidates WHERE oc_id = 42").first()).toEqual({ status: 'rejected' });
		const again = listing({ popular: [{ id: 42, name: 'Some DLC' }] });
		expect((await autoImportPopular({ db, oc: again, now: NOW })).added).toBe(0);
		expect(again.detailCalls).toEqual([]);
	});

	it('自動の取り込み: 一覧が取れなければ、その理由を返し、何も作らない', async () => {
		const r = await autoImportPopular({ db, oc: listing({}, 'rate_limited'), now: NOW });
		expect(r).toMatchObject({ error: 'rate_limited', added: 0 });
	});

	it('承認のとき oc を渡すと、作品情報も保存する', async () => {
		await discoverCandidates({ db, oc: listing({ popular: [{ id: 51, name: 'Info Game' }] }), wiki: wikiWith({}), now: NOW });
		const oc = listing({}, undefined, { 51: { info: { genres: ['RPG'] } } });
		const r = await approveWorkCandidate(db, 51, NOW, oc);
		if (!r.ok) throw new Error('approve failed');
		expect((await getWork(db, { id: r.workId }))?.ocInfo?.genres).toEqual(['RPG']);
	});

	it('時間帯と、1 日 1 回の権利', async () => {
		expect(discoveryDay(new Date('2026-11-23T16:10:30Z'))).toBe('2026-11-23');
		expect(discoveryDay(new Date('2026-11-23T16:12:59Z'))).toBe('2026-11-23');
		expect(discoveryDay(new Date('2026-11-23T16:13:00Z'))).toBeNull();
		expect(discoveryDay(new Date('2026-11-23T15:10:00Z'))).toBeNull();
		expect(await claimDiscoveryDay(db, '2026-11-23', NOW)).toBe(true);
		expect(await claimDiscoveryDay(db, '2026-11-23', NOW)).toBe(false);
		await releaseDiscoveryDay(db, '2026-11-23');
		expect(await claimDiscoveryDay(db, '2026-11-23', NOW)).toBe(true);
	});
});
