/**
 * 星（観点ごとの強さ。Clef の score 型）の実験（experiments/clef-mention/README.md の第7弾）。
 * **仕様は案の段階**（規約は、ユーザーが確認した。ラベル付けと本実行は、まだ。ラベルが揃い、ユーザーが確認してから始める）。このファイルは、その準備。
 *
 * 使い方:
 *   組み立ての確認（通信しない）:
 *     npx tsx scripts/eval-star.ts show <B0|S1|S1-order|S3|B0-V2|S1-V2>
 *   読み取り（Cloudflare を呼ぶ。CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が必要。root では実行しない）:
 *     npx tsx scripts/eval-star.ts run <条件> <reviews.jsonl> <out.json> [--repeat 3] [--model clef|clef-flash]
 *       reviews.jsonl は、1行1件の {"id", "recommendationid", "voted_up"?, "text"}。本文は out.json に書かない。
 *   採点（通信しない）:
 *     npx tsx scripts/eval-star.ts score <out.json> <labels.json> [--baseline <B0 の out.json>]
 *   安定性（通信しない。言い換え・順序・繰り返しで、星がどれだけ変わるか）:
 *     npx tsx scripts/eval-star.ts stability <a.json> <b.json> [--run-a 0] [--run-b 0]
 *       例: S1 と S1-V2（言い換え）、S1 と S1-order（順序）、B0 と B0-V2（向きの、言い換えでの変わる割合。星の基準になる）。
 *       S1 の繰り返しは、同じファイルを2つ渡して、--run-b 1 のように回を変える。
 *
 * 星のラベルのファイル（案。ラベル付けの前に、必要なら直す）:
 *   {"labels": [{"id": 1, "gameplay": {"star": 4, "direction": "肯定", "votes": [4, 4, 5]}, "music": {"star": null, "direction": "言及なし"}, ...}]}
 *   star は、多数決の星（1〜5）。言及なし・判断不能・割れた項目は null。votes は、ラベル付け者ごとの星（任意。ラベル付け者どうしの一致率に使う）。
 *   direction は、肯定・否定・混在・言及なし。判断不能・割れた項目は null（向きの採点から外す）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { restClient } from '../src/lib/server/clef';
import { definitionHash, toClefQuestions } from '../src/lib/server/question-sets';
import type { ClefModel, Direction } from '../src/lib/server/question-sets/types';
import { interpretAnswers, type ReadingAnswer } from '../src/lib/server/reading';
import {
	bias,
	directionFromStar,
	directionWithoutChoice,
	distribution,
	exactRate,
	modeBaseline,
	pairwiseAgreement,
	stability,
	weightedKappa,
	withinRate,
	type Pair
} from './star-metrics';
import { byItem, compareRuns, type Item, type Results, type RunRecord } from './star-results';
import { ASPECT_SPECS, buildCondition, CONDITION_NAMES, type ConditionName } from './star-questions';

const ASPECTS = ASPECT_SPECS.map((a) => a.key);
const DIRECTION_OF: Record<string, Direction> = { 肯定: 'positive', 否定: 'negative', 混在: 'mixed', 言及なし: 'none' };

function conditionOf(name: string): ConditionName {
	if (!(CONDITION_NAMES as readonly string[]).includes(name)) throw new Error(`条件は ${CONDITION_NAMES.join('、')} のどれかです`);
	return name as ConditionName;
}

function show(name: string) {
	const definition = buildCondition(conditionOf(name));
	const questions = toClefQuestions(definition);
	console.log(`条件 ${name}: ${Object.keys(questions).length} 問`);
	console.log(JSON.stringify(questions, null, 1));
}

async function run(name: string, reviewsPath: string, outPath: string, repeat: number, modelOverride?: ClefModel) {
	const definition = buildCondition(conditionOf(name));
	const model = modelOverride ?? definition.model;
	const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = process.env;
	if (!accountId || !apiToken) throw new Error('CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が必要です');
	const clef = restClient({ accountId, apiToken, timeoutMs: 60_000 });
	const questions = toClefQuestions(definition);
	const reviews = readFileSync(reviewsPath, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { id: number; recommendationid?: string; voted_up?: boolean; text: string });

	const records: RunRecord[] = [];
	for (let r = 0; r < repeat; r++) {
		for (const review of reviews) {
			const base = { sample: review.id, run: r, recommendationid: review.recommendationid, votedUp: review.voted_up };
			const started = Date.now();
			try {
				const result = await clef.run(model, review.text, questions);
				records.push({ ...base, status: 'ok', latencyMs: Date.now() - started, inputTokens: result.inputTokens, answers: interpretAnswers(definition, result.answers) });
			} catch (e) {
				records.push({ ...base, status: 'error', error: (e as Error).message });
				// 429（利用枠の超過）は、続けても同じ。そこで止めて、ここまでの結果を保存する。
				if ((e as Error).message.includes('429')) {
					console.log('利用枠の超過（429）。ここで止めて、結果を保存します');
					r = repeat;
					break;
				}
			}
			console.log(`run${r} s${review.id} ${records.at(-1)!.status}`);
		}
	}
	const results: Results = { condition: conditionOf(name), model, questionSetHash: await definitionHash(definition), records };
	writeFileSync(outPath, JSON.stringify(results, null, 1));
}

// --- 採点 ---

interface AspectLabel {
	star: number | null;
	direction: string | null;
	votes?: number[];
}

function loadLabels(path: string): Map<string, AspectLabel> {
	const rows = JSON.parse(readFileSync(path, 'utf8')).labels as Record<string, unknown>[];
	const out = new Map<string, AspectLabel>();
	for (const row of rows) {
		for (const aspect of ASPECTS) {
			const l = row[aspect] as AspectLabel | undefined;
			if (l && typeof l === 'object') out.set(`${row.id}:${aspect}`, l);
		}
	}
	return out;
}

/** 答えから出す向き。choice があればそれ、なければ（S3）、noul と星から、固定の規則で出す。 */
function predictedDirection(item: Item): Direction | null {
	if (item.direction) return item.direction.value as Direction;
	if (item.mention && item.star) return directionWithoutChoice(item.mention.prob, item.star.star!.score);
	return null;
}

