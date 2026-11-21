/**
 * OpenCritic の API（RapidAPI）の呼び出しと、応答の解析。D1 を知らない（保存は critics.ts）。
 * 設計は docs/critics-plan.md の 1.2。抜粋（CriticSnippet.text）は、メモリ上だけで扱い、保存しない。
 */

/** メモリ上だけで扱う。保存しない。点数・題名・著者は、持たない。 */
export interface CriticSnippet {
	/** 応答の _id。 */
	ocReviewId: string;
	/** snippet（空でないもの。前後の空白は外す）。 */
	text: string;
	/** Outlet.name（空なら、取り込まない）。 */
	outlet: string;
	/** externalUrl（http / https のみ）。 */
	url: string;
	/** publishedDate の日付部分（YYYY-MM-DD）。読めなければ null。 */
	publishedOn: string | null;
}

export interface OcGame {
	id: number;
	name: string;
	dist: number;
}

/** 応答ヘッダー x-ratelimit-requests-remaining と x-ratelimit-searches-remaining。なければ null。 */
export interface OcRateLimit {
	requestsRemaining: number | null;
	searchesRemaining: number | null;
}

export type OcError = 'unauthorized' | 'rate_limited' | 'bad_response' | 'network';
export type OcResult<T> = { ok: true; value: T; limit: OcRateLimit } | { ok: false; error: OcError };

