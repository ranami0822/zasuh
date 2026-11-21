import type { D1Database } from '@cloudflare/workers-types';
import type { CriticSnippet, OcGame } from '#server/opencritic';
import { definitionHash } from '#server/question-sets/index';
import type { Direction, QuestionSetDefinition } from '#server/question-sets/types';
import type { ReadingAnswer } from '#server/reading';

/**
 * 専門家（批評家）のレビューの、読み取りの結果の保存と、問い合わせ（docs/critics-plan.md の 1.5）。
 * 抜粋・題名・著者・点数は、保存しない。
 */

export type CriticError = 'bad_oc_id' | 'oc_id_taken' | 'not_found' | 'not_game';

export const CRITIC_ITEMS_MAX = 30;

export interface CriticAllowance {
	calls: number;
	searches: number;
	reads: number;
}
/** reserve: OpenCritic の応答ヘッダーの残り（呼び出し）が requestReserve 以下で止まった（結果の stopped は 'budget' のまま。枠の記録だけ分ける）。 */
export type CriticSlotStop = 'done' | 'budget' | 'reserve' | 'unauthorized' | 'rate_limited' | 'clef_failed';
export type ClaimError = 'already_ran' | 'stopped_today' | 'daily_limit';

export interface WorkToSync {
	id: string;
	ocId: number;
	/** 次に取るページ（0 始まり）。途中でなければ 0。 */
	cursor: number;
}
/** 星の段階の数。 */
const STAR_LEVELS = 5;
/** この理由で終わった枠があると、その日のほかの枠は動かない。 */
const HALTING_STOPS: CriticSlotStop[] = ['unauthorized', 'rate_limited', 'reserve'];

/** UTC の日付 'YYYY-MM-DD'。 */
function utcDay(now: Date): string {
	return now.toISOString().slice(0, 10);
}

/** question_sets の id を、取得か追加する（tags.ts の resolveWorkQuestionSet と同じ流れ）。 */
export async function ensureCriticQuestionSet(db: D1Database, def: QuestionSetDefinition, now: Date): Promise<number> {
	const hash = await definitionHash(def);
	const select = db.prepare('SELECT id FROM question_sets WHERE hash = ?').bind(hash);
	let row = await select.first<{ id: number }>();
	if (!row) {
		await db
			.prepare('INSERT OR IGNORE INTO question_sets (hash, model, definition_json, created_at) VALUES (?, ?, ?, ?)')
			.bind(hash, def.model, JSON.stringify(def), now.toISOString())
			.run();
		row = await select.first<{ id: number }>();
	}
	if (!row) throw new Error('質問セットを保存できませんでした');
	return row.id;
}

/** 渡した OpenCritic のレビュー ID のうち、その作品で保存済みのもの。 */
export async function knownCriticIds(db: D1Database, workId: string, ocReviewIds: string[]): Promise<Set<string>> {
	const known = new Set<string>();
	// D1 の、1文に渡せる値の数の上限（100）を超えないように、分けて聞く。
	for (let i = 0; i < ocReviewIds.length; i += 50) {
		const chunk = ocReviewIds.slice(i, i + 50);
		const { results } = await db
			.prepare(`SELECT oc_review_id FROM critic_reviews WHERE work_id = ? AND oc_review_id IN (${chunk.map(() => '?').join(', ')})`)
			.bind(workId, ...chunk)
			.all<{ oc_review_id: string }>();
		for (const r of results) known.add(r.oc_review_id);
	}
	return known;
}

