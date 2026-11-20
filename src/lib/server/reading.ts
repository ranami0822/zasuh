import type { D1Database } from '@cloudflare/workers-types';
import { ClefError, type ClefClient } from './clef';
import { toClefQuestions } from './question-sets';
import type { Category, Direction, Question } from './question-sets/types';
import { resolveWorkQuestionSet, type TagRegistry } from './tags';
import { recomputeWorkStats } from './stats';

/** 1つの版を読む回数の上限。超えたら、自動ではやり直さない。 */
export const MAX_ATTEMPTS = 6;
/** 読み取り中の印の有効期間。処理が途中で止まっても、これを過ぎればやり直せる。 */
export const LEASE_MS = 5 * 60_000;

const MINUTE = 60_000;
/**
 * n 回目の失敗のあと、次に試すまでの間隔。
 * 最後は24時間あける。Workers AI の1日の利用枠を使い切ると、枠が戻るまで失敗が続くので、
 * 短い間隔だけで回数を使い切ると、枠が戻っても読まれないままになる。
 */
const BACKOFF_MS = [2 * MINUTE, 15 * MINUTE, 60 * MINUTE, 6 * 60 * MINUTE, 24 * 60 * MINUTE];

export function backoffMs(attempts: number): number {
	return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
}

/**
 * 「要確認」の印を付ける閾値。
 * 未検証の初期値（docs/mvp-design.md の 3.1）。印は保存するだけで、集計や表示には使っていない。
 * 確率そのものも保存しているので、閾値を変えたら、印は作り直せる。
 */
export const CHECK_TOP_PROB = 0.8;
export const CHECK_MENTION_RANGE: readonly [number, number] = [0.3, 0.7];

/** 星（score）の答え。段階は、1（いちばん低い）から levels の数（いちばん高い）まで。 */
export interface StarAnswer {
	/** 確率で重み付けした段階。段階の間の値も取る（1〜段階の数）。 */
	score: number;
	/** 段階ごとの確率（低い順）。Clef が返す形を読めなかったときは null。 */
	levels: number[] | null;
	confidence: number | null;
}

export interface ReadingAnswer {
	questionKey: string;
	aspect: string;
	kind: 'direction' | 'mention' | 'star';
	/** direction: positive / negative / mixed / none。mention: true / false。star: 四捨五入した段階（'1'〜）。 */
	value: string;
	/** direction: 選ばれた向きの確率。mention: 具体的な記述がある確率。star: 四捨五入した段階の確率（読めなければ 0）。 */
	prob: number;
	/** direction のみ: 向きごとの確率。 */
	probs: Record<Direction, number> | null;
	/** star のみ。 */
	star?: StarAnswer;
	needsCheck: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

function isProb(v: unknown): v is number {
	return typeof v === 'number' && v >= 0 && v <= 1;
}

/**
 * score の `probabilities` を、段階ごとの確率の配列（低い順）に直す。
 * 未確認: 公式のスキーマは「段階ごと」としか書いていない（experiments/clef-mention/README.md の第7弾）。
 * 実際の応答で確かめるまでは、配列、または、段階の番号（0〜）か説明文をキーにした辞書を、受け付ける。読めなければ null。
 */
function levelProbabilities(raw: unknown, levels: string[]): number[] | null {
	const n = levels.length;
	let values: unknown[] | null = null;
	if (Array.isArray(raw)) values = raw;
	else if (isRecord(raw)) {
		const byIndex = levels.map((_, i) => raw[String(i)]);
		const byText = levels.map((text) => raw[text]);
		values = byIndex.every(isProb) ? byIndex : byText.every(isProb) ? byText : null;
	}
	return values && values.length === n && values.every(isProb) ? (values as number[]) : null;
}

/**
 * Clef の答えを検証して、保存する形に直す。
 * 質問セットのすべての質問に、決まった形の答えがなければエラーにする（一部だけ保存しない）。
 */
export function interpretAnswers(
	def: { questions: Question[] },
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

		if (q.kind === 'star') {
			const raw = answer.score;
			const top = q.levels.length - 1;
			// 範囲は、公式の説明（0〜段階の数 - 1）。少しの誤差は許す。
			if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < -1e-6 || raw > top + 1e-6) bad(q.key);
			const score = Math.min(top, Math.max(0, raw as number)) + 1;
			const rounded = Math.round(score);
			const levels = levelProbabilities(answer.probabilities, q.levels);
			out.push({
				questionKey: q.key,
				aspect: q.aspect,
				kind: 'star',
				value: String(rounded),
				prob: levels ? levels[rounded - 1] : 0,
				probs: null,
				star: { score, levels, confidence: isProb(answer.confidence) ? answer.confidence : null },
				needsCheck: false
			});
			continue;
		}

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
	/** テスト用。省くと、コードに登録されたタグを使う。 */
	registry?: TagRegistry;
	/** すぐにやり直す前の待ち時間（テスト用に変えられる）。 */
	quickRetryDelayMs?: number;
}

