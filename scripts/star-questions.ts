/**
 * 星の実験（experiments/clef-mention/README.md の第7弾）の質問の組み立て。
 *
 * **案。** 星の基準（段階の説明）は、`rubric-stars.md`（案 v0.1。「要決定」の5点は、ユーザーが決めた）の表のとおり。
 * ユーザーは、ラベル付けの前に、全体をもう一度確認する。質問の文面は、調整用の30件の試し打ちで固める（仕様の手順の2）。固めるまでは、本番のコードには入れない。
 * S2（5択の choice で星を出す条件）は、任意で優先度が低いので、作っていない。
 */
import { gameV1, mention, RULE, type AspectSpec } from '../src/lib/server/question-sets/game-v1';
import type { DirectionQuestion, MentionQuestion, Question, QuestionSetDefinition, StarQuestion } from '../src/lib/server/question-sets/types';

export const ASPECT_SPECS: AspectSpec[] = [
	{ key: 'gameplay', label: 'ゲーム性・内容', scope: '戦闘、システム、難易度、ボリューム、ストーリー、探索など、遊びの内容そのもの。不具合や操作性は含めない' },
	{ key: 'music', label: '音楽・音', scope: 'BGM、サウンドトラック、効果音、音声など' },
	{ key: 'comfort', label: '快適さ', scope: 'ロード時間、不具合・バグ・クラッシュ、動作の重さ、操作性、画面や説明の分かりやすさなど' },
	{ key: 'price', label: '価格', scope: '値段、コストパフォーマンス、セールでの購入判断など' }
];

/**
 * 星の基準。`rubric-stars.md`（案 v0.1。2026-11-20 に、ユーザーが「要決定」を決め、全体を確認した版）の表のとおり。低い順。
 * 5 と 1 は「具体的な根拠 + 強い言い方、またはそれに相当する熱量」（根拠は1点でよい）。混在は、多いほうに寄せる（4 と 2）。釣り合っていれば 3。
 * 星1は、星5の対称として置いたもの（ユーザーは、星5の条件だけを答えた）。
 */
export const STAR_LEVELS = [
	'具体的な悪い点があり、強い言い方、またはそれに相当する熱量で書かれている（悪い点は1点でもよい）',
	'具体的な悪い点・不満が書かれている（強い言い方でなくてもよい）。または、悪い点が多く、良い点が少しだけ書かれている',
	'良い点と悪い点が、同じ程度書かれている。または、良くも悪くもないと、具体的に書かれている',
	'具体的な良い点が書かれている（1点でもよい。強い言い方でなくてもよい）。または、良い点が多く、悪い点が少しだけ書かれている',
	'具体的な根拠があり、強い言い方、またはそれに相当する熱量で書かれている（根拠は1点でもよい）'
];

/** 言い換え（V2）の星の基準。意味は STAR_LEVELS と同じ。 */
export const STAR_LEVELS_V2 = [
	'悪い点を具体的に挙げていて、しかも強い調子、またはそれに相当する熱量で書いている（悪い点は1点でも可）',
	'具体的な不満・悪い点を書いている（強い調子でなくても可）。または、悪い点が大半で、良い点はわずかしか書いていない',
	'良い点と悪い点を、同じくらい書いている。または、「良くも悪くもない」と具体的に書いている',
	'具体的な良い点を書いている（1点でも可。強い調子でなくても可）。または、良い点が大半で、悪い点はわずかしか書いていない',
	'具体的な根拠を挙げていて、しかも強い調子、またはそれに相当する熱量で書いている（根拠は1点でも可）'
];

/** 星の質問用の規則。選択肢に「言及なし」がないので、`RULE`（game-v1.ts）の「言及なし」の言い方は使わない。 */
const STAR_RULE =
	'具体的な事実・特徴・体験が書かれていれば、短くても評価として数えてください。' +
	'内容を伴わない賛辞や非難（「神ゲー」「最高」「微妙」など）は、評価として数えません。' +
	'不具合・クラッシュ・動作の重さ・操作性への不満は「快適さ」の評価で、「ゲーム性・内容」の評価には含めません。' +
	'その観点についての具体的な内容を、分量を割いて、熱を込めて書いているときは、強い言葉がなくても、強さの手がかりにしてください。' +
	'その観点と関係のない長さや、中身のない水増しは、手がかりにしません。' +
	'書かれていないことは推測しないでください。';

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

