import { ASPECTS, mention, type AspectSpec } from './game-v1';
import { STAR_LEVELS, STAR_RULE_TAIL } from './stars';
import type { QuestionSetDefinition, StarQuestion } from './types';

/**
 * ゲーム用の質問セット v2。観点ごとに、言及の有無（noul）と星（score）の2問（4観点で8問）。向き（choice）の質問は外した。
 * 実験の S3 条件（experiments/clef-mention/README.md の第7弾。docs/mvp-design.md の 20.6）と同じ文面・同じ順序。
 * 変えるときは、この定義を直さず、v3 を追加する。
 */

/** 星の質問用の規則。選択肢に「言及なし」がないので、game-v1 の RULE の「言及なし」の言い方は使わない。 */
export const STAR_RULE =
	'具体的な事実・特徴・体験が書かれていれば、短くても評価として数えてください。' +
	'内容を伴わない賛辞や非難（「神ゲー」「最高」「微妙」など）は、評価として数えません。' +
	'不具合・クラッシュ・動作の重さ・操作性への不満は「快適さ」の評価で、「ゲーム性・内容」の評価には含めません。' +
	STAR_RULE_TAIL;

export function star(a: AspectSpec): StarQuestion {
	return {
		key: `${a.key}_star`,
		aspect: a.key,
		kind: 'star',
		instructions:
			`このゲームレビューは、観点「${a.key}: ${a.label}（${a.scope}）」について、どのくらい強く肯定または否定していますか。` +
			`作品の良し悪しではなく、本文がその観点をどう述べているかで答えてください。${STAR_RULE}`,
		levels: STAR_LEVELS.map((text) => `この観点について、${text}`)
	};
}

export const gameV2: QuestionSetDefinition = {
	category: 'game',
	version: 2,
	model: 'clef-flash',
	aspects: ASPECTS.map(({ key, label }) => ({ key, label })),
	questions: ASPECTS.flatMap((a) => [mention(a), star(a)])
};