const pct = (x: number) => (Number.isNaN(x) ? '-' : `${(x * 100).toFixed(1)}%`);
const num = (x: number, d = 2) => (Number.isNaN(x) ? '-' : x.toFixed(d));

function directionAccuracy(results: Results, labels: Map<string, AspectLabel>): Map<string, boolean> {
	const out = new Map<string, boolean>();
	for (const [key, item] of byItem(results, 0)) {
		const label = labels.get(key);
		const gold = label?.direction ? DIRECTION_OF[label.direction] : undefined;
		const pred = predictedDirection(item);
		if (gold && pred) out.set(key, gold === pred);
	}
	return out;
}

function score(resultsPath: string, labelsPath: string, baselinePath?: string) {
	const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as Results;
	const labels = loadLabels(labelsPath);
	const ok = results.records.filter((r) => r.status === 'ok' && r.run === 0);
	const items = byItem(results, 0);
	console.log(`== 条件 ${results.condition}（${results.model}）。読み取りの失敗: ${results.records.filter((r) => r.status !== 'ok').length}/${results.records.length}`);
	const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
	console.log(`平均の応答時間: ${num(mean(ok.map((r) => r.latencyMs!)), 0)} ms、平均の入力トークン: ${num(mean(ok.flatMap((r) => (r.inputTokens == null ? [] : [r.inputTokens]))), 0)}`);

	// 星（言及のある項目だけ）
	const starItems = [...items.entries()].flatMap(([key, item]) => {
		const label = labels.get(key);
		return item.star && label?.star != null ? [{ key, label, item, pair: [label.star, item.star.star!.score] as Pair }] : [];
	});
	if (starItems.length > 0) {
		const pairs = starItems.map((x) => x.pair);
		const baseline = modeBaseline(pairs.map(([l]) => l));
		console.log(`\n[星] 言及のある項目: ${pairs.length}`);
		console.log(`完全一致 ${pct(exactRate(pairs))}、±1 以内 ${pct(withinRate(pairs, 1))}、重み付きκ ${num(weightedKappa(pairs))}`);
		if (baseline) console.log(`  基準（いつも星${baseline.star}）: 完全一致 ${pct(baseline.exact)}、±1 以内 ${pct(baseline.within1)}`);
		const votes = starItems.flatMap((x) => (x.label.votes ? [x.label.votes] : []));
		const labelers = pairwiseAgreement(votes, 1);
		if (labelers.pairs > 0) console.log(`  ラベル付け者どうし（上限の目安）: 完全一致 ${pct(labelers.exact)}、±1 以内 ${pct(labelers.within)}（${labelers.pairs} 組）`);
		console.log(`偏り（予測の平均 - ラベルの平均）: ${num(bias(pairs))}`);
		console.log(`予測の星の分布（1〜5）: ${distribution(pairs.map(([, p]) => p)).join(' / ')}。ラベル: ${distribution(pairs.map(([l]) => l)).join(' / ')}`);
		if (labelers.pairs > 0) {
			const gap = labelers.within - withinRate(pairs, 1);
			console.log(`  （案の目安）±1 以内が、ラベル付け者どうしから 5 ポイント以内: ${gap <= 0.05 ? '満たす' : '満たさない'}（差 ${num(gap * 100, 1)} ポイント）`);
		}

		// 星から出した向きと、向きのラベル
		const mixed = starItems.filter((x) => x.label.direction === '混在');
		const matched = starItems.filter((x) => x.label.direction && directionFromStar(x.item.star!.star!.score) === DIRECTION_OF[x.label.direction]);
		console.log(`星から出した向き（4〜5 肯定、1〜2 否定、3 混在）と向きのラベルの一致: ${matched.length}/${starItems.filter((x) => x.label.direction).length}`);
		console.log(
			mixed.length < 10
				? `混在のラベル ${mixed.length} 件（10件に届かない）: 混在の扱いは検証不能`
				: `混在のラベル ${mixed.length} 件のうち、星3 になったもの: ${mixed.filter((x) => Math.round(x.item.star!.star!.score) === 3).length}`
		);

		// ラベルなしの確認: おすすめする / しない
		const byVote = (up: boolean) => starItems.filter((x) => x.item.votedUp === up).map((x) => x.item.star!.star!.score);
		const up = byVote(true);
		const down = byVote(false);
		if (up.length && down.length) console.log(`おすすめする側の星の平均 ${num(mean(up))}（${up.length} 件）、しない側 ${num(mean(down))}（${down.length} 件）`);
	}

	// 向きと言及（回帰の確認）
	const acc = directionAccuracy(results, labels);
	const correct = [...acc.values()].filter(Boolean).length;
	console.log(`\n[向き] 4分類の正解（向きのラベルのある項目）: ${correct}/${acc.size}${results.condition === 'S3' ? '（S3: 向きは、noul と星から、固定の規則で出した）' : ''}`);
	const mentionRows = [...items.entries()].flatMap(([key, item]) => {
		const label = labels.get(key);
		return item.mention && label?.direction ? [{ gold: label.direction !== '言及なし', pred: item.mention.value === 'true' }] : [];
	});
	console.log(`言及の有無（noul）の正解: ${mentionRows.filter((r) => r.gold === r.pred).length}/${mentionRows.length}`);

	if (baselinePath) {
		const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Results;
		const base = directionAccuracy(baseline, labels);
		const common = [...acc.keys()].filter((k) => base.has(k));
		const a = common.filter((k) => acc.get(k)).length;
		const b = common.filter((k) => base.get(k)).length;
		const diff = a - b;
		console.log(`基準（${baseline.condition}）との比較（共通の ${common.length} 項目）: ${a} 対 ${b}（差 ${diff >= 0 ? '+' : ''}${diff}）`);
		console.log(`  判定（第5弾と同じ基準）: ${Math.abs(diff) <= 4 ? '同程度（±4 件以内）' : diff < 0 ? '悪化（5件以上少ない）' : '改善（5件以上多い）'}`);
	}
}

