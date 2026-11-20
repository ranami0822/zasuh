/**
 * 星の実験（experiments/clef-mention/README.md の第7弾）の質問の組み立て。
 *
 * **案。** 星の基準（段階の説明）は、`rubric-stars.md`（案 v0.1。「要決定」の5点は、ユーザーが決めた）の表のとおり。
 * ユーザーは、ラベル付けの前に、全体をもう一度確認する。質問の文面は、調整用の30件の試し打ちで固める（仕様の手順の2）。固めるまでは、本番のコードには入れない。
 * 言い換え（S1-V2、B0-V2）と、5択の choice で星を出す条件（S2）は、文面がまだないので、ここにはない。
 */
import { gameV1, mention, type AspectSpec } from '../src/lib/server/question-sets/game-v1';
import type { Question, QuestionSetDefinition, StarQuestion } from '../src/lib/server/question-sets/types';

export const ASPECT_SPECS: AspectSpec[] = [
	{ key: 'gameplay', label: 'ゲーム性・内容', scope: '戦闘、システム、難易度、ボリューム、ストーリー、探索など、遊びの内容そのもの。不具合や操作性は含めない' },
	{ key: 'music', label: '音楽・音', scope: 'BGM、サウンドトラック、効果音、音声など' },
	{ key: 'comfort', label: '快適さ', scope: 'ロード時間、不具合・バグ・クラッシュ、動作の重さ、操作性、画面や説明の分かりやすさなど' },
	{ key: 'price', label: '価格', scope: '値段、コストパフォーマンス、セールでの購入判断など' }
];

/**
 * 星の基準。`rubric-stars.md`（案 v0.1、2026-11-20 に、ユーザーが「要決定」の5点を決めた版）の表のとおり。低い順。
 * 5 と 1 は「具体的な根拠 + 強い言い方」（根拠は1点でよい）。混在は、多いほうに寄せる（4 と 2）。釣り合っていれば 3。
 * 深さ（点の数、長さ）は、星に入れない。星1は、星5の対称として置いたもの（ユーザーは、星5の条件だけを答えた）。
 */
export const STAR_LEVELS = [
	'具体的な悪い点があり、強い言い方で書かれている（悪い点は1点でもよい）',
	'具体的な悪い点・不満が書かれている（強い言い方でなくてもよい）。または、悪い点が多く、良い点が少しだけ書かれている',
	'良い点と悪い点が、同じ程度書かれている。または、良くも悪くもないと、具体的に書かれている',
	'具体的な良い点が書かれている（1点でもよい。強い言い方でなくてもよい）。または、良い点が多く、悪い点が少しだけ書かれている',
	'具体的な根拠があり、強い言い方で書かれている（根拠は1点でもよい）'
];

/** 星の質問用の規則。選択肢に「言及なし」がないので、`RULE`（game-v1.ts）の「言及なし」の言い方は使わない。 */
const STAR_RULE =
	'具体的な事実・特徴・体験が書かれていれば、短くても評価として数えてください。' +
	'内容を伴わない賛辞や非難（「神ゲー」「最高」「微妙」など）は、評価として数えません。' +
	'不具合・クラッシュ・動作の重さ・操作性への不満は「快適さ」の評価で、「ゲーム性・内容」の評価には含めません。' +
	'書かれている点の数や、文章の長さは、星に入れません。強さだけで答えてください。' +
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

export const CONDITION_NAMES = ['B0', 'S1', 'S1-order', 'S3'] as const;
export type ConditionName = (typeof CONDITION_NAMES)[number];

/**
 * 条件ごとの質問セット。
 *  B0: 今の choice + noul（8問、基準）
 *  S1: B0 + score 4つ（12問。星は、B0 のあとに足す）
 *  S1-order: S1 で、星を先に聞く
 *  S3: noul + score だけ（8問、向きなし。観点ごとに noul、score の順）
 */
export function buildCondition(name: ConditionName): QuestionSetDefinition {
	const b0 = gameV1.questions;
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
	}
	return { ...gameV1, version: 0, questions };
}
