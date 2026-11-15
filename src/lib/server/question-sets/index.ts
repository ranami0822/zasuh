import type { D1Database } from '@cloudflare/workers-types';
import { gameV1 } from './game-v1';
import type { Category, QuestionSetDefinition } from './types';

export type * from './types';

/** すべての質問セット。新しい版は、ここに追加する（既存の定義は書き換えない）。 */
export const QUESTION_SETS: QuestionSetDefinition[] = [gameV1];

/** その分野の最新の版。質問セットがまだない分野（ソフトウェア）は null。 */
export function latestDefinition(
	category: Category,
	sets: QuestionSetDefinition[] = QUESTION_SETS
): QuestionSetDefinition | null {
	const candidates = sets.filter((s) => s.category === category);
	if (candidates.length === 0) return null;
	return candidates.reduce((a, b) => (b.version > a.version ? b : a));
}

/** Clef に渡す質問の形。キーの順序が、質問の順序になる。 */
export interface ClefQuestion {
	type: 'choice' | 'noul';
	instructions: string;
	criteria: Record<string, string>;
}

export function toClefQuestions(def: QuestionSetDefinition): Record<string, ClefQuestion> {
	const out: Record<string, ClefQuestion> = {};
	for (const q of def.questions) {
		out[q.key] =
			q.kind === 'direction'
				? {
						type: 'choice',
						instructions: q.instructions,
						criteria: Object.fromEntries(q.options.map((o) => [o.id, o.description]))
					}
				: { type: 'noul', instructions: q.instructions, criteria: { ...q.criteria } };
	}
	return out;
}

export async function definitionHash(def: QuestionSetDefinition): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(def));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ResolvedQuestionSet {
	id: number;
	definition: QuestionSetDefinition;
}

/**
 * その分野の現行の質問セットを、データベースの行と対応づけて返す。
 * 行がなければ作る。同じ版なのに定義が変わっていたら、エラーにする
 * （過去の読み取り結果と意味がずれるので、版を上げずに定義を変えてはいけない）。
 */
export async function resolveQuestionSet(
	db: D1Database,
	category: Category,
	now: Date,
	sets: QuestionSetDefinition[] = QUESTION_SETS
): Promise<ResolvedQuestionSet | null> {
	const definition = latestDefinition(category, sets);
	if (!definition) return null;

	const hash = await definitionHash(definition);
	const select = db
		.prepare('SELECT id, definition_hash FROM question_sets WHERE category = ? AND version = ?')
		.bind(category, definition.version);

	let row = await select.first<{ id: number; definition_hash: string }>();
	if (!row) {
		await db
			.prepare(
				`INSERT OR IGNORE INTO question_sets
				   (category, version, model, definition_json, definition_hash, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.bind(
				category,
				definition.version,
				definition.model,
				JSON.stringify(definition),
				hash,
				now.toISOString()
			)
			.run();
		row = await select.first<{ id: number; definition_hash: string }>();
	}
	if (!row) throw new Error(`質問セット ${category} v${definition.version} を保存できませんでした`);
	if (row.definition_hash !== hash) {
		throw new Error(
			`質問セット ${category} v${definition.version} の定義が、保存済みのものと違います。` +
				'定義を変えるときは、版を上げて新しい定義として追加してください。'
		);
	}
	return { id: row.id, definition };
}
