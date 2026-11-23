/**
 * 日本語版 Wikipedia の要約の取得（docs/mvp-design.md の 25 章）。D1 を知らない。
 * 記事は、検索（MediaWiki Action API の list=search）の最上位の 1 件。要約は、REST API の page/summary。
 * 取れた文は、作品の紹介文の案になる。そのまま使うので、出典（記事名と URL）と許諾（CC BY-SA）を、画面に出す。
 * 候補は、運営者が承認する前に、記事名と文を見る（別の記事に当たることがある）。
 */

export interface WikiSummary {
	title: string;
	extract: string;
	/** 記事の URL（https://ja.wikipedia.org/wiki/...）。 */
	url: string;
}

export interface WikipediaClient {
	/** 見つからない、取れない、曖昧さ回避のページは null。例外にしない。 */
	findSummary(name: string): Promise<WikiSummary | null>;
}

const HOST = 'https://ja.wikipedia.org';

/** 要約の応答を読む。標準の記事（type: standard）で、題・文・URL が揃うものだけ。 */
export function parseSummary(json: unknown): WikiSummary | null {
	if (typeof json !== 'object' || json === null) return null;
	const o = json as Record<string, unknown>;
	if (o.type !== 'standard') return null;
	const title = typeof o.title === 'string' ? o.title.trim() : '';
	const extract = typeof o.extract === 'string' ? o.extract.trim() : '';
	const urls = o.content_urls as { desktop?: { page?: unknown } } | undefined;
	const url = typeof urls?.desktop?.page === 'string' ? urls.desktop.page : '';
	if (title === '' || extract === '' || !url.startsWith(`${HOST}/`)) return null;
	return { title, extract, url };
}

/** 検索の応答から、最上位の記事名。なければ null。 */
export function parseSearchTitle(json: unknown): string | null {
	const hits = (json as { query?: { search?: unknown } } | null)?.query?.search;
	if (!Array.isArray(hits) || hits.length === 0) return null;
	const title = (hits[0] as { title?: unknown } | null)?.title;
	return typeof title === 'string' && title.trim() !== '' ? title.trim() : null;
}

export function createWikipediaClient(opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): WikipediaClient {
	const doFetch = opts.fetch ?? fetch;
	const timeoutMs = opts.timeoutMs ?? 10_000;
	// Wikimedia は、User-Agent で、自動の利用を見分ける。連絡先は入れない（運営者の情報を、外へ出さないため）。
	const headers = { 'user-agent': 'ZasuhBot/1.0 (game review site; reads article summaries)', accept: 'application/json' };

	async function getJson(url: string): Promise<unknown> {
		try {
			const res = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
			return res.ok ? await res.json() : null;
		} catch {
			return null;
		}
	}

	return {
		async findSummary(name) {
			const q = name.trim();
			if (q === '') return null;
			const found = await getJson(`${HOST}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json&origin=*`);
			const title = parseSearchTitle(found);
			if (!title) return null;
			return parseSummary(await getJson(`${HOST}/api/rest_v1/page/summary/${encodeURIComponent(title)}`));
		}
	};
}
