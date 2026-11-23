import { describe, expect, it } from 'vitest';
import { createOpenCriticClient, hasBudget, normalizeKey, parseGameDetail, parseGameList, parseReviews, readOcInfo, parseSearch } from './opencritic';

// 作り物のデータだけを使う（実在の抜粋・記事は置かない）。
const review = (over: Record<string, unknown> = {}) => ({
	_id: 'r1',
	title: 'A made-up title',
	snippet: 'A made-up snippet for testing.',
	language: 'en-us',
	externalUrl: 'https://example.com/a',
	publishedDate: '2020-05-19T00:00:00.000Z',
	score: 90,
	Outlet: { name: 'Example Outlet' },
	Authors: [{ name: 'Someone' }],
	...over
});

describe('normalizeKey', () => {
	it('前後の空白と引用符を外す。空なら null', () => {
		expect(normalizeKey(undefined)).toBeNull();
		expect(normalizeKey('')).toBeNull();
		expect(normalizeKey('   ')).toBeNull();
		expect(normalizeKey('  abc ')).toBe('abc');
		expect(normalizeKey("abc'")).toBe('abc');
		expect(normalizeKey('"abc"')).toBe('abc');
		expect(normalizeKey("'abc'")).toBe('abc');
	});
});

describe('parseReviews', () => {
	it('必要な項目だけを取り出す（題名・著者は持たない。点数は、0〜100 と読めるものだけ）', () => {
		const [one] = parseReviews([review()]);
		expect(one).toEqual({
			ocReviewId: 'r1',
			text: 'A made-up snippet for testing.',
			outlet: 'Example Outlet',
			url: 'https://example.com/a',
			publishedOn: '2020-05-19',
			ocScore: null
		});
		expect(Object.keys(one).sort()).toEqual(['ocReviewId', 'ocScore', 'outlet', 'publishedOn', 'text', 'url']);
	});

	it('抜粋の前後の空白を外す', () => {
		expect(parseReviews([review({ snippet: '  padded  ' })])[0].text).toBe('padded');
	});

	it('形の悪い要素は捨てる', () => {
		const items = [
			review({ _id: 'ok' }),
			review({ _id: undefined }),
			review({ _id: 'no-snippet', snippet: undefined }),
			review({ _id: 'blank-snippet', snippet: '   ' }),
			review({ _id: 'no-outlet', Outlet: undefined }),
			review({ _id: 'blank-outlet', Outlet: { name: ' ' } }),
			review({ _id: 'no-url', externalUrl: undefined }),
			review({ _id: 'js-url', externalUrl: 'javascript:alert(1)' }),
			review({ _id: 'ftp-url', externalUrl: 'ftp://example.com/a' }),
			null,
			'text',
			42
		];
		expect(parseReviews(items).map((r) => r.ocReviewId)).toEqual(['ok']);
	});

	it('英語以外は捨てる。language がないものは英語として扱う', () => {
		const items = [
			review({ _id: 'en-us', language: 'en-us' }),
			review({ _id: 'en', language: 'en' }),
			review({ _id: 'es', language: 'es-es' }),
			review({ _id: 'none', language: undefined })
		];
		expect(parseReviews(items).map((r) => r.ocReviewId)).toEqual(['en-us', 'en', 'none']);
	});

	it('日付が読めなければ publishedOn は null', () => {
		expect(parseReviews([review({ publishedDate: 'not a date' })])[0].publishedOn).toBeNull();
		expect(parseReviews([review({ publishedDate: undefined })])[0].publishedOn).toBeNull();
	});

	describe('媒体の点数（ocScore。0〜100 の整数）', () => {
		const scoreOf = (over: Record<string, unknown>) => parseReviews([review({ score: undefined, ...over })])[0].ocScore;

		it('npScore が 0〜100 の数なら、四捨五入する', () => {
			expect(scoreOf({ npScore: 88.4 })).toBe(88);
			expect(scoreOf({ npScore: 0 })).toBe(0);
			expect(scoreOf({ npScore: 100 })).toBe(100);
		});

		it('npScore がなければ、100 点満点と分かる形式の score を読む', () => {
			expect(scoreOf({ score: 90, ScoreFormat: { id: 99, name: 'x / 100' } })).toBe(90);
			expect(scoreOf({ score: 90, scoreFormat: { shortName: '/100' } })).toBe(90);
			expect(scoreOf({ score: 90, ScoreFormat: 'x / 100' })).toBe(90);
		});

		it('100 点満点と分からない形式、形式のない score は、読まない', () => {
			expect(scoreOf({ score: 4, ScoreFormat: { name: 'x / 5' } })).toBeNull();
			expect(scoreOf({ score: 9, ScoreFormat: { name: 'x / 10.0' } })).toBeNull();
			expect(scoreOf({ score: 90, ScoreFormat: { name: 'x / 1000' } })).toBeNull();
			expect(scoreOf({ score: 90, ScoreFormat: { id: 1 } })).toBeNull();
			expect(scoreOf({ score: 90 })).toBeNull();
		});

		it('範囲の外、数でないもの、NaN は null。点数が何もなければ null', () => {
			for (const npScore of [120, -3, 'x', '88', NaN, Infinity, null]) expect(scoreOf({ npScore }), String(npScore)).toBeNull();
			expect(scoreOf({ score: 101, ScoreFormat: { name: 'x / 100' } })).toBeNull();
			expect(scoreOf({ score: 'x', ScoreFormat: { name: 'x / 100' } })).toBeNull();
			expect(scoreOf({})).toBeNull();
		});
	});

	it('配列でなければ空', () => {
		expect(parseReviews(null)).toEqual([]);
		expect(parseReviews({ message: 'x' })).toEqual([]);
	});
});

