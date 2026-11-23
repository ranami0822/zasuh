/**
 * OpenCritic の API（RapidAPI）の呼び出しと、応答の解析。D1 を知らない（保存は critics.ts）。
 * 設計は docs/critics-plan.md の 1.2。抜粋（CriticSnippet.text）は、メモリ上だけで扱い、保存しない。
 */

/** text はメモリ上だけで扱い、保存しない。題名・著者は、持たない。 */
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
	/**
	 * 媒体の点数（0〜100 の整数）。保存するが、画面には出さない（docs/mvp-design.md の 22.12。2026-11-23 の決定）。
	 * npScore（0〜100 にそろえた点数）、なければ、100 点満点と分かる形式の score。読めなければ null。
	 */
	ocScore: number | null;
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

/** 一覧（人気・新作など）の応答の 1 件。 */
export interface OcListedGame {
	id: number;
	name: string;
}

/** 一覧の応答（配列）を、作品の名前と ID に直す。id（整数）・name（空でない文字列）が揃わない要素は捨てる。配列でなければ []。 */
export function parseGameList(json: unknown): OcListedGame[] {
	if (!Array.isArray(json)) return [];
	const out: OcListedGame[] = [];
	for (const item of json) {
		if (typeof item !== 'object' || item === null) continue;
		const { id, name } = item as Record<string, unknown>;
		if (typeof id === 'number' && Number.isInteger(id) && id > 0 && typeof name === 'string' && name.trim() !== '') out.push({ id, name: name.trim() });
	}
	return out;
}

/** 作品の詳細（/game/{id}）から取る情報。点数と画像は、取らない。説明は、英語のまま（翻訳しない）。 */
export interface OcInfo {
	description: string | null;
	/** YYYY-MM-DD。 */
	releaseDate: string | null;
	platforms: string[];
	genres: string[];
	developers: string[];
	publishers: string[];
	/** Steam の appid（数字だけ）。 */
	steamId: string | null;
}

export interface OcGameDetail {
	id: number;
	name: string;
	/** BASE、EPISODE、EXPANSION、REMAKE、REMASTER、DLC。読めなければ null。 */
	type: string | null;
	info: OcInfo;
}

const DESCRIPTION_MAX = 2000;
const LIST_MAX = 12;

function names(value: unknown, key: string, filter?: (o: Record<string, unknown>) => boolean): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== 'object' || item === null) continue;
		const o = item as Record<string, unknown>;
		const name = o[key];
		if (typeof name === 'string' && name.trim() !== '' && (!filter || filter(o)) && !out.includes(name.trim())) out.push(name.trim());
	}
	return out.slice(0, LIST_MAX);
}

/** /game/{id} の応答を読む。id と name が揃わなければ null。足りない項目は、空にする。 */
export function parseGameDetail(json: unknown): OcGameDetail | null {
	if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
	const o = json as Record<string, unknown>;
	if (typeof o.id !== 'number' || !Number.isInteger(o.id) || o.id <= 0 || typeof o.name !== 'string' || o.name.trim() === '') return null;
	const description = typeof o.description === 'string' ? [...o.description.trim()].slice(0, DESCRIPTION_MAX).join('') : '';
	const steam = typeof o.steamId === 'string' || typeof o.steamId === 'number' ? String(o.steamId).trim() : '';
	return {
		id: o.id,
		name: o.name.trim(),
		type: typeof o.type === 'string' ? o.type : null,
		info: {
			description: description === '' ? null : description,
			releaseDate: toDateOnly(o.firstReleaseDate),
			platforms: names(o.Platforms, 'name'),
			genres: names(o.Genres, 'name'),
			developers: names(o.Companies, 'name', (c) => c.type === 'DEVELOPER'),
			publishers: names(o.Companies, 'name', (c) => c.type === 'PUBLISHER'),
			steamId: /^\d{1,10}$/.test(steam) ? steam : null
		}
	};
}