function stabilityCommand(aPath: string, bPath: string, runA: number, runB: number) {
	const a = JSON.parse(readFileSync(aPath, 'utf8')) as Results;
	const b = JSON.parse(readFileSync(bPath, 'utf8')) as Results;
	const r = compareRuns(a, b, runA, runB);
	console.log(`== ${a.condition}（${runA} 回目）と ${b.condition}（${runB} 回目）`);
	if (r.star) {
		console.log(`星: 言及のある共通の ${r.star.n} 項目で、四捨五入した星が変わった割合 ${pct(r.star.changed)}、score の差の平均 ${num(r.star.meanAbsDiff)}`);
	}
	if (r.direction) {
		console.log(`向き（choice）: 共通の ${r.direction.n} 項目で、答えが変わった割合 ${pct(r.direction.changed)}（星の安定性の比較対象。B0 と B0-V2 なら、言い換えでの基準になる）`);
	}
	if (!r.star && !r.direction) console.log('比べられる答えがありません（共通の項目がない、または、星も向きもない）');
}

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
if (command === 'show') {
	show(args[0]);
} else if (command === 'run') {
	await run(args[0], args[1], args[2], Number(flag('--repeat') ?? 1), flag('--model') as ClefModel | undefined);
} else if (command === 'score') {
	score(args[0], args[1], flag('--baseline'));
} else if (command === 'stability') {
	stabilityCommand(args[0], args[1], Number(flag('--run-a') ?? 0), Number(flag('--run-b') ?? 0));
} else {
	console.error('使い方は、このファイルの冒頭を参照');
	process.exit(1);
}
