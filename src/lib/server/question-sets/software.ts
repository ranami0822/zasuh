import type { AspectSpec } from './game-v1';
import { STAR_LEVELS, STAR_RULE_TAIL } from './stars';
import type { DirectionQuestion, MentionQuestion, StarQuestion } from './types';

/** ソフトウェア用の決まりの文。ゲーム用（game-v1.ts の RULE）と同じ考え方で、言葉だけをソフトウェアに直した。 */
export const SOFTWARE_RULE =
	'具体的な事実・特徴・体験が書かれていれば、短くても評価として数えてください（例:「対応する形式が多い」は機能の肯定）。' +
	'内容を伴わない賛辞や非難（「神アプリ」「最高」「微妙」など）は、どの観点にも含めず「言及なし」としてください。' +
	'不具合・クラッシュ・動作の重さは「安定性・速さ」だけに含め、ほかの観点には含めないでください。' +
	'書かれていないことは推測しないでください。';

export function softwareDirection(a: AspectSpec): DirectionQuestion {
	return {
		key: `${a.key}_choice`,
		aspect: a.key,
		kind: 'direction',
		instructions: `このソフトウェアのレビューは、観点「${a.key}: ${a.label}（${a.scope}）」についてどう述べていますか。${SOFTWARE_RULE}`,
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

export function softwareMention(a: AspectSpec): MentionQuestion {
	return {
		key: `${a.key}_noul`,
		aspect: a.key,
		kind: 'mention',
		instructions: `このソフトウェアのレビューは、観点「${a.key}: ${a.label}（${a.scope}）」について、具体的な内容（事実・特徴・体験）を書いていますか。${SOFTWARE_RULE}`,
		criteria: {
			true: 'この観点についての具体的な記述がレビューにある',
			false: 'この観点についての具体的な記述がレビューにない'
		}
	};
}

/**
 * 星の質問の規則（ソフトウェア用）。ゲーム用（game-v2.ts の STAR_RULE）の言葉だけをソフトウェアに直した。
 * 未確認: 実験で確かめたのは、ゲームの4観点だけ（docs/mvp-design.md の 12.7）。
 */
export const SOFTWARE_STAR_RULE =
	'具体的な事実・特徴・体験が書かれていれば、短くても評価として数えてください。' +
	'内容を伴わない賛辞や非難（「神アプリ」「最高」「微妙」など）は、評価として数えません。' +
	'不具合・クラッシュ・動作の重さは「安定性・速さ」の評価で、ほかの観点の評価には含めません。' +
	STAR_RULE_TAIL;

export function softwareStar(a: AspectSpec): StarQuestion {
	return {
		key: `${a.key}_star`,
		aspect: a.key,
		kind: 'star',
		instructions:
			`このソフトウェアのレビューは、観点「${a.key}: ${a.label}（${a.scope}）」について、どのくらい強く肯定または否定していますか。` +
			`作品の良し悪しではなく、本文がその観点をどう述べているかで答えてください。${SOFTWARE_STAR_RULE}`,
		levels: STAR_LEVELS.map((text) => `この観点について、${text}`)
	};
}