describe('parseSearch', () => {
	it('id・name・dist が揃うものだけ取り出す', () => {
		const items = [
			{ id: 10, name: 'Game A', dist: 0 },
			{ id: '11', name: 'Game B', dist: 0.2 },
			{ id: 12, name: 'Game C' },
			{ id: 13.5, name: 'Game D', dist: 0 },
			{ name: 'Game E', dist: 0 },
			null
		];
		expect(parseSearch(items)).toEqual([{ id: 10, name: 'Game A', dist: 0 }]);
		expect(parseSearch({})).toEqual([]);
	});
});

describe('hasBudget', () => {
	it('残りが reserve を超えているときだけ true。残りが不明なら true', () => {
		const limit = { requestsRemaining: 45, searchesRemaining: 6 };
		expect(hasBudget(limit, 'request', 40)).toBe(true);
		expect(hasBudget({ ...limit, requestsRemaining: 40 }, 'request', 40)).toBe(false);
		expect(hasBudget(limit, 'search', 5)).toBe(true);
		expect(hasBudget({ ...limit, searchesRemaining: 5 }, 'search', 5)).toBe(false);
		expect(hasBudget({ requestsRemaining: null, searchesRemaining: null }, 'request', 40)).toBe(true);
		expect(hasBudget({ requestsRemaining: null, searchesRemaining: null }, 'search', 5)).toBe(true);
	});
});

