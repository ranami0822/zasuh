import type { D1Database } from '@cloudflare/workers-types';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';
import type { ClefClient, ClefResult } from '../clef';
import { gameV1 } from '../question-sets/game-v1';
import type { Category, Direction, QuestionSetDefinition } from '../question-sets/types';

/** テスト用の D1（workerd の SQLite。本番の D1 と同じ実装）に、migrations/ をすべて適用して返す。 */
export async function createTestDb(): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
	// miniflare 5 は設定の形が変わったので、従来の形から変換して渡す。
	const mf = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: 'export default { fetch() { return new Response(null, { status: 404 }); } }',
			d1Databases: ['DB']
		})
	);
	const db = (await mf.getD1Database('DB')) as unknown as D1Database;
	for (const file of readdirSync('migrations').sort()) {
		const statements = readFileSync(`migrations/${file}`, 'utf8')
			.split('\n')
			.filter((line) => !line.trim().startsWith('--'))
			.join('\n')
			.split(';')
			.map((s) => s.trim())
			.filter(Boolean);
		await db.batch(statements.map((s) => db.prepare(s)));
	}
	return { db, dispose: () => mf.dispose() };
}

/** 進められる時計。 */
export function createClock(start = '2026-11-15T00:00:00.000Z') {
	let t = new Date(start).getTime();
	return {
		now: () => new Date(t),
		advance: (ms: number) => {
			t += ms;
		}
	};
}

export async function addWork(
	db: D1Database,
	opts: { category?: Category; name?: string; status?: 'active' | 'hidden' } = {}
): Promise<string> {
	const id = crypto.randomUUID();
	await db
		.prepare('INSERT INTO works (id, slug, name, category, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(id, id, opts.name ?? id, opts.category ?? 'game', opts.status ?? 'active', '2026-11-01T00:00:00.000Z')
		.run();
	return id;
}

export async function addReview(
	db: D1Database,
	workId: string,
	opts: { body?: string; disclosure?: string; hidden?: boolean; at?: Date } = {}
): Promise<{ reviewId: string; revisionId: string }> {
	const reviewerId = crypto.randomUUID();
	const reviewId = crypto.randomUUID();
	const revisionId = crypto.randomUUID();
	const at = (opts.at ?? new Date('2026-11-14T00:00:00.000Z')).toISOString();
	await db.batch([
		db.prepare("INSERT INTO reviewers (id, kind, created_at) VALUES (?, 'anon', ?)").bind(reviewerId, at),
		db
			.prepare(
				`INSERT INTO reviews
				   (id, work_id, reviewer_id, current_revision_id, written_on, disclosure, hidden, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(reviewId, workId, reviewerId, revisionId, at.slice(0, 10), opts.disclosure ?? 'none', opts.hidden ? 1 : 0, at),
		db
			.prepare('INSERT INTO review_revisions (id, review_id, body, created_at) VALUES (?, ?, ?, ?)')
			.bind(revisionId, reviewId, opts.body ?? '', at)
	]);
	return { reviewId, revisionId };
}

/** レビューを編集する（新しい版を足して、最新の版にする）。 */
export async function editReview(db: D1Database, reviewId: string, body: string, at: Date): Promise<string> {
	const revisionId = crypto.randomUUID();
	await db.batch([
		db
			.prepare('INSERT INTO review_revisions (id, review_id, body, created_at) VALUES (?, ?, ?, ?)')
			.bind(revisionId, reviewId, body, at.toISOString()),
		db.prepare('UPDATE reviews SET current_revision_id = ? WHERE id = ?').bind(revisionId, reviewId)
	]);
	return revisionId;
}

/** 観点ごとの向きから、Clef の応答と同じ形の答えを作る（指定のない観点は「言及なし」）。 */
export function clefAnswers(
	directions: Partial<Record<string, Direction>>,
	def: QuestionSetDefinition = gameV1
): Record<string, unknown> {
	const answers: Record<string, unknown> = {};
	for (const q of def.questions) {
		const dir = directions[q.aspect] ?? 'none';
		if (q.kind === 'direction') {
			answers[q.key] = {
				type: 'choice',
				choice: q.options.find((o) => o.value === dir)!.id,
				probabilities: Object.fromEntries(q.options.map((o) => [o.id, o.value === dir ? 0.94 : 0.02])),
				confidence: 0.9
			};
		} else {
			answers[q.key] = { type: 'noul', noul: dir === 'none' ? 0.03 : 0.97 };
		}
	}
	return answers;
}

/**
 * 偽の Clef。本文を受け取って、応答（または投げるエラー）を返す関数を渡す。
 * 既定では、本文を JSON として読み、観点ごとの向きとして扱う（例: '{"gameplay":"positive"}'）。
 */
export function fakeClef(
	respond: (state: string, call: number) => ClefResult | Promise<ClefResult> = (state) => ({
		answers: clefAnswers(state ? JSON.parse(state) : {}),
		inputTokens: 1700
	})
): ClefClient & { calls: { model: string; state: string; questionKeys: string[] }[] } {
	const calls: { model: string; state: string; questionKeys: string[] }[] = [];
	return {
		calls,
		async run(model, state, questions) {
			calls.push({ model, state, questionKeys: Object.keys(questions) });
			return respond(state, calls.length);
		}
	};
}
