import { describe, expect, it } from 'vitest';
import { createWikipediaClient, isGameArticle, parseSearchTitles, parseSummary, titleMatches } from './wikipedia';

const summary = { type: 'standard', title: 'OMORI', extract: 'OMORIは、ゲームです。', content_urls: { desktop: { page: 'https://ja.wikipedia.org/wiki/OMORI' } } };

describe('wikipedia', () => {
	it('標準の記事の要約を読む。曖昧さ回避や、欠けたものは null', () => {
		expect(parseSummary(summary)).toEqual({ title: 'OMORI', extract: 'OMORIは、ゲームです。', url: 'https://ja.wikipedia.org/wiki/OMORI' });
		expect(parseSummary({ ...summary, type: 'disambiguation' })).toBeNull();
		expect(parseSummary({ ...summary, extract: ' ' })).toBeNull();
		expect(parseSummary({ ...summary, content_urls: { desktop: { page: 'https://evil.example/x' } } })).toBeNull();
		expect(parseSummary(null)).toBeNull();
	});

	it('検索の上位の記事名を、5 件まで読む', () => {
		expect(parseSearchTitles({ query: { search: ['a', 'b', 'c', 'd', 'e', 'f'].map((title) => ({ title })) } })).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(parseSearchTitles({ query: { search: [] } })).toEqual([]);
		expect(parseSearchTitles(undefined)).toEqual([]);
	});

	it('記事名が作品名と合うか（全文検索の別の記事を、はじく）', () => {
		expect(titleMatches('ELDEN RING', 'Elden Ring')).toBe(true);
		expect(titleMatches('Hollow Knight: Silksong', 'Silksong')).toBe(true);
		expect(titleMatches('セーブ (コンピュータ)', 'Silksong')).toBe(false);
		expect(titleMatches('Hollow Knight', 'Silksong')).toBe(false);
		expect(titleMatches('Hollow Knight', 'Hollow Knight: Silksong')).toBe(false);
		expect(titleMatches('ゲーム', 'ゲーム')).toBe(true);
		expect(titleMatches('ゲーム・オブ・ザ・イヤー', 'ゲー')).toBe(false);
		expect(isGameArticle('は、ゲームです。')).toBe(true);
		expect(isGameArticle('は、映画です。')).toBe(false);
	});

	it('名前の合う記事がなければ、null（要約も取らない）', async () => {
		const urls: string[] = [];
		const client = createWikipediaClient({
			fetch: (async (u: string) => {
				urls.push(u);
				return Response.json({ query: { search: [{ title: 'セーブ (コンピュータ)' }] } });
			}) as unknown as typeof fetch
		});
		expect(await client.findSummary('Silksong')).toBeNull();
		expect(urls).toHaveLength(1);
	});

	it('検索してから要約を取る。失敗は null（例外にしない）', async () => {
		const urls: string[] = [];
		const ok = createWikipediaClient({
			fetch: (async (u: string) => {
				urls.push(u);
				return Response.json(u.includes('/w/api.php') ? { query: { search: [{ title: 'OMORI' }] } } : summary);
			}) as unknown as typeof fetch
		});
		expect((await ok.findSummary('OMORI'))?.title).toBe('OMORI');
		expect(urls[1]).toContain('/page/summary/OMORI');
		const down = createWikipediaClient({ fetch: (async () => { throw new Error('x'); }) as unknown as typeof fetch });
		expect(await down.findSummary('OMORI')).toBeNull();
		expect(await ok.findSummary('  ')).toBeNull();
	});
});