/** 保存した JSON を、OcInfo に戻す。読めなければ null。 */
export function readOcInfo(text: string | null): OcInfo | null {
	if (!text) return null;
	try {
		const v = JSON.parse(text) as Partial<OcInfo>;
		const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : []);
		return {
			description: typeof v.description === 'string' ? v.description : null,
			releaseDate: typeof v.releaseDate === 'string' ? v.releaseDate : null,
			platforms: list(v.platforms),
			genres: list(v.genres),
			developers: list(v.developers),
			publishers: list(v.publishers),
			steamId: typeof v.steamId === 'string' && /^\d{1,10}$/.test(v.steamId) ? v.steamId : null
		};
	} catch {
		return null;
	}
}

/** 一覧の種類。応答の道筋は GET /game/<kind>（仕様書で確認。docs/mvp-design.md の 26.2）。 */
export const LIST_KINDS = ['popular', 'recently-released', 'upcoming'] as const;
export type ListKind = (typeof LIST_KINDS)[number];

/** 作品の一覧を取る口。レビュー取得の OpenCriticClient とは分ける（取得の試験の偽物に、足さなくてよくするため）。 */
export interface OpenCriticListing {
	listGames(kind: ListKind): Promise<OcResult<OcListedGame[]>>;
	/** 作品 1 件の詳細。応答が作品の形でなければ bad_response。 */
	gameById(id: number): Promise<OcResult<OcGameDetail>>;
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
	return { ocReviewId: id, text, outlet, url, publishedOn: toDateOnly(o.publishedDate), ocScore: toScore(o) };
}

/**
 * 媒体の点数を、0〜100 の整数で読む。応答の項目名は、実際の応答で確かめていない（未確認）ので、防御的に読む。
 * (1) npScore が 0〜100 の数。(2) なければ score が 0〜100 の数で、ScoreFormat（または scoreFormat）が 100 点満点と読めるもの
 * （名前などが 'x / 100'、'/100' の形。id だけの形式や、ほかの満点の形式は、読まない）。どちらもなければ null。
 */
function toScore(o: Record<string, unknown>): number | null {
	const np = inPercentRange(o.npScore);
	if (np !== null) return Math.round(np);
	const score = inPercentRange(o.score);
	if (score !== null && isOutOf100(o.ScoreFormat ?? o.scoreFormat)) return Math.round(score);
	return null;
}

function inPercentRange(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function isOutOf100(format: unknown): boolean {
	const outOf100 = (text: unknown) => typeof text === 'string' && /^\s*x?\s*\/\s*100\s*$/i.test(text);
	if (outOf100(format)) return true;
	if (typeof format !== 'object' || format === null) return false;
	const f = format as Record<string, unknown>;
	return outOf100(f.name) || outOf100(f.shortName) || outOf100(f.scoreDisplay);
}

/** 応答の最初の 1 件の、最上位の項目の名前（並べ替え済み。値は含めない）。読み方を、実際の応答に合わせて直すため。 */
function topLevelFields(json: unknown[]): string[] {
	const first = json[0];
	return typeof first === 'object' && first !== null && !Array.isArray(first) ? Object.keys(first).sort() : [];
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
	/**
	 * rawCount は、応答の配列の、解析で捨てる前の件数（最後のページかの判断に使う）。
	 * fields は、応答の最初の 1 件の、最上位の項目の名前（値は含めない。管理画面に出して、点数の読み方を確かめるため）。
	 */
	reviewsOfGame(ocId: number, skip: number): Promise<OcResult<{ snippets: CriticSnippet[]; rawCount: number; fields: string[] }>>;
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
export function createOpenCriticClient(opts: { key: string; fetch?: typeof fetch; timeoutMs?: number }): OpenCriticClient & OpenCriticListing {
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
		async gameById(id) {
			const r = await get(`/game/${id}`);
			if (!r.ok) return r;
			const detail = parseGameDetail(r.value);
			return detail ? { ok: true, value: detail, limit: r.limit } : { ok: false, error: 'bad_response' };
		},
		async listGames(kind) {
			const r = await get(`/game/${kind}`);
			if (!r.ok) return r;
			if (!Array.isArray(r.value)) return { ok: false, error: 'bad_response' };
			return { ok: true, value: parseGameList(r.value), limit: r.limit };
		},
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
			return { ok: true, value: { snippets: parseReviews(r.value), rawCount: r.value.length, fields: topLevelFields(r.value) }, limit: r.limit };
		}
	};
}
