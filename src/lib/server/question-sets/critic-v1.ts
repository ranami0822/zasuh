import { gameV1, type AspectSpec } from './game-v1';
import type { DirectionQuestion, QuestionSetDefinition, StarQuestion } from './types';

/**
 * 専門家（批評家）の評価の抜粋を読む質問セット v1（docs/critics-plan.md の 1.3）。
 * 22.7 の試験と同じ 14 問、同じ順序: ゲーム用 v1 の8問、4観点の星、総合の向きと星。
 * 一般のレビューの質問セットではないので、QUESTION_SETS（./index.ts）には入れない。
 * 変えるときは、この定義を直さず、v2 を追加する。
 */

/** scripts/star-questions.ts の ASPECT_SPECS の複写（game-v1.ts の ASPECTS は export されていない）。 */
const ASPECT_SPECS: AspectSpec[] = [
	{ key: 'gameplay', label: 'ゲーム性・内容', scope: '戦闘、システム、難易度、ボリューム、ストーリー、探索など、遊びの内容そのもの。不具合や操作性は含めない' },
	{ key: 'music', label: '音楽・音', scope: 'BGM、サウンドトラック、効果音、音声など' },
	{ key: 'comfort', label: '快適さ', scope: 'ロード時間、不具合・バグ・クラッシュ、動作の重さ、操作性、画面や説明の分かりやすさなど' },
	{ key: 'price', label: '価格', scope: '値段、コストパフォーマンス、セールでの購入判断など' }
];

// --- 4観点の星。scripts/star-questions.ts の STAR_LEVELS、STAR_RULE、star() の複写（文面は変えない） ---

const STAR_LEVELS = [
	'具体的な悪い点があり、強い言い方、またはそれに相当する熱量で書かれている（悪い点は1点でもよい）',
	'具体的な悪い点・不満が書かれている（強い言い方でなくてもよい）。または、悪い点が多く、良い点が少しだけ書かれている',
	'良い点と悪い点が、同じ程度書かれている。または、良くも悪くもないと、具体的に書かれている',
	'具体的な良い点が書かれている（1点でもよい。強い言い方でなくてもよい）。または、良い点が多く、悪い点が少しだけ書かれている',
	'具体的な根拠があり、強い言い方、またはそれに相当する熱量で書かれている（根拠は1点でもよい）'
];

const STAR_RULE =
	'具体的な事実・特徴・体験が書かれていれば、短くても評価として数えてください。' +
	'内容を伴わない賛辞や非難（「神ゲー」「最高」「微妙」など）は、評価として数えません。' +
	'不具合・クラッシュ・動作の重さ・操作性への不満は「快適さ」の評価で、「ゲーム性・内容」の評価には含めません。' +
	'その観点についての具体的な内容を、分量を割いて、熱を込めて書いているときは、強い言葉がなくても、強さの手がかりにしてください。' +
	'その観点と関係のない長さや、中身のない水増しは、手がかりにしません。' +
	'書かれていないことは推測しないでください。';

function star(a: AspectSpec): StarQuestion {
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

// --- 総合の2問。22.7 の試験の文面（docs/critics-plan.md の 1.3）。変えない ---

const OVERALL = '作品全体への評価（個別の観点ではなく、作品をどう評価しているか）';

const overallChoice: DirectionQuestion = {
	key: 'overall_choice',
	aspect: 'overall',
	kind: 'direction',
	instructions: `次のゲームレビューの抜粋は、${OVERALL}について、どのような見方を示していますか。作品全体を評価する言葉（「傑作」「失望」「おすすめ」など）も、評価として数えてください。事実の説明だけで、評価が読み取れないときは「言及なし」にしてください。書かれていないことは推測しないでください。`,
	options: [
		{ id: '肯定', value: 'positive', description: '作品全体を、好意的に評価している' },
		{ id: '否定', value: 'negative', description: '作品全体を、否定的に評価している' },
		{ id: '混在', value: 'mixed', description: '作品全体について、良い評価と悪い評価の両方が、同じ程度書かれている' },
		{ id: '言及なし', value: 'none', description: '作品全体への評価が読み取れない（書かれていないことを推測で補わない）' }
	]
};

const overallStar: StarQuestion = {
	key: 'overall_star',
	aspect: 'overall',
	kind: 'star',
	instructions: `次のゲームレビューの抜粋は、${OVERALL}について、どのくらい強く肯定または否定していますか。作品全体を評価する言葉も、評価として数えてください。書かれていないことは推測しないでください。`,
	levels: [
		'作品全体を、強い言葉で否定している（失敗作、おすすめしない、など）',
		'作品全体を、否定的に評価している、または欠点が目立つと述べている',
		'作品全体を、良くも悪くもない、または、良い点と悪い点が釣り合っていると述べている',
		'作品全体を、好意的に評価している（良作、楽しめる、など）',
		'作品全体を、強い言葉で絶賛している（傑作、必携、など）'
	]
};

export const criticV1: QuestionSetDefinition = {
	category: 'game',
	version: 1,
	model: 'clef-flash',
	aspects: [...gameV1.aspects, { key: 'overall', label: '総合' }],
	questions: [...gameV1.questions, ...ASPECT_SPECS.map(star), overallChoice, overallStar]
};
