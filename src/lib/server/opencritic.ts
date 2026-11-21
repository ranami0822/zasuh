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
	throw new Error('not implemented');
}

/**
 * レビュー一覧の応答（配列）を、取り込める抜粋に直す。純粋な関数。
 * 形の悪い要素（_id・snippet・Outlet.name・externalUrl がない、url が http/https でない）は、捨てる。
 * language があって 'en' で始まらないものは捨てる（ない場合は、英語として扱う。実際の値は 'en-us'）。
 * 配列でなければ []。
 */
export function parseReviews(json: unknown): CriticSnippet[] {
	throw new Error('not implemented');
}

/** 検索の応答（配列）を、作品の候補に直す。純粋な関数。id（整数）・name（文字列）・dist（数）が揃わない要素は捨てる。配列でなければ []。 */
export function parseSearch(json: unknown): OcGame[] {
	throw new Error('not implemented');
}

/**
 * まだ呼んでよいか。kind が 'request' なら requestsRemaining、'search' なら searchesRemaining が、reserve を超えているとき true。
 * 残りが null（ヘッダーがなかった）なら true（呼び出し側の回数の上限で止める）。
 */
export function hasBudget(limit: OcRateLimit, kind: 'request' | 'search', reserve: number): boolean {
	throw new Error('not implemented');
}

export interface OpenCriticClient {
	searchGame(name: string): Promise<OcResult<OcGame[]>>;
	reviewsOfGame(ocId: number, skip: number): Promise<OcResult<CriticSnippet[]>>;
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
	throw new Error('not implemented');
}
