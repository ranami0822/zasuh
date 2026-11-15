import type { D1Database } from '@cloudflare/workers-types';
import { ClefError, type ClefClient } from './clef';
import { resolveQuestionSet, toClefQuestions } from './question-sets';
import type { Direction, QuestionSetDefinition } from './question-sets/types';
import { recomputeWorkStats } from './stats';

/** 1つの版を読む回数の上限。超えたら、自動ではやり直さない。 */
export const MAX_ATTEMPTS = 5;
/** 読み取り中の印の有効期間。処理が途中で止まっても、これを過ぎればやり直せる。 */
export const LEASE_MS = 5 * 60_000;

/** n 回目の失敗のあと、次に試すまでの間隔（2分、4分、8分、16分）。 */
export function backoffMs(attempts: number): number {
	return Math.min(2 ** attempts, 60) * 60_000;
}

/**
 * 「要確認」の印を付ける閾値。
 * 未検証の初期値（docs/mvp-design.md の 3.1）。印は保存するだけで、集計や表示には使っていない。
 * 確率そのものも保存しているので、閾値を変えたら、印は作り直せる。
 */
export const CHECK_TOP_PROB = 0.8;
export const CHECK_MENTION_RANGE: readonly [number, number] = [0.3, 0.7];

export interface ReadingAnswer {
	questionKey: string;
	aspect: string;
	kind: 'direction' | 'mention';
	/** direction: positive / negative / mixed / none。mention: true / false。 */
	value: string;
	/** direction: 選ばれた向きの確率。mention: 具体的な記述がある確率。 */
	prob: number;
	/** direction のみ: 向きごとの確率。 */
	probs: Record<Direction, number> | null;
	needsCheck: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

function isProb(v: unknown): v is number {
	return typeof v === 'number' && v >= 0 && v <= 1;
}

/**
 * Clef の答えを検証して、保存する形に直す。
 * 質問セットのすべての質問に、決まった形の答えがなければエラーにする（一部だけ保存しない）。
 */
export function interpretAnswers(
	def: QuestionSetDefinition,
	answers: Record<string, unknown>
): ReadingAnswer[] {
	const bad = (key: string): never => {
		throw new ClefError(`Clef の答えの形が想定と違います: ${key}`, false);
	};

	const out: ReadingAnswer[] = [];
	for (const q of def.questions) {
		const a = answers[q.key];
		if (!isRecord(a)) bad(q.key);
		const answer = a as Record<string, unknown>;

		if (q.kind === 'mention') {
			const p = answer.noul;
			if (!isProb(p)) bad(q.key);
			out.push({
				questionKey: q.key,
				aspect: q.aspect,
				kind: 'mention',
				value: (p as number) >= 0.5 ? 'true' : 'false',
				prob: p as number,
				probs: null,
				needsCheck: false
			});
			continue;
		}

		const chosen = q.options.find((o) => o.id === answer.choice);
		const raw = answer.probabilities;
		if (!chosen || !isRecord(raw)) bad(q.key);
		const probs = {} as Record<Direction, number>;
		for (const o of q.options) {
			const p = (raw as Record<string, unknown>)[o.id];
			if (!isProb(p)) bad(q.key);
			probs[o.value] = p as number;
		}
		out.push({
			questionKey: q.key,
			aspect: q.aspect,
			kind: 'direction',
			value: chosen!.value,
			prob: probs[chosen!.value],
			probs,
			needsCheck: false
		});
	}

	// 要確認: 向きの確率が低い、言及の確率がどっちつかず、向きと言及が食い違う。
	const mention = new Map(out.filter((a) => a.kind === 'mention').map((a) => [a.aspect, a.prob]));
	for (const a of out) {
		if (a.kind !== 'direction') continue;
		const m = mention.get(a.aspect);
		a.needsCheck =
			a.prob < CHECK_TOP_PROB ||
			(m !== undefined &&
				((m >= CHECK_MENTION_RANGE[0] && m <= CHECK_MENTION_RANGE[1]) ||
					m >= 0.5 !== (a.value !== 'none')));
	}
	return out;
}

export interface ReadingDeps {
	db: D1Database;
	clef: ClefClient;
	now?: () => Date;
	/** テスト用。省くと、コードに登録された質問セットを使う。 */
	questionSets?: QuestionSetDefinition[];
	/** すぐにやり直す前の待ち時間（テスト用に変えられる）。 */
	quickRetryDelayMs?: number;
}

export type ReadOutcome =
	| { status: 'ok'; readingId: string }
	| { status: 'error'; readingId: string; error: string }
	| { status: 'skipped'; reason: 'not_found' | 'no_question_set' | 'busy_or_done' };

/**
 * レビューの1つの版を、その分野の現行の質問セットで読んで、答えを保存する。
 * 同じ版を同時に2つの処理が読まないよう、最初に readings の行を「読み取り中」にして確保する。
 * 成功したら、その作品の集計を作り直す。
 */
export async function readRevision(deps: ReadingDeps, revisionId: string): Promise<ReadOutcome> {
	const { db, clef } = deps;
	const now = deps.now ?? (() => new Date());

	const target = await db
		.prepare(
			`SELECT v.body AS body, r.work_id AS workId, w.category AS category
			   FROM review_revisions v
			   JOIN reviews r ON r.id = v.review_id
			   JOIN works w ON w.id = r.work_id
			  WHERE v.id = ?`
		)
		.bind(revisionId)
		.first<{ body: string; workId: string; category: 'game' | 'software' }>();
	if (!target) return { status: 'skipped', reason: 'not_found' };

	const questionSet = await resolveQuestionSet(db, target.category, now(), deps.questionSets);
	if (!questionSet) return { status: 'skipped', reason: 'no_question_set' };
	const { definition } = questionSet;

	const claimedAt = now();
	const claim = await db
		.prepare(
			`INSERT INTO readings
			   (id, revision_id, question_set_id, model, status, attempts, next_attempt_at, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, 'running', 1, ?5, ?6, ?6)
			 ON CONFLICT (revision_id, question_set_id) DO UPDATE SET
			   status = 'running',
			   attempts = readings.attempts + 1,
			   next_attempt_at = excluded.next_attempt_at,
			   updated_at = excluded.updated_at
			 WHERE readings.status != 'ok'
			   AND readings.attempts < ?7
			   AND (readings.next_attempt_at IS NULL OR readings.next_attempt_at <= ?6)
			 RETURNING id, attempts`
		)
		.bind(
			crypto.randomUUID(),
			revisionId,
			questionSet.id,
			definition.model,
			new Date(claimedAt.getTime() + LEASE_MS).toISOString(),
			claimedAt.toISOString(),
			MAX_ATTEMPTS
		)
		.first<{ id: string; attempts: number }>();
	if (!claim) return { status: 'skipped', reason: 'busy_or_done' };

	try {
		const started = Date.now();
		const questions = toClefQuestions(definition);
		let result;
		try {
			result = await clef.run(definition.model, target.body, questions);
		} catch (e) {
			// 一時的な失敗は、その場で1回だけやり直す。それでも失敗したら、定期実行に任せる。
			if (!(e instanceof ClefError) || !e.retryable) throw e;
			await new Promise((r) => setTimeout(r, deps.quickRetryDelayMs ?? 500));
			result = await clef.run(definition.model, target.body, questions);
		}
		const latencyMs = Date.now() - started;
		const answers = interpretAnswers(definition, result.answers);

		const insert = db.prepare(
			`INSERT INTO reading_answers
			   (reading_id, question_key, aspect, kind, value, prob, probs_json, needs_check)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		);
		await db.batch([
			db.prepare('DELETE FROM reading_answers WHERE reading_id = ?').bind(claim.id),
			...answers.map((a) =>
				insert.bind(
					claim.id,
					a.questionKey,
					a.aspect,
					a.kind,
					a.value,
					a.prob,
					a.probs ? JSON.stringify(a.probs) : null,
					a.needsCheck ? 1 : 0
				)
			),
			db
				.prepare(
					`UPDATE readings
					    SET status = 'ok', next_attempt_at = NULL, error = NULL,
					        latency_ms = ?, input_tokens = ?, updated_at = ?
					  WHERE id = ?`
				)
				.bind(latencyMs, result.inputTokens, now().toISOString(), claim.id)
		]);
	} catch (e) {
		const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
		const failedAt = now();
		await db
			.prepare(
				// 自分が確保した回のままのときだけ、失敗を記録する。
				// 期限切れのあとで別の処理が読み直していたら、その結果を上書きしない。
				`UPDATE readings
				    SET status = 'error', error = ?, next_attempt_at = ?, updated_at = ?
				  WHERE id = ? AND status = 'running' AND attempts = ?`
			)
			.bind(
				message,
				new Date(failedAt.getTime() + backoffMs(claim.attempts)).toISOString(),
				failedAt.toISOString(),
				claim.id,
				claim.attempts
			)
			.run();
		return { status: 'error', readingId: claim.id, error: message };
	}

	await recomputeWorkStats(db, target.workId, questionSet, now());
	return { status: 'ok', readingId: claim.id };
}
