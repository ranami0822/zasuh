import type { D1Database } from '@cloudflare/workers-types';
import { ClefError, type ClefClient } from '#server/clef';
import { addCandidate, claimDailyRun, ensureCriticQuestionSet, knownCriticIds, markSynced, saveCriticRead, worksNeedingCandidate, worksToSync } from '#server/critics';
import { hasBudget, type OcError, type OcRateLimit, type OpenCriticClient } from '#server/opencritic';
import { criticV1 } from '#server/question-sets/critic-v1';
import { readText } from '#server/reading';

/**
 * 専門家（批評家）の評価欄の、1 日 1 回の取得（docs/critics-plan.md の 1.6）。
 * 抜粋の本文は、メモリ上で Clef に渡すだけ。保存も、記録もしない。
 */

export interface CriticLimits {
	/** 1 回の実行での、OpenCritic の呼び出し（検索を除く）。無料の Workers の外部への subrequest は 1 回 50 まで。 */
	maxCalls: number;
	/** 候補の検索。 */
	maxSearches: number;
	/** Clef で読む抜粋の数（失敗した読み取りも数える）。 */
	maxReads: number;
	maxPagesPerWork: number;
	/** 無料枠の残り（呼び出し）が、これ以下になったら止める。 */
	requestReserve: number;
	/** 無料枠の残り（検索）が、これ以下になったら止める。 */
	searchReserve: number;
	/** OpenCritic の呼び出しの間隔。 */
	pauseMs: number;
}

/**
 * 無料の Workers / D1 の上限に合わせた既定値（2026-11-21）。D1 の無料プランは、1 回の呼び出しで 50 問い合わせまで
 * （公式の文書。https://developers.cloudflare.com/d1/platform/limits/）。1 回の取得は、問い合わせを、
 * 作品ごとに 2 回前後、読み取り 1 件ごとに 2 回、ほかに 10 回ほど使う。この値で、最大でも 45 回前後に収まる見込み（未確認）。
 * 有料プラン（1,000 回）にしたら、上げてよい（計画の値: maxCalls 40、maxSearches 5、maxReads 60）。
 */
export const DEFAULT_CRITIC_LIMITS: CriticLimits = {
	maxCalls: 8,
	maxSearches: 2,
	maxReads: 6,
	maxPagesPerWork: 3,
	requestReserve: 40,
	searchReserve: 5,
	pauseMs: 1500
};

export interface CriticSyncResult {
	works: number;
	/** 検索を除く、OpenCritic の呼び出し。 */
	calls: number;
	searches: number;
	read: number;
	failed: number;
	/** already_ran: その日の取得は、別の実行が始めていた。clef_failed: 読み取りが続けて失敗した。 */
	stopped: 'done' | 'budget' | 'unauthorized' | 'rate_limited' | 'clef_failed' | 'already_ran';
}

type Stop = Exclude<CriticSyncResult['stopped'], 'done'>;

/** OpenCritic の 1 ページの件数。応答の件数（解析で捨てる前）がこれより少なければ、最後のページ。 */
const PAGE_SIZE = 20;

/** 読み取りが、この回数続けて失敗したら、全体を止める（成功が 1 回あれば、数え直す）。 */
export const MAX_CONSECUTIVE_READ_FAILURES = 3;

/** 全体を止める失敗か。止めないものは null（その作品・検索だけを諦める）。 */
function stopOn(error: OcError): Stop | null {
	return error === 'unauthorized' || error === 'rate_limited' ? error : null;
}

