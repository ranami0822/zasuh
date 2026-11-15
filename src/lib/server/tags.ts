import type { D1Database } from '@cloudflare/workers-types';
import { gameV1 } from './question-sets/game-v1';
import type { Category, ClefModel, Question } from './question-sets/types';

/**
 * タグ。作品のどこを見るか（例: ゲーム性）を表し、そのための質問を持つ。
 * 質問の文面を少しでも変えるときは、version を上げて、新しい定義として追加する（既存の定義は書き換えない）。
 */
export interface TagDefinition {
	/** 公開の名前（例: 'game/gameplay'）。 */
	id: string;
	/** 質問のキーの先頭に使う短い名前（例: 'gameplay'）。全タグで重ならないこと。 */
	key: string;
	version: number;
	label: string;
	/** 向きの質問と、言及の質問。質問の aspect は、このタグの key。 */
	questions: Question[];
}

export interface TagRegistry {
	tags: TagDefinition[];
	/** 分野のタグ。その分野の作品に、自動で付く。 */
	domainTags: Record<Category, string[]>;
}

/** 読み取りに使うモデル。 */
export const MODEL: ClefModel = 'clef-flash';
/** 1回の問い合わせに入れられる質問の数（Clef の上限）。1タグ2問なので、1作品のタグは32個まで。 */
export const MAX_QUESTIONS = 64;

// ゲームの分野のタグは、実験で確かめた質問セット（gameV1）を、観点ごとに分けたもの。文面は同じ。
const gameTags: TagDefinition[] = gameV1.aspects.map((a) => ({
	id: `game/${a.key}`,
	key: a.key,
	version: 1,
	label: a.label,
	questions: gameV1.questions.filter((q) => q.aspect === a.key)
}));

/** すべてのタグ。新しいタグと、新しい版は、ここに追加する。 */
export const REGISTRY: TagRegistry = {
	tags: gameTags,
	domainTags: { game: gameTags.map((t) => t.id), software: [] }
};

function latest(registry: TagRegistry, id: string): TagDefinition {
	const versions = registry.tags.filter((t) => t.id === id);
	if (versions.length === 0) throw new Error(`タグ ${id} の定義がありません`);
	return versions.reduce((a, b) => (b.version > a.version ? b : a));
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 質問セット: 1回の問い合わせに入れる、タグの組と、質問の並び。 */
export interface ComposedQuestionSet {
	model: ClefModel;
	tags: { id: string; version: number }[];
	questions: Question[];
}

/** タグを、渡された順に並べて、1回の問い合わせに入れる質問にまとめる。 */
export function composeQuestionSet(tags: TagDefinition[]): ComposedQuestionSet {
	const questions = tags.flatMap((t) => t.questions);
	if (questions.length > MAX_QUESTIONS) {
		throw new Error(`質問が ${questions.length} 問あります。1回に入れられるのは ${MAX_QUESTIONS} 問までです`);
	}
	const keys = new Set(questions.map((q) => q.key));
	if (keys.size !== questions.length) throw new Error('質問のキーが重なっています');
	return { model: MODEL, tags: tags.map(({ id, version }) => ({ id, version })), questions };
}

/** 作品に付いているタグ（分野のタグ、そのあとに作品が選んだタグ）。それぞれ最新の版。 */
export async function workTags(
	db: D1Database,
	work: { id: string; category: Category },
	registry: TagRegistry = REGISTRY
): Promise<TagDefinition[]> {
	const { results } = await db
		.prepare('SELECT tag_id FROM work_tags WHERE work_id = ? ORDER BY position, tag_id')
		.bind(work.id)
		.all<{ tag_id: string }>();
	const ids = [...registry.domainTags[work.category], ...results.map((r) => r.tag_id)];
	return [...new Set(ids)].map((id) => latest(registry, id));
}

/**
 * 作品が選ぶタグを、入れ替える。分野のタグは自動で付くので、ここには含めない。
 * すでに読んだレビューは、読み直さない。これから読むレビューに、新しい組が使われる。
 */
export async function setWorkTags(
	db: D1Database,
	work: { id: string; category: Category },
	tagIds: string[],
	now: Date,
	registry: TagRegistry = REGISTRY
): Promise<void> {
	const domain = registry.domainTags[work.category];
	const ids = [...new Set(tagIds)].filter((id) => !domain.includes(id));
	composeQuestionSet([...domain, ...ids].map((id) => latest(registry, id))); // 定義の有無と、質問の数を確かめる
	const insert = db.prepare('INSERT INTO work_tags (work_id, tag_id, position, created_at) VALUES (?, ?, ?, ?)');
	await db.batch([
		db.prepare('DELETE FROM work_tags WHERE work_id = ?').bind(work.id),
		...ids.map((id, i) => insert.bind(work.id, id, i, now.toISOString()))
	]);
}

/**
 * タグの定義を、データベースの記録と照らす。記録がなければ残す。
 * 同じ版なのに定義が変わっていたら、エラーにする（過去の読み取り結果と意味がずれるため）。
 */
async function verifyTags(db: D1Database, tags: TagDefinition[], now: Date): Promise<void> {
	const { results } = await db
		.prepare(`SELECT id, version, definition_hash FROM tags WHERE id IN (${tags.map(() => '?').join(', ')})`)
		.bind(...tags.map((t) => t.id))
		.all<{ id: string; version: number; definition_hash: string }>();
	const missing = [];
	for (const tag of tags) {
		const json = JSON.stringify(tag);
		const hash = await sha256(json);
		const row = results.find((r) => r.id === tag.id && r.version === tag.version);
		if (!row) {
			missing.push(
				db
					.prepare(
						'INSERT OR IGNORE INTO tags (id, version, definition_json, definition_hash, created_at) VALUES (?, ?, ?, ?, ?)'
					)
					.bind(tag.id, tag.version, json, hash, now.toISOString())
			);
		} else if (row.definition_hash !== hash) {
			throw new Error(
				`タグ ${tag.id} v${tag.version} の定義が、保存済みのものと違います。` +
					'定義を変えるときは、版を上げて新しい定義として追加してください。'
			);
		}
	}
	if (missing.length > 0) await db.batch(missing);
}

export interface ResolvedQuestionSet extends ComposedQuestionSet {
	/** question_sets の id。 */
	id: number;
	definitions: TagDefinition[];
}

/**
 * 作品の、いまのタグから質問セットを作り、データベースの行と対応づけて返す。
 * タグが1つもない作品（分野のタグがないソフトウェアで、タグを選んでいないもの）は null。
 */
export async function resolveWorkQuestionSet(
	db: D1Database,
	work: { id: string; category: Category },
	now: Date,
	registry: TagRegistry = REGISTRY
): Promise<ResolvedQuestionSet | null> {
	const definitions = await workTags(db, work, registry);
	if (definitions.length === 0) return null;
	await verifyTags(db, definitions, now);

	const composed = composeQuestionSet(definitions);
	const json = JSON.stringify(composed);
	const hash = await sha256(json);
	const select = db.prepare('SELECT id FROM question_sets WHERE hash = ?').bind(hash);
	let row = await select.first<{ id: number }>();
	if (!row) {
		await db
			.prepare('INSERT OR IGNORE INTO question_sets (hash, model, definition_json, created_at) VALUES (?, ?, ?, ?)')
			.bind(hash, composed.model, json, now.toISOString())
			.run();
		row = await select.first<{ id: number }>();
	}
	if (!row) throw new Error('質問セットを保存できませんでした');
	return { ...composed, id: row.id, definitions };
}