export type ReadOutcome =
	| { status: 'ok'; readingId: string }
	| { status: 'error'; readingId: string; error: string }
	| { status: 'skipped'; reason: 'not_found' | 'no_question_set' | 'busy_or_done' };

/**
 * レビューの1つの版を、その作品のいまのタグの質問で読んで、答えを保存する。
 * 一度読めた版は、タグが変わっても読み直さない。
 * 同じ版を同時に2つの処理が読まないよう、最初に readings の行を「読み取り中」にして確保する。
 * 成功したら、その作品の集計を作り直す。
 */
export async function readRevision(deps: ReadingDeps, revisionId: string): Promise<ReadOutcome> {
	const { db, clef } = deps;
	const now = deps.now ?? (() => new Date());

	const target = await db
		.prepare(
			`SELECT v.body AS body, r.work_id AS workId, w.category AS category,
			        EXISTS (SELECT 1 FROM readings rd WHERE rd.revision_id = v.id AND rd.status = 'ok') AS done
			   FROM review_revisions v
			   JOIN reviews r ON r.id = v.review_id
			   JOIN works w ON w.id = r.work_id
			  WHERE v.id = ?`
		)
		.bind(revisionId)
		.first<{ body: string; workId: string; category: Category; done: number }>();
	if (!target) return { status: 'skipped', reason: 'not_found' };
	if (target.done) return { status: 'skipped', reason: 'busy_or_done' };

	const questionSet = await resolveWorkQuestionSet(
		db,
		{ id: target.workId, category: target.category },
		now(),
		deps.registry
	);
	if (!questionSet) return { status: 'skipped', reason: 'no_question_set' };
	const tagByKey = new Map(questionSet.definitions.map((t) => [t.key, t]));

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
			questionSet.model,
			new Date(claimedAt.getTime() + LEASE_MS).toISOString(),
			claimedAt.toISOString(),
			MAX_ATTEMPTS
		)
		.first<{ id: string; attempts: number }>();
	if (!claim) return { status: 'skipped', reason: 'busy_or_done' };

	try {
		const started = Date.now();
		const questions = toClefQuestions(questionSet);
		let result;
		try {
			result = await clef.run(questionSet.model, target.body, questions);
		} catch (e) {
			// すぐに直りうる失敗（5xx、通信の失敗）は、その場で1回だけやり直す。それでも失敗したら、定期実行に任せる。
			if (!(e instanceof ClefError) || !e.retryable) throw e;
			await new Promise((r) => setTimeout(r, deps.quickRetryDelayMs ?? 500));
			result = await clef.run(questionSet.model, target.body, questions);
		}
		const latencyMs = Date.now() - started;
		const answers = interpretAnswers(questionSet, result.answers);

		const insert = db.prepare(
			`INSERT INTO reading_answers
			   (reading_id, question_key, tag_id, tag_version, kind, value, prob, probs_json, needs_check)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		await db.batch([
			db.prepare('DELETE FROM reading_answers WHERE reading_id = ?').bind(claim.id),
			...answers.map((a) =>
				insert.bind(
					claim.id,
					a.questionKey,
					tagByKey.get(a.aspect)!.id,
					tagByKey.get(a.aspect)!.version,
					a.kind,
					a.value,
					a.prob,
					a.probs ? JSON.stringify(a.probs) : a.star ? JSON.stringify(a.star) : null,
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

	await recomputeWorkStats(db, target.workId, now(), deps.registry);
	return { status: 'ok', readingId: claim.id };
}
