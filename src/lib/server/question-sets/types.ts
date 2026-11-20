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

/**
 * 観点についての強さを、段階で聞く質問（Clef の score）。
 * levels は、段階の説明を、低い順（否定が強い → 肯定が強い）に並べたもの。2〜10段階（Clef の制限）。
 * 試験段階（docs/mvp-design.md の19章、experiments/clef-mention/README.md の第7弾）。本番のタグは、まだ使っていない。
 */
export interface StarQuestion {
	key: string;
	aspect: string;
	kind: 'star';
	instructions: string;
	levels: string[];
}

export type Question = DirectionQuestion | MentionQuestion | StarQuestion;

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