export async function syncCritics(deps: {
	db: D1Database;
	clef: ClefClient;
	oc: OpenCriticClient;
	now?: () => Date;
	limits?: Partial<CriticLimits>;
	sleep?: (ms: number) => Promise<void>;
}): Promise<CriticSyncResult> {
	const { db, clef, oc } = deps;
	const now = deps.now ?? (() => new Date());
	const limits: CriticLimits = { ...DEFAULT_CRITIC_LIMITS, ...deps.limits };
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const result: CriticSyncResult = { works: 0, calls: 0, searches: 0, read: 0, failed: 0, stopped: 'done' };

	// 1 日 1 回。毎分の定期実行が重なっても、2 回目以降は、何も呼ばない。
	if (!(await claimDailyRun(db, now()))) return { ...result, stopped: 'already_ran' };

	/** 直前の応答の、無料枠の残り。まだ応答がなければ null（通す）。 */
	let lastLimit: OcRateLimit | null = null;
	let attempts = 0;
	let consecutiveFailures = 0;
	let anyCall = false;
	const pause = async () => {
		if (anyCall) await sleep(limits.pauseMs);
		anyCall = true;
	};

	const syncWorks = async (): Promise<Stop | null> => {
		const works = await worksToSync(db, limits.maxCalls, now());
		if (works.length === 0) return null;
		const questionSetId = await ensureCriticQuestionSet(db, criticV1, now());

		for (const work of works) {
			for (let pageIndex = 0; pageIndex < limits.maxPagesPerWork; pageIndex++) {
				if (result.calls >= limits.maxCalls || attempts >= limits.maxReads) return 'budget';
				if (lastLimit && !hasBudget(lastLimit, 'request', limits.requestReserve)) return 'budget';
				await pause();
				const page = await oc.reviewsOfGame(work.ocId, pageIndex * PAGE_SIZE);
				result.calls++;
				if (!page.ok) {
					const stop = stopOn(page.error);
					if (stop) return stop;
					// その作品だけを諦める（同じ作品が毎回先頭に来て、ほかが止まるのを防ぐため、取得済みにする）。
					result.failed++;
					break;
				}
				lastLimit = page.limit;

				// 応答の並び順は未確認なので、既知のページでも、次のページを取る（読み残しと、読み取りの失敗を拾うため）。
				const { snippets, rawCount } = page.value;
				const known = await knownCriticIds(db, work.id, snippets.map((s) => s.ocReviewId));
				const fresh = snippets.filter((s) => !known.has(s.ocReviewId));

				for (const snippet of fresh) {
					if (attempts >= limits.maxReads) return 'budget';
					attempts++;
					let answers;
					try {
						({ answers } = await readText({ clef }, criticV1, snippet.text));
					} catch (e) {
						// 利用枠の超過は、すぐには直らない。
						if (e instanceof ClefError && e.message.includes('429')) return 'rate_limited';
						// 次の日に、同じ抜粋が、また新しいものとして出る。
						result.failed++;
						// 続けて失敗するなら、Clef の側の問題（利用枠の超過を含む）とみなして止める。
						if (++consecutiveFailures >= MAX_CONSECUTIVE_READ_FAILURES) {
							// 読めない抜粋のある作品が、毎日先頭に居続けて、ほかの作品が回らなくならないよう、取得済みにする（順番を決めるだけ。毎回、0 ページ目から取り直す）。
							await markSynced(db, work.id, now());
							return 'clef_failed';
						}
						continue;
					}
					consecutiveFailures = 0;
					const saved = await saveCriticRead(db, { workId: work.id, snippet, questionSetId, answers }, now());
					if (saved.ok) result.read++;
				}
				if (rawCount < PAGE_SIZE) break;
			}
			await markSynced(db, work.id, now());
			result.works++;
		}
		return null;
	};

	const searchCandidates = async (): Promise<Stop | null> => {
		for (const work of await worksNeedingCandidate(db, limits.maxSearches, now())) {
			if (result.searches >= limits.maxSearches) return 'budget';
			if (lastLimit && (!hasBudget(lastLimit, 'request', limits.requestReserve) || !hasBudget(lastLimit, 'search', limits.searchReserve))) {
				return 'budget';
			}
			await pause();
			const found = await oc.searchGame(work.name);
			result.searches++;
			if (!found.ok) {
				const stop = stopOn(found.error);
				if (stop) return stop;
				result.failed++;
				continue;
			}
			lastLimit = found.limit;
			// 見つからなければ、何もしない（次の日に、また探す）。
			const top = found.value[0];
			if (top) await addCandidate(db, work.id, top, now());
		}
		return null;
	};

	result.stopped = (await syncWorks()) ?? (await searchCandidates()) ?? 'done';
	// 抜粋の本文・URL・キーは、出さない。
	console.log(JSON.stringify({ event: 'critic_sync', ...result }));
	return result;
}
