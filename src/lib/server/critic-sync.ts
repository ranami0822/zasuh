import type { D1Database } from '@cloudflare/workers-types';
import { ClefError, type ClefClient } from '#server/clef';
import {
	addCandidate,
	claimCriticSlot,
	criticDayTotals,
	ensureCriticQuestionSet,
	finishCriticSlot,
	knownCriticIds,
	markSearched,
	markSynced,
	saveCriticCursor,
	saveCriticRead,
	worksNeedingCandidate,
	worksToSync,
	type CriticSlotStop
} from '#server/critics';
import { hasBudget, type OcError, type OcRateLimit, type OpenCriticClient } from '#server/opencritic';
import { criticV1 } from '#server/question-sets/critic-v1';
import { readText } from '#server/reading';

/**
 * 専門家（批評家）の評価欄の取得（docs/critics-plan.md の 1.6）。時間帯の中で、5 分の枠ごとに 1 回、小さく動く
 * （docs/critics-incremental-plan.md の 3.4）。1 日の合計は、枠の記録（critic_slots）で数える。
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

export interface CriticDailyLimits {
	maxCalls: number;
	maxSearches: number;
	maxReads: number;
}

/** 1 日の合計の上限（docs/critics-incremental-plan.md の 1 章の表）。 */
export const DEFAULT_CRITIC_DAILY_LIMITS: CriticDailyLimits = { maxCalls: 150, maxSearches: 15, maxReads: 150 };

export interface CriticSyncResult {
	works: number;
	/** 検索を除く、OpenCritic の呼び出し。 */
	calls: number;
	searches: number;
	read: number;
	failed: number;
	/**
	 * already_ran: その枠は、別の実行が始めていた。stopped_today: その日の、ほかの枠が止めた。daily_limit: その日の合計の上限。
	 * clef_failed: 読み取りが続けて失敗した。
	 */
	stopped: 'done' | 'budget' | 'unauthorized' | 'rate_limited' | 'clef_failed' | 'already_ran' | 'stopped_today' | 'daily_limit';
}

