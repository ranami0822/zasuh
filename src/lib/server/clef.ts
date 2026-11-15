import type { Ai } from '@cloudflare/workers-types';
import type { ClefQuestion } from './question-sets';
import type { ClefModel } from './question-sets/types';

/** Clef の応答のうち、使う部分。answers の中身は、reading.ts で検証する。 */
export interface ClefResult {
	answers: Record<string, unknown>;
	inputTokens: number | null;
}

export interface ClefClient {
	run(model: ClefModel, state: string, questions: Record<string, ClefQuestion>): Promise<ClefResult>;
}

export class ClefError extends Error {
	constructor(
		message: string,
		/** 時間をおけば成功しうる失敗か（429、5xx、通信の失敗）。 */
		readonly retryable: boolean
	) {
		super(message);
		this.name = 'ClefError';
	}
}

function toResult(payload: unknown): ClefResult {
	const p = payload as { result?: unknown } | null;
	const body = (p && typeof p === 'object' && 'result' in p ? p.result : p) as {
		answers?: unknown;
		usage?: { input_tokens?: unknown };
	} | null;
	if (!body || typeof body.answers !== 'object' || body.answers === null) {
		throw new ClefError('Clef の応答に answers がありません', false);
	}
	const tokens = body.usage?.input_tokens;
	return {
		answers: body.answers as Record<string, unknown>,
		inputTokens: typeof tokens === 'number' ? tokens : null
	};
}

/**
 * REST API で Clef を呼ぶ。実験（experiments/clef-mention）で確かめた呼び方。
 * Clef-flash は、`@cf/cloudflare/clef-flash` のエンドポイントで呼ぶ。
 */
export function restClient(opts: {
	accountId: string;
	apiToken: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
}): ClefClient {
	const doFetch = opts.fetch ?? fetch;
	return {
		async run(model, state, questions) {
			const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/@cf/cloudflare/${model}`;
			let res: Response;
			try {
				res = await doFetch(url, {
					method: 'POST',
					headers: {
						authorization: `Bearer ${opts.apiToken}`,
						'content-type': 'application/json'
					},
					body: JSON.stringify({ model, state, questions }),
					signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000)
				});
			} catch (e) {
				throw new ClefError(`Clef を呼び出せませんでした: ${(e as Error).name}`, true);
			}
			if (!res.ok) {
				const text = (await res.text().catch(() => '')).slice(0, 200);
				throw new ClefError(
					`Clef が ${res.status} を返しました: ${text}`,
					res.status === 429 || res.status >= 500
				);
			}
			return toResult(await res.json());
		}
	};
}

/**
 * Workers AI のバインディングで Clef を呼ぶ。
 * 未確認: 実験は REST API でのみ行った。バインディングでのモデル名と入力の形は、
 * REST と同じと仮定している。デプロイの前に確かめること。
 */
export function bindingClient(ai: Ai): ClefClient {
	return {
		async run(model, state, questions) {
			let payload: unknown;
			try {
				payload = await (ai as unknown as { run(m: string, i: unknown): Promise<unknown> }).run(
					`@cf/cloudflare/${model}`,
					{ model, state, questions }
				);
			} catch (e) {
				throw new ClefError(`Clef を呼び出せませんでした: ${(e as Error).message}`.slice(0, 300), true);
			}
			return toResult(payload);
		}
	};
}