/** 環境変数のキーを、使える形にする。前後の空白と引用符（' と "）を外す。空なら null。 */
export function normalizeKey(raw: string | undefined): string | null {
	const key = (raw ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
	return key === '' ? null : key;
}

/**
 * レビュー一覧の応答（配列）を、取り込める抜粋に直す。純粋な関数。
 * 形の悪い要素（_id・snippet・Outlet.name・externalUrl がない、url が http/https でない）は、捨てる。
 * language があって 'en' で始まらないものは捨てる（ない場合は、英語として扱う。実際の値は 'en-us'）。
 * 配列でなければ []。
 */
export function parseReviews(json: unknown): CriticSnippet[] {
	if (!Array.isArray(json)) return [];
	const out: CriticSnippet[] = [];
	for (const item of json) {
		const snippet = toSnippet(item);
		if (snippet) out.push(snippet);
	}
	return out;
}

/** 検索の応答（配列）を、作品の候補に直す。純粋な関数。id（整数）・name（文字列）・dist（数）が揃わない要素は捨てる。配列でなければ []。 */
export function parseSearch(json: unknown): OcGame[] {
	if (!Array.isArray(json)) return [];
	const out: OcGame[] = [];
	for (const item of json) {
		if (typeof item !== 'object' || item === null) continue;
		const { id, name, dist } = item as Record<string, unknown>;
		if (typeof id === 'number' && Number.isInteger(id) && typeof name === 'string' && typeof dist === 'number' && Number.isFinite(dist)) {
			out.push({ id, name, dist });
		}
	}
	return out;
}

/** レビュー一件を抜粋に直す。形が悪ければ null。 */
function toSnippet(item: unknown): CriticSnippet | null {
	if (typeof item !== 'object' || item === null) return null;
	const o = item as Record<string, unknown>;
	const id = typeof o._id === 'string' ? o._id : '';
	const text = typeof o.snippet === 'string' ? o.snippet.trim() : '';
	const outletObj = typeof o.Outlet === 'object' && o.Outlet !== null ? (o.Outlet as Record<string, unknown>) : null;
	const outlet = typeof outletObj?.name === 'string' ? outletObj.name.trim() : '';
	const url = typeof o.externalUrl === 'string' ? o.externalUrl.trim() : '';
	if (id === '' || text === '' || outlet === '' || !isHttpUrl(url)) return null;
	if (!isEnglish(o.language)) return null;
	return { ocReviewId: id, text, outlet, url, publishedOn: toDateOnly(o.publishedDate) };
}

function isHttpUrl(url: string): boolean {
	try {
		const protocol = new URL(url).protocol;
		return protocol === 'https:' || protocol === 'http:';
	} catch {
		return false;
	}
}

/** language がないものは英語として扱う。あるものは 'en' で始まるものだけ。 */
function isEnglish(language: unknown): boolean {
	if (language === undefined || language === null) return true;
	return typeof language === 'string' && language.toLowerCase().startsWith('en');
}

function toDateOnly(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const time = Date.parse(value);
	if (Number.isNaN(time)) return null;
	return new Date(time).toISOString().slice(0, 10);
}

function readNumber(value: string | null): number | null {
	if (value === null || value.trim() === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function isAbortError(e: unknown): boolean {
	return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

/**
 * まだ呼んでよいか。kind が 'request' なら requestsRemaining、'search' なら searchesRemaining が、reserve を超えているとき true。
 * 残りが null（ヘッダーがなかった）なら true（呼び出し側の回数の上限で止める）。
 */
export function hasBudget(limit: OcRateLimit, kind: 'request' | 'search', reserve: number): boolean {
	const remaining = kind === 'request' ? limit.requestsRemaining : limit.searchesRemaining;
	return remaining === null || remaining > reserve;
}

export interface OpenCriticClient {
	searchGame(name: string): Promise<OcResult<OcGame[]>>;
	/** rawCount は、応答の配列の、解析で捨てる前の件数（最後のページかの判断に使う）。 */
	reviewsOfGame(ocId: number, skip: number): Promise<OcResult<{ snippets: CriticSnippet[]; rawCount: number }>>;
}

/**
 * API のクライアント。ホストは opencritic-api.p.rapidapi.com、ヘッダーは x-rapidapi-host と x-rapidapi-key。
 * 検索: GET /game/search?criteria=<名前>。レビュー: GET /review/game/<id>?skip=<n>。
 * 失敗は、例外にせず、OcResult で返す（docs/standards.md の 1）:
 *   401、または 403 で本文に 'not subscribed' を含む → 'unauthorized'
 *   429、またはそのほかの 403 → 'rate_limited'
 *   fetch の失敗・時間切れ、5xx → 'network'
 *   200 で、JSON として読めない、または配列でない → 'bad_response'
 */
export function createOpenCriticClient(opts: { key: string; fetch?: typeof fetch; timeoutMs?: number }): OpenCriticClient {
	const base = 'https://opencritic-api.p.rapidapi.com';
	const doFetch = opts.fetch ?? fetch;
	const timeoutMs = opts.timeoutMs ?? 15_000;
	const headers = { 'x-rapidapi-host': 'opencritic-api.p.rapidapi.com', 'x-rapidapi-key': opts.key };

	async function get(path: string): Promise<OcResult<unknown>> {
		let res: Response;
		try {
			res = await doFetch(base + path, { headers, signal: AbortSignal.timeout(timeoutMs) });
		} catch {
			return { ok: false, error: 'network' };
		}
		const limit: OcRateLimit = {
			requestsRemaining: readNumber(res.headers.get('x-ratelimit-requests-remaining')),
			searchesRemaining: readNumber(res.headers.get('x-ratelimit-searches-remaining'))
		};
		if (res.status === 401) return { ok: false, error: 'unauthorized' };
		if (res.status === 403) {
			// 本文は、判別のためだけに読む。ログには出さない。
			const body = await res.text().catch(() => '');
			return { ok: false, error: /not subscribed/i.test(body) ? 'unauthorized' : 'rate_limited' };
		}
		if (res.status === 429) return { ok: false, error: 'rate_limited' };
		if (res.status >= 500) return { ok: false, error: 'network' };
		if (!res.ok) return { ok: false, error: 'bad_response' };
		try {
			return { ok: true, value: await res.json(), limit };
		} catch (e) {
			return { ok: false, error: isAbortError(e) ? 'network' : 'bad_response' };
		}
	}

	return {
		async searchGame(name) {
			const r = await get(`/game/search?criteria=${encodeURIComponent(name)}`);
			if (!r.ok) return r;
			if (!Array.isArray(r.value)) return { ok: false, error: 'bad_response' };
			return { ok: true, value: parseSearch(r.value), limit: r.limit };
		},
		async reviewsOfGame(ocId, skip) {
			const r = await get(`/review/game/${ocId}?skip=${skip}`);
			if (!r.ok) return r;
			if (!Array.isArray(r.value)) return { ok: false, error: 'bad_response' };
			return { ok: true, value: { snippets: parseReviews(r.value), rawCount: r.value.length }, limit: r.limit };
		}
	};
}
