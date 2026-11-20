import { gameV1 } from './game-v1';
import type { Category, Question, QuestionSetDefinition } from './types';

export type * from './types';

/**
 * 実験と評価（scripts/）で使う、分野ごとの質問セット。
 * 本番の読み取りは、作品のタグから質問を組み立てる（../tags.ts）。ゲームの分野のタグは、gameV1 から作っている。
 */
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
	type: 'choice' | 'noul' | 'score';
	instructions: string;
	/** choice・noul: 選択肢の名前 → 説明。score: 段階の説明（低い順の配列）。 */
	criteria: Record<string, string> | string[];
}

export function toClefQuestions(def: { questions: Question[] }): Record<string, ClefQuestion> {
	const out: Record<string, ClefQuestion> = {};
	for (const q of def.questions) {
		if (q.kind === 'star') {
			out[q.key] = { type: 'score', instructions: q.instructions, criteria: [...q.levels] };
		} else if (q.kind === 'direction') {
			out[q.key] = {
				type: 'choice',
				instructions: q.instructions,
				criteria: Object.fromEntries(q.options.map((o) => [o.id, o.description]))
			};
		} else {
			out[q.key] = { type: 'noul', instructions: q.instructions, criteria: { ...q.criteria } };
		}
	}
	return out;
}

export async function definitionHash(def: QuestionSetDefinition): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(def));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