export async function saveCriticRead(
	db: D1Database,
	input: {
		workId: string;
		snippet: Pick<CriticSnippet, 'ocReviewId' | 'outlet' | 'url' | 'publishedOn'>;
		questionSetId: number;
		answers: ReadingAnswer[];
	},
	now: Date
): Promise<{ ok: true } | { ok: false; error: 'duplicate' }> {
	const exists = await db
		.prepare('SELECT 1 FROM critic_reviews WHERE work_id = ? AND oc_review_id = ?')
		.bind(input.workId, input.snippet.ocReviewId)
		.first();
	if (exists) return { ok: false, error: 'duplicate' };

	const id = crypto.randomUUID();
	const insert = db.prepare(
		'INSERT INTO critic_answers (critic_review_id, question_key, aspect, kind, value, prob, probs_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
	);
	try {
		await db.batch([
			db
				.prepare(
					`INSERT INTO critic_reviews (id, work_id, oc_review_id, outlet, url, published_on, question_set_id, read_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(id, input.workId, input.snippet.ocReviewId, input.snippet.outlet, input.snippet.url, input.snippet.publishedOn, input.questionSetId, now.toISOString()),
			...input.answers.map((a) =>
				insert.bind(id, a.questionKey, a.aspect, a.kind, a.value, a.prob, a.probs ? JSON.stringify(a.probs) : a.star ? JSON.stringify(a.star) : null)
			)
		]);
	} catch (e) {
		// 確かめたあとに、同時に保存されたとき（UNIQUE (work_id, oc_review_id)）。
		if (String(e).includes('UNIQUE')) return { ok: false, error: 'duplicate' };
		throw e;
	}
	return { ok: true };
}

/** OpenCritic の作品 ID を、正の整数として読む。読めなければ null。 */
function parseOcId(raw: string): number | null {
	if (!/^[1-9][0-9]*$/.test(raw)) return null;
	const n = Number(raw);
	return Number.isSafeInteger(n) ? n : null;
}

/**
 * 作品に OpenCritic の作品 ID を付ける（'' なら外す）。付けられるのは、ゲームの作品だけ（外すのは、分野を問わない）。
 * ID が変わる・外すときは、その作品の結果を消し、取得の日時と進み具合を null にする（別の作品の結果が残らないように）。同じ ID なら何もしない。
 */
export async function linkOpenCritic(db: D1Database, workId: string, ocId: string, _now: Date): Promise<{ ok: true } | { ok: false; error: CriticError }> {
	const raw = ocId.trim();
	const next = raw === '' ? null : parseOcId(raw);
	if (raw !== '' && next === null) return { ok: false, error: 'bad_oc_id' };

	const work = await db
		.prepare('SELECT opencritic_id, category FROM works WHERE id = ?')
		.bind(workId)
		.first<{ opencritic_id: number | null; category: string }>();
	if (!work) return { ok: false, error: 'not_found' };
	if (next !== null && work.category !== 'game') return { ok: false, error: 'not_game' };
	if (work.opencritic_id === next) return { ok: true };

	if (next !== null) {
		const taken = await db.prepare('SELECT 1 FROM works WHERE opencritic_id = ? AND id != ?').bind(next, workId).first();
		if (taken) return { ok: false, error: 'oc_id_taken' };
	}

	try {
		await db.batch([
			// critic_answers は ON DELETE CASCADE だが、外部キーの強制に頼らず、先に消す。
			db.prepare('DELETE FROM critic_answers WHERE critic_review_id IN (SELECT id FROM critic_reviews WHERE work_id = ?)').bind(workId),
			db.prepare('DELETE FROM critic_reviews WHERE work_id = ?').bind(workId),
			db
				.prepare('UPDATE works SET opencritic_id = ?, critic_synced_at = NULL, critic_cursor = NULL, critic_done_on = NULL WHERE id = ?')
				.bind(next, workId)
		]);
	} catch (e) {
		// 確かめたあとに、別の作品に同じ ID が付いたとき（works_opencritic）。
		if (String(e).includes('UNIQUE')) return { ok: false, error: 'oc_id_taken' };
		throw e;
	}
	return { ok: true };
}

/**
 * 取得する作品。ゲームで、公開中で、ID があり、now の UTC の日に、まだ読み切っていないもの
 * （critic_done_on が null か、その日より前）。途中のもの（critic_cursor が null でない）が先、
 * そのあと古い順（取得したことのないものが先）、id。
 */
export async function worksToSync(db: D1Database, limit: number, now: Date): Promise<WorkToSync[]> {
	const { results } = await db
		.prepare(
			`SELECT id, opencritic_id AS ocId, coalesce(critic_cursor, 0) AS cursor FROM works
			  WHERE category = 'game' AND status = 'active' AND opencritic_id IS NOT NULL
			    AND (critic_done_on IS NULL OR critic_done_on < ?)
			  ORDER BY critic_cursor IS NULL, critic_synced_at IS NOT NULL, critic_synced_at, id
			  LIMIT ?`
		)
		.bind(utcDay(now), limit)
		.all<WorkToSync>();
	return results;
}

/** 止まった作品の、続きのページを覚える。critic_synced_at と critic_done_on は、変えない。 */
export async function saveCriticCursor(db: D1Database, workId: string, cursor: number): Promise<void> {
	await db.prepare('UPDATE works SET critic_cursor = ? WHERE id = ?').bind(cursor, workId).run();
}

/**
 * 1 日 1 回の取得の、実行の権利を取る（day は UTC の日付）。その日の最初の 1 回だけ true。
 * 毎分の定期実行が重なっても、取得が 2 回動かないように。
 * B2 で消す（critic-sync.ts が claimCriticSlot に移るまで残す）。
 */
export async function claimDailyRun(db: D1Database, now: Date): Promise<boolean> {
	const result = await db
		.prepare('INSERT OR IGNORE INTO critic_runs (day, started_at) VALUES (?, ?)')
		.bind(utcDay(now), now.toISOString())
		.run();
	return result.meta.changes === 1;
}

/** その日は、もう選ばない（読み切った、または、失敗して諦めた）。cursor を消し、読み切った日と取得の日時を入れる。 */
export async function markSynced(db: D1Database, workId: string, now: Date): Promise<void> {
	await db
		.prepare('UPDATE works SET critic_cursor = NULL, critic_done_on = ?, critic_synced_at = ? WHERE id = ?')
		.bind(utcDay(now), now.toISOString(), workId)
		.run();
}

/**
 * 枠を取る。取れたら、その枠の割り当てを返す（枠の行を入れる）。
 * 割り当て = 各項目で min(perRun, daily - その日にほかの枠が使った分)。日は slot の先頭 10 文字。
 * 取れない場合（行は入れない）:
 *  - already_ran: その枠の行が、もうある。
 *  - stopped_today: その日の、ほかの枠が、unauthorized か rate_limited か reserve で終わっている。
 *  - daily_limit: 割り当ての calls か reads が 0（検索だけ残っていても、取らない）。
 * 残りの計算と挿入を 1 文にして、同時に取った枠の合計が daily を超えないようにする。
 */
export async function claimCriticSlot(
	db: D1Database,
	slot: string,
	now: Date,
	perRun: CriticAllowance,
	daily: CriticAllowance
): Promise<{ ok: true; allowance: CriticAllowance } | { ok: false; error: ClaimError }> {
	const day = slot.slice(0, 10);
	const halting = HALTING_STOPS.map(() => '?').join(', ');
	const claimed = await db
		.prepare(
			`INSERT OR IGNORE INTO critic_slots (slot, day, started_at, calls, searches, reads)
			 SELECT ?, ?, ?, min(?, ? - t.c), min(?, ? - t.s), min(?, ? - t.r)
			   FROM (SELECT coalesce(sum(calls), 0) AS c, coalesce(sum(searches), 0) AS s, coalesce(sum(reads), 0) AS r,
			                coalesce(sum(stopped IN (${halting})), 0) AS halted
			           FROM critic_slots WHERE day = ?) t
			  WHERE t.halted = 0 AND min(?, ? - t.c) > 0 AND min(?, ? - t.r) > 0
			 RETURNING calls, searches, reads`
		)
		.bind(
			slot,
			day,
			now.toISOString(),
			perRun.calls,
			daily.calls,
			perRun.searches,
			daily.searches,
			perRun.reads,
			daily.reads,
			...HALTING_STOPS,
			day,
			perRun.calls,
			daily.calls,
			perRun.reads,
			daily.reads
		)
		.first<CriticAllowance>();
	if (claimed) return { ok: true, allowance: { calls: claimed.calls, searches: claimed.searches, reads: claimed.reads } };

	// 取れなかったときだけ、理由を決める（already_ran → stopped_today → daily_limit の順）。
	const why = await db
		.prepare(
			`SELECT EXISTS (SELECT 1 FROM critic_slots WHERE slot = ?) AS taken,
			        EXISTS (SELECT 1 FROM critic_slots WHERE day = ? AND stopped IN (${halting})) AS halted`
		)
		.bind(slot, day, ...HALTING_STOPS)
		.first<{ taken: number; halted: number }>();
	if (why?.taken) return { ok: false, error: 'already_ran' };
	if (why?.halted) return { ok: false, error: 'stopped_today' };
	return { ok: false, error: 'daily_limit' };
}

/** 割り当てを、実際に使った数に直し、終わった理由を入れる。 */
export async function finishCriticSlot(db: D1Database, slot: string, used: CriticAllowance, stopped: CriticSlotStop): Promise<void> {
	await db
		.prepare('UPDATE critic_slots SET calls = ?, searches = ?, reads = ?, stopped = ? WHERE slot = ?')
		.bind(used.calls, used.searches, used.reads, stopped, slot)
		.run();
}

/** その日（UTC）に、枠の記録に入っている合計（割り当ての残りを含む）。 */
export async function criticDayTotals(db: D1Database, day: string): Promise<CriticAllowance> {
	const row = await db
		.prepare(
			`SELECT coalesce(sum(calls), 0) AS calls, coalesce(sum(searches), 0) AS searches, coalesce(sum(reads), 0) AS reads
			   FROM critic_slots WHERE day = ?`
		)
		.bind(day)
		.first<CriticAllowance>();
	return { calls: row?.calls ?? 0, searches: row?.searches ?? 0, reads: row?.reads ?? 0 };
}

export interface Candidate {
	workId: string;
	workName: string;
	ocId: number;
	ocName: string;
}

/** 候補を探す作品。ゲームで、公開中で、ID がなく、候補の行がなく、now の UTC の日に、まだ検索していないもの。 */
export async function worksNeedingCandidate(db: D1Database, limit: number, now: Date): Promise<{ id: string; name: string }[]> {
	const { results } = await db
		.prepare(
			`SELECT w.id, w.name FROM works w
			  WHERE w.category = 'game' AND w.status = 'active' AND w.opencritic_id IS NULL
			    AND NOT EXISTS (SELECT 1 FROM critic_candidates c WHERE c.work_id = w.id)
			    AND (w.critic_searched_on IS NULL OR w.critic_searched_on < ?)
			  ORDER BY w.created_at, w.id
			  LIMIT ?`
		)
		.bind(utcDay(now), limit)
		.all<{ id: string; name: string }>();
	return results;
}

/** 候補を検索した日（UTC）を入れる（見つからなくても）。その日は、もう検索しない。 */
export async function markSearched(db: D1Database, workId: string, now: Date): Promise<void> {
	await db.prepare('UPDATE works SET critic_searched_on = ? WHERE id = ?').bind(utcDay(now), workId).run();
}

/** 候補を足す。その作品の候補の行が、もうあれば、何もしない。 */
export async function addCandidate(db: D1Database, workId: string, game: OcGame, now: Date): Promise<void> {
	await db
		.prepare('INSERT OR IGNORE INTO critic_candidates (work_id, oc_id, oc_name, status, created_at) VALUES (?, ?, ?, ?, ?)')
		.bind(workId, game.id, game.name, 'open', now.toISOString())
		.run();
}

export async function openCandidates(db: D1Database): Promise<Candidate[]> {
	const { results } = await db
		.prepare(
			`SELECT c.work_id AS workId, w.name AS workName, c.oc_id AS ocId, c.oc_name AS ocName
			   FROM critic_candidates c JOIN works w ON w.id = c.work_id
			  WHERE c.status = 'open'
			  ORDER BY c.created_at, c.work_id`
		)
		.all<Candidate>();
	return results;
}

/** 作品に結びついている OpenCritic の作品 ID。なければ null（作品がなくても null）。 */
export async function getOpenCriticId(db: D1Database, workId: string): Promise<number | null> {
	const row = await db.prepare('SELECT opencritic_id AS ocId FROM works WHERE id = ?').bind(workId).first<{ ocId: number | null }>();
	return row?.ocId ?? null;
}

/** 候補を承認・却下する。承認は linkOpenCritic と同じ検査。 */
export async function decideCandidate(db: D1Database, workId: string, approve: boolean, now: Date): Promise<{ ok: true } | { ok: false; error: CriticError }> {
	const candidate = await db.prepare('SELECT oc_id FROM critic_candidates WHERE work_id = ?').bind(workId).first<{ oc_id: number }>();
	if (!candidate) return { ok: false, error: 'not_found' };
	if (approve) {
		const linked = await linkOpenCritic(db, workId, String(candidate.oc_id), now);
		if (!linked.ok) return linked;
	}
	await db
		.prepare('UPDATE critic_candidates SET status = ? WHERE work_id = ?')
		.bind(approve ? 'approved' : 'rejected', workId)
		.run();
	return { ok: true };
}

/** 作品ページに出す形。件数が 0 なら null。 */
export interface CriticSection {
	count: number;
	/** 段階ごとの確率の合計（ソフトな件数。星1〜星5）と、連続値の平均。観点を平均しない。 */
	overall: { soft: number[]; mean: number | null };
	/** 向きが「言及なし」でないものだけを数える。 */
	aspects: { aspect: string; label: string; n: number; soft: number[]; mean: number | null }[];
	/** 新しい順。最大 CRITIC_ITEMS_MAX。 */
	items: {
		outlet: string;
		url: string;
		publishedOn: string | null;
		overall: { direction: Direction; star: number | null };
		features: { aspect: string; label: string; direction: Direction; star: number | null }[];
	}[];
}

interface Star {
	score: number;
	levels: number[] | null;
}

/** 1件のレビューの、観点ごとの向きと星。 */
interface ReadAnswers {
	directions: Map<string, Direction>;
	stars: Map<string, Star>;
}

function parseStar(json: string | null): Star | null {
	if (!json) return null;
	const v = JSON.parse(json) as { score?: unknown; levels?: unknown };
	if (typeof v.score !== 'number') return null;
	return { score: v.score, levels: Array.isArray(v.levels) ? (v.levels as number[]) : null };
}

/**
 * 作品ページの欄。aspects は、観点の表示名（この順で出す。'overall' は総合）。
 * 集計の対象は、その観点の向きが「言及なし」でなく、星の答えがあるレビュー。
 * soft は、段階ごとの確率の合計（段階の確率が読めなかった答えは、足さない）。mean は、星の連続値の平均。
 */
export async function criticSection(db: D1Database, workId: string, aspects: { key: string; label: string }[]): Promise<CriticSection | null> {
	const { results: reviews } = await db
		.prepare(
			`SELECT id, outlet, url, published_on AS publishedOn FROM critic_reviews
			  WHERE work_id = ?
			  ORDER BY published_on IS NULL, published_on DESC, read_at DESC, id`
		)
		.bind(workId)
		.all<{ id: string; outlet: string; url: string; publishedOn: string | null }>();
	if (reviews.length === 0) return null;

	const { results: rows } = await db
		.prepare(
			`SELECT a.critic_review_id AS reviewId, a.aspect, a.kind, a.value, a.probs_json AS probsJson
			   FROM critic_answers a JOIN critic_reviews r ON r.id = a.critic_review_id
			  WHERE r.work_id = ? AND a.kind IN ('direction', 'star')`
		)
		.bind(workId)
		.all<{ reviewId: string; aspect: string; kind: 'direction' | 'star'; value: string; probsJson: string | null }>();

	const byReview = new Map<string, ReadAnswers>();
	for (const r of reviews) byReview.set(r.id, { directions: new Map(), stars: new Map() });
	for (const row of rows) {
		const read = byReview.get(row.reviewId)!;
		if (row.kind === 'direction') read.directions.set(row.aspect, row.value as Direction);
		else {
			const star = parseStar(row.probsJson);
			if (star) read.stars.set(row.aspect, star);
		}
	}

	const summarize = (aspect: string) => {
		const soft: number[] = Array(STAR_LEVELS).fill(0);
		let n = 0;
		let total = 0;
		for (const read of byReview.values()) {
			const direction = read.directions.get(aspect);
			const star = read.stars.get(aspect);
			if (!direction || direction === 'none' || !star) continue;
			n += 1;
			total += star.score;
			star.levels?.slice(0, STAR_LEVELS).forEach((p, i) => (soft[i] += p));
		}
		return { n, soft, mean: n > 0 ? total / n : null };
	};

	const overall = summarize('overall');
	const features = aspects.filter((a) => a.key !== 'overall');
	return {
		count: reviews.length,
		overall: { soft: overall.soft, mean: overall.mean },
		aspects: features
			.map((a) => ({ aspect: a.key, label: a.label, ...summarize(a.key) }))
			.filter((a) => a.n > 0),
		items: reviews.slice(0, CRITIC_ITEMS_MAX).map((r) => {
			const read = byReview.get(r.id)!;
			return {
				outlet: r.outlet,
				url: r.url,
				publishedOn: r.publishedOn,
				overall: { direction: read.directions.get('overall') ?? 'none', star: read.stars.get('overall')?.score ?? null },
				features: features
					.filter((a) => (read.directions.get(a.key) ?? 'none') !== 'none')
					.map((a) => ({
						aspect: a.key,
						label: a.label,
						direction: read.directions.get(a.key)!,
						star: read.stars.get(a.key)?.score ?? null
					}))
			};
		})
	};
}
