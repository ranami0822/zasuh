import { describe, expect, it } from 'vitest';
import { bindingClient, ClefError, restClient } from './clef';
import { toClefQuestions } from './question-sets';
import { gameV1 } from './question-sets/game-v1';
import realResponse from './testing/clef-response.json';

function clientWith(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
	const calls: { url: string; init: RequestInit }[] = [];
	const client = restClient({
		accountId: 'acc',
		apiToken: 'token',
		fetch: (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return respond(url, init);
		}) as unknown as typeof fetch
	});
	return { client, calls };
}

describe('restClient', () => {
	const questions = toClefQuestions(gameV1);

	it('Clef-flash は、専用のエンドポイントに、model・state・questions を送る', async () => {
		const { client, calls } = clientWith(() => Response.json({ result: realResponse, success: true }));

		const result = await client.run('clef-flash', 'レビューの本文', questions);

		expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/cloudflare/clef-flash');
		expect(calls[0].init.method).toBe('POST');
		expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer token');
		const body = JSON.parse(calls[0].init.body as string);
		expect(body).toMatchObject({ model: 'clef-flash', state: 'レビューの本文' });
		expect(Object.keys(body.questions)).toHaveLength(8);

		expect(result.inputTokens).toBe(1696);
		expect(Object.keys(result.answers)).toHaveLength(8);
	});

	it('利用枠の超過（429）は、すぐにはやり直さない失敗として返す', async () => {
		const { client } = clientWith(() => new Response('{"errors":[{"message":"daily free allocation"}]}', { status: 429 }));
		const error = await client.run('clef-flash', 'x', questions).catch((e) => e);
		expect(error).toBeInstanceOf(ClefError);
		expect(error.retryable).toBe(false);
		expect(error.message).toContain('429');
	});

	it('5xx と通信の失敗は、すぐにやり直せる失敗として返す', async () => {
		const down = clientWith(() => new Response('', { status: 503 }));
		expect((await down.client.run('clef', 'x', questions).catch((e) => e)).retryable).toBe(true);

		const offline = clientWith(() => {
			throw new TypeError('fetch failed');
		});
		expect((await offline.client.run('clef', 'x', questions).catch((e) => e)).retryable).toBe(true);
	});

	it('answers のない応答は、エラーにする', async () => {
		const { client } = clientWith(() => Response.json({ result: {}, success: true }));
		await expect(client.run('clef', 'x', questions)).rejects.toThrow('answers');
	});
});

describe('bindingClient', () => {
	const questions = toClefQuestions(gameV1);
	const aiWith = (run: (model: string, input: unknown) => Promise<unknown>) => bindingClient({ run } as never);

	it('モデル名に @cf/cloudflare/ を付けて、model・state・questions を渡す', async () => {
		const calls: { model: string; input: unknown }[] = [];
		const client = aiWith(async (model, input) => {
			calls.push({ model, input });
			return { result: realResponse, success: true };
		});
		const result = await client.run('clef-flash', '本文', questions);
		expect(calls).toHaveLength(1);
		expect(calls[0].model).toBe('@cf/cloudflare/clef-flash');
		expect(calls[0].input).toMatchObject({ model: 'clef-flash', state: '本文', questions });
		expect(result.inputTokens).toBe(1696);
		expect(Object.keys(result.answers)).toHaveLength(8);
	});

	it('呼び出しが投げたら、すぐにやり直せる失敗として返す。文は長くしすぎない', async () => {
		const client = aiWith(async () => {
			throw new Error('x'.repeat(1000));
		});
		const error = await client.run('clef-flash', '本文', questions).catch((e) => e);
		expect(error).toBeInstanceOf(ClefError);
		expect(error.retryable).toBe(true);
		expect(error.message.length).toBeLessThanOrEqual(300);
	});

	it('answers のない応答は、エラーにする', async () => {
		const client = aiWith(async () => ({ result: {}, success: true }));
		await expect(client.run('clef-flash', '本文', questions)).rejects.toThrow('answers');
	});
});
