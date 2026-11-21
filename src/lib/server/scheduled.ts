import { bindingClient } from './clef';
import { criticSyncSlot } from './critic-slot';
import { syncCritics } from './critic-sync';
import type { Env } from './env';
import { createOpenCriticClient, normalizeKey } from './opencritic';
import { sweepReadings } from './sweep';

/**
 * 定期実行（毎分）。読めていないレビューを拾って、読み直す。決まった時間帯（critic-slot.ts。UTC 17:00〜21:00）には、専門家の評価の取得もする。
 * 取得は、5 分の枠ごとに 1 回（枠は、critics.ts の claimCriticSlot で取る）。docs/critics-incremental-plan.md。
 * sweep が拾ったときは、取得を見送る（枠も取らない。次の分に回る）。D1 の「1 回の呼び出しで 50 問い合わせ」を、sweep と取得で共有するため。
 */
export async function runScheduled(env: Env, now: Date = new Date(), deps: { fetch?: typeof fetch } = {}): Promise<void> {
	const result = await sweepReadings({ db: env.DB, clef: bindingClient(env.AI) });
	if (result.picked > 0) console.log(JSON.stringify({ event: 'sweep', ...result }));

	const key = normalizeKey(env.OPENCRITIC_API_KEY);
	const slot = criticSyncSlot(now);
	if (!key || !slot || result.picked > 0) return;
	try {
		await syncCritics({
			db: env.DB,
			clef: bindingClient(env.AI),
			oc: createOpenCriticClient({ key, fetch: deps.fetch }),
			slot,
			now: () => now
		});
	} catch (e) {
		// 失敗しても、定期実行は、例外を投げない（次の枠に、やり直す）。メッセージに、本文やキーは含まれない。
		console.error(JSON.stringify({ event: 'critic_sync_failed', message: String(e).slice(0, 200) }));
	}
}
