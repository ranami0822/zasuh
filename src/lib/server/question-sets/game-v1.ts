import type { DirectionQuestion, MentionQuestion, QuestionSetDefinition } from './types';

/**
 * ゲーム用の質問セット v1。
 * 実験（experiments/clef-mention）で最も安定していた「選択式 + 言及」の8問に、
 * 規約 v2（rubric.md）を反映したもの。変えるときは、この定義を直さず、v2 を追加する。
 */

const ASPECTS = [
	{
		key: 'gameplay',
		label: 'ゲーム性・内容',
		scope: '戦闘、システム、難易度、ボリューム、ストーリー、探索など、遊びの内容そのもの。不具合や操作性は含めない'
	},
	{
		key: 'music',
		label: '音楽・音',
		scope: 'BGM、サウンドトラック、効果音、音声など'
	},
	{
		key: 'comfort',
		label: '快適さ',
		scope: 'ロード時間、不具合・バグ・クラッシュ、動作の重さ、操作性、画面や説明の分かりやすさなど'
	},
	{
		key: 'price',
		label: '価格',
		scope: '値段、コストパフォーマンス、セールでの購入判断など'
	}
] as const;

export const RULE =
	'具体的な事実・特徴・体験が書かれていれば、短くても評価として数えてください（例:「敵の種類が豊富」はゲーム性の肯定）。' +
	'内容を伴わない賛辞や非難（「神ゲー」「最高」「微妙」など）は、どの観点にも含めず「言及なし」としてください。' +
	'不具合・クラッシュ・動作の重さ・操作性への不満は「快適さ」だけに含め、「ゲーム性・内容」には含めないでください。' +
	'書かれていないことは推測しないでください。';

export interface AspectSpec {
	key: string;
	label: string;
	scope: string;
}

export function direction(a: AspectSpec): DirectionQuestion {
	return {
		key: `${a.key}_choice`,
		aspect: a.key,
		kind: 'direction',
		instructions: `このゲームレビューは、観点「${a.key}: ${a.label}（${a.scope}）」についてどう述べていますか。${RULE}`,
		options: [
			{ id: '肯定', value: 'positive', description: 'この観点について、具体的な良い点だけが書かれている' },
			{ id: '否定', value: 'negative', description: 'この観点について、具体的な悪い点・不満だけが書かれている' },
			{ id: '混在', value: 'mixed', description: 'この観点について、具体的な良い点と悪い点の両方が書かれている' },
			{
				id: '言及なし',
				value: 'none',
				description: 'この観点について、具体的な内容が書かれていない（書かれていないことを推測で補わない）'
			}
		]
	};
}

export function mention(a: AspectSpec): MentionQuestion {
	return {
		key: `${a.key}_noul`,
		aspect: a.key,
		kind: 'mention',
		instructions: `このゲームレビューは、観点「${a.key}: ${a.label}（${a.scope}）」について、具体的な内容（事実・特徴・体験）を書いていますか。${RULE}`,
		criteria: {
			true: 'この観点についての具体的な記述がレビューにある',
			false: 'この観点についての具体的な記述がレビューにない'
		}
	};
}

export const gameV1: QuestionSetDefinition = {
	category: 'game',
	version: 1,
	model: 'clef-flash',
	aspects: ASPECTS.map(({ key, label }) => ({ key, label })),
	questions: ASPECTS.flatMap((a) => [direction(a), mention(a)])
};