describe('createOpenCriticClient', () => {
	function fakeFetch(respond: () => Response | Promise<Response>) {
		const calls: { url: string; headers: Record<string, string> }[] = [];
		const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
			return respond();
		}) as typeof fetch;
		return { impl, calls };
	}
	const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
		new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

	it('検索: URL とヘッダーを正しく組み立て、残りの回数を読む', async () => {
		const { impl, calls } = fakeFetch(() =>
			json([{ id: 7, name: 'Game A', dist: 0 }], 200, {
				'x-ratelimit-requests-remaining': '150',
				'x-ratelimit-searches-remaining': '20'
			})
		);
		const client = createOpenCriticClient({ key: 'test-key', fetch: impl });
		const result = await client.searchGame('Game A & B');
		expect(result).toEqual({
			ok: true,
			value: [{ id: 7, name: 'Game A', dist: 0 }],
			limit: { requestsRemaining: 150, searchesRemaining: 20 }
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://opencritic-api.p.rapidapi.com/game/search?criteria=Game%20A%20%26%20B');
		expect(calls[0].headers['x-rapidapi-host']).toBe('opencritic-api.p.rapidapi.com');
		expect(calls[0].headers['x-rapidapi-key']).toBe('test-key');
	});

	it('レビュー: skip を付けて呼び、抜粋に直す。ヘッダーがなければ残りは null', async () => {
		const { impl, calls } = fakeFetch(() => json([review()]));
		const client = createOpenCriticClient({ key: 'k', fetch: impl });
		const result = await client.reviewsOfGame(10181, 20);
		expect(calls[0].url).toBe('https://opencritic-api.p.rapidapi.com/review/game/10181?skip=20');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.snippets.map((r) => r.ocReviewId)).toEqual(['r1']);
			expect(result.value.rawCount).toBe(1);
			expect(result.limit).toEqual({ requestsRemaining: null, searchesRemaining: null });
		}
	});

	it('レビュー: rawCount は、解析で捨てたものを含む、応答の配列の件数', async () => {
		const { impl } = fakeFetch(() => json([review({ _id: 'r1' }), review({ _id: 'r2', language: 'ja-jp' }), review({ _id: '' }), 'not an object']));
		const result = await createOpenCriticClient({ key: 'k', fetch: impl }).reviewsOfGame(1, 0);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.snippets.map((r) => r.ocReviewId)).toEqual(['r1']);
			expect(result.value.rawCount).toBe(4);
		}
	});

	it('レビュー: fields は、応答の最初の 1 件の、最上位の項目の名前（並べ替え済み。値は含めない）', async () => {
		const { impl } = fakeFetch(() => json([review({ npScore: 88 }), { other: 1 }]));
		const result = await createOpenCriticClient({ key: 'k', fetch: impl }).reviewsOfGame(1, 0);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.fields).toEqual(['Authors', 'Outlet', '_id', 'externalUrl', 'language', 'npScore', 'publishedDate', 'score', 'snippet', 'title']);
			expect(result.value.snippets[0].ocScore).toBe(88);
		}
		const empty = await createOpenCriticClient({ key: 'k', fetch: fakeFetch(() => json([])).impl }).reviewsOfGame(1, 0);
		expect(empty.ok && empty.value.fields).toEqual([]);
		const notObject = await createOpenCriticClient({ key: 'k', fetch: fakeFetch(() => json(['text'])).impl }).reviewsOfGame(1, 0);
		expect(notObject.ok && notObject.value.fields).toEqual([]);
	});

	it('失敗は例外にせず、種類で返す', async () => {
		const run = async (respond: () => Response | Promise<Response>) => {
			const { impl } = fakeFetch(respond);
			return createOpenCriticClient({ key: 'k', fetch: impl }).reviewsOfGame(1, 0);
		};
		expect(await run(() => json({ message: 'x' }, 401))).toEqual({ ok: false, error: 'unauthorized' });
		expect(await run(() => json({ message: 'You are not subscribed to this API.' }, 403))).toEqual({ ok: false, error: 'unauthorized' });
		expect(await run(() => json({ message: 'Too many requests' }, 403))).toEqual({ ok: false, error: 'rate_limited' });
		expect(await run(() => json({ message: 'x' }, 429))).toEqual({ ok: false, error: 'rate_limited' });
		expect(await run(() => json({ message: 'x' }, 500))).toEqual({ ok: false, error: 'network' });
		expect(await run(() => json({ message: 'x' }, 503))).toEqual({ ok: false, error: 'network' });
		expect(await run(() => json({ not: 'an array' }))).toEqual({ ok: false, error: 'bad_response' });
		expect(await run(() => json('this is not json'))).toEqual({ ok: false, error: 'bad_response' });
		expect(
			await run(() => {
				throw new TypeError('fetch failed');
			})
		).toEqual({ ok: false, error: 'network' });
	});
});