// --- 言い換え（V2） ---
// 第2弾の V2（experiments/clef-mention/run2.py の V["V2"]）の言い回しを使う。ただし、B0（ゲーム v1）と意味をそろえるため、
// 観点の説明に、v1 と同じ内容（ストーリー・探索、不具合は快適さ、など）を足し、規約 v2 の規則（RULE）を入れた。
// 選択肢の id（肯定・否定・混在・言及なし）と、質問のキーは、B0 と同じ（同じ関数で解釈できるように）。

const V2_SCOPE: Record<string, string> = {
	gameplay: 'ゲームの遊び心地や内容面（戦闘・システム・難易度・ボリューム・ストーリー・探索など。不具合や操作性は含めない）',
	music: '音楽や音まわり（BGM・サントラ・効果音・音声など）',
	comfort: '遊ぶうえでの快適さ（ロードの待ち時間、不具合・クラッシュ、動作の重さ、操作のしやすさ、画面や説明の分かりやすさなど）',
	price: '値段まわり（価格、費用対効果、セールでの購入判断など）'
};

function directionV2(a: AspectSpec): DirectionQuestion {
	return {
		key: `${a.key}_choice`,
		aspect: a.key,
		kind: 'direction',
		instructions: `次のレビュー文の書き手は、観点「${a.key}: ${V2_SCOPE[a.key]}」について、どのような見方を示していますか。${RULE}`,
		options: [
			{ id: '肯定', value: 'positive', description: '好意的・満足している具体的な内容だけが書かれている' },
			{ id: '否定', value: 'negative', description: '不満・批判の具体的な内容だけが書かれている' },
			{ id: '混在', value: 'mixed', description: '好意的な内容と不満の内容が、どちらも具体的に書かれている' },
			{ id: '言及なし', value: 'none', description: 'この話題についての具体的な内容が、レビューに出てこない（書かれていないことを推測で補わない）' }
		]
	};
}

function mentionV2(a: AspectSpec): MentionQuestion {
	return {
		key: `${a.key}_noul`,
		aspect: a.key,
		kind: 'mention',
		instructions: `次のレビュー文には、観点「${a.key}: ${V2_SCOPE[a.key]}」についての、具体的な内容（事実・特徴・体験）の記述が含まれていますか。${RULE}`,
		criteria: { true: 'その話題についての具体的な記述がある', false: 'その話題についての具体的な記述はない' }
	};
}

function starV2(a: AspectSpec): StarQuestion {
	return {
		key: `${a.key}_star`,
		aspect: a.key,
		kind: 'star',
		instructions:
			`次のレビュー文の書き手は、観点「${a.key}: ${V2_SCOPE[a.key]}」について、どのくらい強く好意または不満を示していますか。` +
			`作品そのものの良し悪しではなく、書き手がその観点をどう述べているかで答えてください。${STAR_RULE}`,
		levels: STAR_LEVELS_V2.map((text) => `この観点について、${text}`)
	};
}

export const CONDITION_NAMES = ['B0', 'S1', 'S1-order', 'S3', 'B0-V2', 'S1-V2'] as const;
export type ConditionName = (typeof CONDITION_NAMES)[number];

/**
 * 条件ごとの質問セット。
 *  B0: 今の choice + noul（8問、基準）
 *  S1: B0 + score 4つ（12問。星は、B0 のあとに足す）
 *  S1-order: S1 で、星を先に聞く
 *  S3: noul + score だけ（8問、向きなし。観点ごとに noul、score の順）
 *  B0-V2: B0 の言い換え（8問。言い換えでの、向きの安定性を、星と同じ回に比べるため）
 *  S1-V2: S1 の言い換え（12問。質問文と、星の段階の説明を、意味を変えずに言い換えた）
 */
export function buildCondition(name: ConditionName): QuestionSetDefinition {
	const b0 = gameV1.questions;
	const b0V2 = ASPECT_SPECS.flatMap((a) => [directionV2(a), mentionV2(a)]);
	const stars = ASPECT_SPECS.map(star);
	let questions: Question[];
	switch (name) {
		case 'B0':
			questions = b0;
			break;
		case 'S1':
			questions = [...b0, ...stars];
			break;
		case 'S1-order':
			questions = [...stars, ...b0];
			break;
		case 'S3':
			questions = ASPECT_SPECS.flatMap((a) => [mention(a), star(a)]);
			break;
		case 'B0-V2':
			questions = b0V2;
			break;
		case 'S1-V2':
			questions = [...b0V2, ...ASPECT_SPECS.map(starV2)];
			break;
	}
	return { ...gameV1, version: 0, questions };
}
