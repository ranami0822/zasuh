import { describe, expect, it } from 'vitest';
import { createWikipediaClient, isGameArticle, parseEnPages, parseSearchTitles, parseSummary, titleMatches } from './wikipedia';

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
		expect(urls.every((u) => !u.includes('/page/summary/'))).toBe(true);
	});

	it('英語版の検索の応答を、順位の順に読む。日本語版の記事名つき', () => {
		const pages = [
			{ title: 'Other', index: 2, langlinks: [{ lang: 'ja', title: '別' }] },
			{ title: 'The Legend of Zelda: Ocarina of Time', index: 1, langlinks: [{ lang: 'ja', title: 'ゼルダの伝説 時のオカリナ' }] },
			{ title: 'No link', index: 3 }
		];
		expect(parseEnPages({ query: { pages } }).map((p) => [p.title, p.ja])).toEqual([
			['The Legend of Zelda: Ocarina of Time', 'ゼルダの伝説 時のオカリナ'],
			['Other', '別'],
			['No link', null]
		]);
		expect(parseEnPages(null)).toEqual([]);
	});

	it('英語版の記事から、日本語版の記事の要約を取る（英語名と日本語の記事名が違うとき）', async () => {
		const seen: string[] = [];
		const client = createWikipediaClient({
			fetch: (async (u: string) => {
				seen.push(u);
				if (u.startsWith('https://en.wikipedia.org')) {
					return Response.json({ query: { pages: [{ title: 'The Legend of Zelda: Ocarina of Time', index: 1, langlinks: [{ lang: 'ja', title: 'ゼルダの伝説 時のオカリナ' }] }] } });
				}
				return Response.json({ type: 'standard', title: 'ゼルダの伝説 時のオカリナ', extract: 'ゲームです。', content_urls: { desktop: { page: 'https://ja.wikipedia.org/wiki/x' } } });
			}) as unknown as typeof fetch
		});
		const r = await client.findSummary('The Legend of Zelda: Ocarina of Time');
		expect(r?.title).toBe('ゼルダの伝説 時のオカリナ');
		expect(seen).toHaveLength(2);
		expect(seen[1]).toContain(encodeURIComponent('ゼルダの伝説 時のオカリナ'));
	});

	it('検索してから要約を取る。失敗は null（例外にしない）', async () => {
		const urls: string[] = [];
		const ok = createWikipediaClient({
			fetch: (async (u: string) => {
				urls.push(u);
				if (u.startsWith('https://en.wikipedia.org')) return Response.json({ query: {} });
				return Response.json(u.includes('/w/api.php') ? { query: { search: [{ title: 'OMORI' }] } } : summary);
			}) as unknown as typeof fetch
		});
		expect((await ok.findSummary('OMORI'))?.title).toBe('OMORI');
		expect(urls[2]).toContain('/page/summary/OMORI');
		const down = createWikipediaClient({ fetch: (async () => { throw new Error('x'); }) as unknown as typeof fetch });
		expect(await down.findSummary('OMORI')).toBeNull();
		expect(await ok.findSummary('  ')).toBeNull();
	});
});