describe('parseGameList / listGames', () => {
	it('id と name が揃うものだけ読む', () => {
		expect(parseGameList([{ id: 1, name: ' A ' }, { id: 'x', name: 'B' }, { id: 2, name: '' }, null, { id: 0, name: 'Z' }])).toEqual([{ id: 1, name: 'A' }]);
		expect(parseGameList({})).toEqual([]);
	});

	it('GET /game/<種類> を呼ぶ。配列でなければ bad_response', async () => {
		const seen: string[] = [];
		const client = createOpenCriticClient({
			key: 'k',
			fetch: (async (u: string) => {
				seen.push(u);
				return Response.json(u.endsWith('upcoming') ? {} : [{ id: 3, name: 'C' }]);
			}) as unknown as typeof fetch
		});
		const popular = await client.listGames('popular');
		expect(popular.ok && popular.value).toEqual([{ id: 3, name: 'C' }]);
		expect(seen[0]).toBe('https://opencritic-api.p.rapidapi.com/game/popular');
		expect(await client.listGames('upcoming')).toEqual({ ok: false, error: 'bad_response' });
	});
});

describe('parseGameDetail / gameById', () => {
	const game = {
		id: 7,
		name: ' A Game ',
		type: 'BASE',
		description: ' An English description. ',
		firstReleaseDate: '2025-03-04T00:00:00.000Z',
		steamId: '12345',
		Platforms: [{ id: 1, name: 'PC' }, { id: 2, name: 'PC' }, { id: 3 }],
		Genres: [{ id: 9, name: 'Action' }],
		Companies: [{ name: 'Dev Co', type: 'DEVELOPER' }, { name: 'Pub Co', type: 'PUBLISHER' }],
		images: { box: { og: 'https://example.com/x.png' } },
		topCriticScore: 90
	};

	it('作品情報だけを読む（点数と画像は、取らない）', () => {
		const d = parseGameDetail(game);
		expect(d).toEqual({
			id: 7,
			name: 'A Game',
			type: 'BASE',
			info: { description: 'An English description.', releaseDate: '2025-03-04', platforms: ['PC'], genres: ['Action'], developers: ['Dev Co'], publishers: ['Pub Co'], steamId: '12345' }
		});
		expect(JSON.stringify(d)).not.toContain('example.com');
	});

	it('欠けた項目は空にし、id と name がなければ null。Steam の ID は数字だけ', () => {
		expect(parseGameDetail({ id: 1, name: 'X', steamId: 'abc' })?.info).toEqual({ description: null, releaseDate: null, platforms: [], genres: [], developers: [], publishers: [], steamId: null });
		expect(parseGameDetail({ name: 'X' })).toBeNull();
		expect(parseGameDetail([])).toBeNull();
	});

	it('保存した JSON を戻す。壊れていれば null', () => {
		const info = parseGameDetail(game)!.info;
		expect(readOcInfo(JSON.stringify(info))).toEqual(info);
		expect(readOcInfo('{')).toBeNull();
		expect(readOcInfo(null)).toBeNull();
	});

	it('GET /game/<id>。作品の形でなければ bad_response', async () => {
		const seen: string[] = [];
		const client = createOpenCriticClient({
			key: 'k',
			fetch: (async (u: string) => {
				seen.push(u);
				return Response.json(u.endsWith('/7') ? game : []);
			}) as unknown as typeof fetch
		});
		const ok = await client.gameById(7);
		expect(ok.ok && ok.value.name).toBe('A Game');
		expect(seen[0]).toBe('https://opencritic-api.p.rapidapi.com/game/7');
		expect(await client.gameById(8)).toEqual({ ok: false, error: 'bad_response' });
	});
});
