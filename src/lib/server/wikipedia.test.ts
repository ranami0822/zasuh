import { describe, expect, it } from 'vitest';
import { createWikipediaClient, parseSearchTitle, parseSummary } from './wikipedia';

const summary = { type: 'standard', title: 'OMORI', extract: 'OMORIは、ゲームです。', content_urls: { desktop: { page: 'https://ja.wikipedia.org/wiki/OMORI' } } };

describe('wikipedia', () => {
	it('標準の記事の要約を読む。曖昧さ回避や、欠けたものは null', () => {
		expect(parseSummary(summary)).toEqual({ title: 'OMORI', extract: 'OMORIは、ゲームです。', url: 'https://ja.wikipedia.org/wiki/OMORI' });
		expect(parseSummary({ ...summary, type: 'disambiguation' })).toBeNull();
		expect(parseSummary({ ...summary, extract: ' ' })).toBeNull();
		expect(parseSummary({ ...summary, content_urls: { desktop: { page: 'https://evil.example/x' } } })).toBeNull();
		expect(parseSummary(null)).toBeNull();
	});

	it('検索の最上位の記事名を読む', () => {
		expect(parseSearchTitle({ query: { search: [{ title: 'OMORI' }, { title: 'x' }] } })).toBe('OMORI');
		expect(parseSearchTitle({ query: { search: [] } })).toBeNull();
		expect(parseSearchTitle(undefined)).toBeNull();
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
