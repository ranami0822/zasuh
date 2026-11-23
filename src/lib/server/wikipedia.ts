/**
 * 日本語版 Wikipedia の要約の取得（docs/mvp-design.md の 25 章）。D1 を知らない。
 * 記事は、①英語版の検索で、作品名に合う記事を見つけ、その日本語版の記事（langlinks）をたどる。なければ、②日本語版の検索（list=search。本文の全文検索）の上位 5 件のうち、記事名が作品名と合い、要約にゲームの語があるもの（titleMatches、isGameArticle）。合うものがなければ、取らない（別の記事を出すより、空のほうがよい）。要約は、REST API の page/summary。
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
const EN_HOST = 'https://en.wikipedia.org';

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

/** 検索の応答から、記事名（上位から、最大 5 件）。 */
export function parseSearchTitles(json: unknown): string[] {
	const hits = (json as { query?: { search?: unknown } } | null)?.query?.search;
	if (!Array.isArray(hits)) return [];
	const out: string[] = [];
	for (const h of hits.slice(0, 5)) {
		const title = (h as { title?: unknown } | null)?.title;
		if (typeof title === 'string' && title.trim() !== '') out.push(title.trim());
	}
	return out;
}

/** 英語版の検索の 1 件。ja は、日本語版の記事名（なければ null）。 */
export interface EnPage {
	title: string;
	index: number;
	ja: string | null;
}

/**
 * 英語版の検索（generator=search、prop=langlinks、formatversion=2）の応答を読む。順位（index）の順に返す。
 * langlinks の記事名は、formatversion=2 では title。古い形の '*' も読む。
 * 形は、公式の資料と記憶によるもので、実際の応答では未確認（docs/mvp-design.md の 25.6）。
 */
export function parseEnPages(json: unknown): EnPage[] {
	const pages = (json as { query?: { pages?: unknown } } | null)?.query?.pages;
	if (!Array.isArray(pages)) return [];
	const out: EnPage[] = [];
	for (const p of pages) {
		const o = p as { title?: unknown; index?: unknown; langlinks?: unknown } | null;
		if (typeof o?.title !== 'string' || o.title.trim() === '') continue;
		let ja: string | null = null;
		if (Array.isArray(o.langlinks)) {
			const link = o.langlinks.find((l) => (l as { lang?: unknown } | null)?.lang === 'ja') as { title?: unknown; '*'?: unknown } | undefined;
			const t = link?.title ?? link?.['*'];
			if (typeof t === 'string' && t.trim() !== '') ja = t.trim();
		}
		out.push({ title: o.title.trim(), index: typeof o.index === 'number' ? o.index : 99, ja });
	}
	return out.sort((a, b) => a.index - b.index);
}

/** 大文字小文字、全角半角、空白、記号を無視した形（文字と数字だけ残す）。 */
function normalize(text: string): string {
	return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * 記事名が、探している作品の名前と合うか。記事名が作品名と同じか、作品名を含むこと（「Hollow Knight: Silksong」は「Silksong」に合う）。
 * 逆（作品名が記事名を含む）は、合うとしない。続編が、元の作品の記事に当たってしまうため（「Hollow Knight: Silksong」で「Hollow Knight」）。
 * 検索は、題名ではなく本文の全文検索なので、最上位が別の記事のことが多い（実際に、「Silksong」で「セーブ (コンピュータ)」が最上位だった）。
 * 短すぎる名前（2 文字以下）は、含まれやすいので、合うとしない。
 */
export function titleMatches(title: string, name: string): boolean {
	const t = normalize(title);
	const n = normalize(name);
	if (t.length < 3 || n.length < 3) return t === n && t.length > 0;
	return t.includes(n);
}

/** ゲームの記事か（要約に、ゲームの語がある）。同名の映画や小説に当たらないための確認。 */
export function isGameArticle(extract: string): boolean {
	return /ゲーム|game/i.test(extract);
}

/** 要約を確かめる記事の数の上限（通信数を抑える）。 */
const MAX_SUMMARY_FETCHES = 2;

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
			// 1. 英語版で、作品名に合う記事を探し、その日本語版の記事名をたどる（作品名は英語のことが多く、日本語版の記事名は、カタカナなどで違うため）。
			const en = await getJson(
				`${EN_HOST}/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=5&prop=langlinks&lllang=ja&lllimit=5&format=json&formatversion=2&origin=*`
			);
			const linked = parseEnPages(en).find((p) => p.ja !== null && titleMatches(p.title, q));
			if (linked?.ja) {
				const summary = parseSummary(await getJson(`${HOST}/api/rest_v1/page/summary/${encodeURIComponent(linked.ja)}`));
				if (summary && isGameArticle(summary.extract)) return summary;
			}
			// 2. 日本語版を、直接探す（英語版に記事がない、または日本語版への結びつきがないとき）。
			const found = await getJson(`${HOST}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json&origin=*`);
			const titles = parseSearchTitles(found).filter((t) => titleMatches(t, q)).slice(0, MAX_SUMMARY_FETCHES);
			for (const title of titles) {
				const summary = parseSummary(await getJson(`${HOST}/api/rest_v1/page/summary/${encodeURIComponent(title)}`));
				if (summary && isGameArticle(summary.extract)) return summary;
			}
			return null;
		}
	};
}
