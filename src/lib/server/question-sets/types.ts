export type Category = 'game' | 'software';
export type ClefModel = 'clef' | 'clef-flash';
export type Direction = 'positive' | 'negative' | 'mixed' | 'none';

/** 観点についての向きを聞く質問（Clef の choice）。 */
export interface DirectionQuestion {
	key: string;
	aspect: string;
	kind: 'direction';
	instructions: string;
	/** id はモデルに渡す選択肢の名前、value は保存する値。順序も定義の一部。 */
	options: { id: string; value: Direction; description: string }[];
}

/** 観点について具体的な記述があるかを聞く質問（Clef の noul）。 */
export interface MentionQuestion {
	key: string;
	aspect: string;
	kind: 'mention';
	instructions: string;
	criteria: { true: string; false: string };
}

export type Question = DirectionQuestion | MentionQuestion;

/**
 * 質問セット。1レビューにつき、questions のすべてを、この順序で、1リクエストにまとめて送る。
 * 同じリクエストに入る質問は互いに影響するので、文面だけでなく、組と順序も版の一部として扱う。
 * 内容を少しでも変えるときは、version を上げて、新しい定義として追加する。
 */
export interface QuestionSetDefinition {
	category: Category;
	version: number;
	model: ClefModel;
	aspects: { key: string; label: string }[];
	questions: Question[];
}