/** 枠の記録に入れる止まり方。reserve（応答の残りが requestReserve 以下）は、結果では budget。 */
type Stop = Exclude<CriticSlotStop, 'done'>;

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
	/** 枠の名前（criticSyncSlot の戻り値）。 */
	slot: string;
	now?: () => Date;
	limits?: Partial<CriticLimits>;
	dailyLimits?: Partial<CriticDailyLimits>;
	sleep?: (ms: number) => Promise<void>;
}): Promise<CriticSyncResult> {
	const { db, clef, oc, slot } = deps;
	const now = deps.now ?? (() => new Date());
	const limits: CriticLimits = { ...DEFAULT_CRITIC_LIMITS, ...deps.limits };
	const daily: CriticDailyLimits = { ...DEFAULT_CRITIC_DAILY_LIMITS, ...deps.dailyLimits };
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const result: CriticSyncResult = { works: 0, calls: 0, searches: 0, read: 0, failed: 0, stopped: 'done' };

	// 枠ごとに 1 回。毎分の定期実行が同じ枠に重なっても、2 回目以降は、何も呼ばない。割り当ては、その日の残りで小さくなる。
	const claim = await claimCriticSlot(
		db,
		slot,
		now(),
		{ calls: limits.maxCalls, searches: limits.maxSearches, reads: limits.maxReads },
		{ calls: daily.maxCalls, searches: daily.maxSearches, reads: daily.maxReads }
	);
	if (!claim.ok) return { ...result, stopped: claim.error };
	limits.maxCalls = claim.allowance.calls;
	limits.maxSearches = claim.allowance.searches;
	limits.maxReads = claim.allowance.reads;

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
			/** この実行で、この作品のページを 1 つでも取ったか。取っていなければ、止まっても cursor を入れない（まだ始めていない作品が、途中として先頭に来ないように）。 */
			let fetched = false;
			/** 止まったとき、次の枠が取るページを覚えて、止まり方を返す。 */
			const halt = async (stop: Stop, nextPage: number): Promise<Stop> => {
				if (fetched) await saveCriticCursor(db, work.id, nextPage);
				return stop;
			};
			// 続きは cursor のページから。上限は、cursor からではなく、0 から数えて maxPagesPerWork 未満まで（続きから読んでも、1 日に見る深さは同じ）。
			for (let pageIndex = work.cursor; pageIndex < limits.maxPagesPerWork; pageIndex++) {
				if (result.calls >= limits.maxCalls || attempts >= limits.maxReads) return halt('budget', pageIndex);
				if (lastLimit && !hasBudget(lastLimit, 'request', limits.requestReserve)) return halt('reserve', pageIndex);
				await pause();
				const page = await oc.reviewsOfGame(work.ocId, pageIndex * PAGE_SIZE);
				result.calls++;
				if (!page.ok) {
					const stop = stopOn(page.error);
					if (stop) return halt(stop, pageIndex);
					// その作品だけを諦める（同じ作品が毎回先頭に来て、ほかが止まるのを防ぐため、取得済みにする）。
					result.failed++;
					break;
				}
				lastLimit = page.limit;
				fetched = true;

				// 応答の並び順は未確認なので、既知のページでも、次のページを取る（読み残しと、読み取りの失敗を拾うため）。
				const { snippets, rawCount } = page.value;
				const known = await knownCriticIds(db, work.id, snippets.map((s) => s.ocReviewId));
				const fresh = snippets.filter((s) => !known.has(s.ocReviewId));

				for (const snippet of fresh) {
					// そのページの抜粋は、次の枠で取り直す（読んだものは、knownCriticIds で飛ばす）。
					if (attempts >= limits.maxReads) return halt('budget', pageIndex);
					attempts++;
					let answers;
					try {
						({ answers } = await readText({ clef }, criticV1, snippet.text));
					} catch (e) {
						// 利用枠の超過は、すぐには直らない。
						if (e instanceof ClefError && e.message.includes('429')) return halt('rate_limited', pageIndex);
						// 次の日に、同じ抜粋が、また新しいものとして出る。
						result.failed++;
						// 続けて失敗するなら、Clef の側の問題（利用枠の超過を含む）とみなして止める。
						if (++consecutiveFailures >= MAX_CONSECUTIVE_READ_FAILURES) {
							// 読めない抜粋のある作品が、先頭に居続けて、ほかの作品が回らなくならないよう、その日は諦める（次の日に、0 ページ目から）。
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
			if (lastLimit && !hasBudget(lastLimit, 'request', limits.requestReserve)) return 'reserve';
			if (lastLimit && !hasBudget(lastLimit, 'search', limits.searchReserve)) return 'budget';
			await pause();
			const found = await oc.searchGame(work.name);
			result.searches++;
			if (!found.ok) {
				const stop = stopOn(found.error);
				// 止まったときは、検索した日を入れない（次の日に、また探す）。
				if (stop) return stop;
				result.failed++;
				await markSearched(db, work.id, now());
				continue;
			}
			lastLimit = found.limit;
			// 見つからなくても、その日は、もう探さない（毎枠、同じ作品の検索で、1 日の上限を使い切らないように）。
			const top = found.value[0];
			if (top) await addCandidate(db, work.id, top, now());
			await markSearched(db, work.id, now());
		}
		return null;
	};

	const stopped: CriticSlotStop = (await syncWorks()) ?? (await searchCandidates()) ?? 'done';
	result.stopped = stopped === 'reserve' ? 'budget' : stopped;
	// 割り当てを、実際に使った数に直す（読み取りは、失敗を含む）。例外のときは、ここに来ない（割り当てのまま残る。安全側）。
	await finishCriticSlot(db, slot, { calls: result.calls, searches: result.searches, reads: attempts }, stopped);
	const day = await criticDayTotals(db, slot.slice(0, 10));
	// 抜粋の本文・URL・キーは、出さない。
	console.log(JSON.stringify({ event: 'critic_sync', ...result, slot, day }));
	return result;
}
