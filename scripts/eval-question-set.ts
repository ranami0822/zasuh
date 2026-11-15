/**
 * 質問セットの評価。本番と同じコード（質問の組み立て、答えの検証と解釈）で、正解付きのレビューを読んで採点する。
 * 質問文やモデルを変える前後に実行して、成績を比べる（docs/mvp-design.md の6章）。
 *
 * 使い方:
 *   読み取り（Cloudflare を呼ぶ。CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が必要）:
 *     npx tsx scripts/eval-question-set.ts run <reviews.jsonl> <out.json> [--model clef|clef-flash]
 *       reviews.jsonl は、1行1件の {"id", "recommendationid", "text"}。本文は out.json に書かない。
 *   採点（通信しない）:
 *     npx tsx scripts/eval-question-set.ts score <results.json> <labels.json>
 *     npx tsx scripts/eval-question-set.ts score-round4 <results4.json> <labels.json> [clef|clef-flash]
 *       score-round4 は、実験の第4弾の記録（選択式 + 言及、条件 B0）を、同じ方法で採点する（比較の基準）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { restClient } from '../src/lib/server/clef';
import { definitionHash, latestDefinition, toClefQuestions } from '../src/lib/server/question-sets';
import type { ClefModel, Direction } from '../src/lib/server/question-sets/types';
import { interpretAnswers, type ReadingAnswer } from '../src/lib/server/reading';

interface Prediction {
	sample: number;
	aspect: string;
	direction: Direction;
	needsCheck: boolean;
}

const LABEL: Record<string, Direction> = { 肯定: 'positive', 否定: 'negative', 混在: 'mixed', 言及なし: 'none' };
const JA: Record<Direction, string> = { positive: '肯定', negative: '否定', mixed: '混在', none: '言及なし' };

async function run(reviewsPath: string, outPath: string, modelOverride?: ClefModel) {
	const definition = latestDefinition('game');
	if (!definition) throw new Error('ゲーム用の質問セットがありません');
	const model = modelOverride ?? definition.model;
	const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = process.env;
	if (!accountId || !apiToken) throw new Error('CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が必要です');

	const clef = restClient({ accountId, apiToken });
	const questions = toClefQuestions(definition);
	const reviews = readFileSync(reviewsPath, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { id: number; recommendationid?: string; text: string });

	const records = [];
	for (const review of reviews) {
		const started = Date.now();
		try {
			const result = await clef.run(model, review.text, questions);
			const answers = interpretAnswers(definition, result.answers);
			records.push({
				sample: review.id,
				recommendationid: review.recommendationid,
				status: 'ok',
				latencyMs: Date.now() - started,
				inputTokens: result.inputTokens,
				answers
			});
		} catch (e) {
			records.push({ sample: review.id, recommendationid: review.recommendationid, status: 'error', error: (e as Error).message });
		}
		console.log(review.id, records.at(-1)!.status);
	}
	writeFileSync(
		outPath,
		JSON.stringify(
			{
				questionSet: {
					category: definition.category,
					version: definition.version,
					hash: await definitionHash(definition),
					model
				},
				records
			},
			null,
			1
		)
	);
}

function loadLabels(path: string): Map<string, { gold: Direction; agree?: number }> {
	const labels = JSON.parse(readFileSync(path, 'utf8')).labels as Record<string, unknown>[];
	const out = new Map<string, { gold: Direction; agree?: number }>();
	for (const row of labels) {
		for (const aspect of ['gameplay', 'music', 'comfort', 'price']) {
			const value = row[aspect];
			if (typeof value !== 'string') continue; // null は、判断不能か、ラベル付け者が割れた項目。採点から外す。
			out.set(`${row.id}:${aspect}`, {
				gold: LABEL[value],
				agree: (row.agree as Record<string, number> | undefined)?.[aspect]
			});
		}
	}
	return out;
}

function score(title: string, predictions: Prediction[], labelsPath: string, extra: string[] = []) {
	const labels = loadLabels(labelsPath);
	const rows = predictions.flatMap((p) => {
		const label = labels.get(`${p.sample}:${p.aspect}`);
		return label ? [{ ...p, ...label }] : [];
	});
	const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
	const wrong = rows.filter((r) => r.direction !== r.gold);

	console.log(`== ${title}`);
	console.log(`採点した回答: ${rows.length}（正解ラベルのある ${labels.size} 件のうち）`);
	console.log(`正解: ${rows.length - wrong.length}/${rows.length}`);
	console.log(`すべて「言及なし」と答えた場合の正解: ${count((r) => r.gold === 'none')}/${rows.length}`);
	console.log(`あるのに言及なし: ${count((r) => r.gold !== 'none' && r.direction === 'none')}`);
	console.log(`ないのにある: ${count((r) => r.gold === 'none' && r.direction !== 'none')}`);
	console.log(`向きの取り違え（どちらも言及あり）: ${count((r) => r.gold !== 'none' && r.direction !== 'none' && r.gold !== r.direction)}`);
	console.log(
		`混在: 答えた ${count((r) => r.direction === 'mixed')}、うち正解 ${count((r) => r.direction === 'mixed' && r.gold === 'mixed')}、正解が混在 ${count((r) => r.gold === 'mixed')}`
	);
	console.log(
		`要確認の印: ${count((r) => r.needsCheck)} 件。誤り ${wrong.length} 件のうち ${wrong.filter((r) => r.needsCheck).length} 件に付いていた`
	);
	for (const line of extra) console.log(line);
	console.log('誤り:');
	for (const r of wrong) {
		console.log(`  s${r.sample} ${r.aspect}: 正=${JA[r.gold]} 答=${JA[r.direction]}${r.needsCheck ? '（要確認）' : ''}`);
	}
}

function scoreResults(resultsPath: string, labelsPath: string) {
	const data = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
		questionSet: { category: string; version: number; model: string; hash: string };
		records: { sample: number; status: string; latencyMs?: number; inputTokens?: number | null; answers?: ReadingAnswer[] }[];
	};
	const ok = data.records.filter((r) => r.status === 'ok');
	const predictions = ok.flatMap((r) =>
		r.answers!
			.filter((a) => a.kind === 'direction')
			.map((a) => ({ sample: r.sample, aspect: a.aspect, direction: a.value as Direction, needsCheck: a.needsCheck }))
	);
	const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : NaN);
	const qs = data.questionSet;
	score(`${qs.category} v${qs.version}（${qs.model}）`, predictions, labelsPath, [
		`読み取りの失敗: ${data.records.length - ok.length}/${data.records.length}`,
		`平均の応答時間: ${mean(ok.map((r) => r.latencyMs!))} ms、平均の入力トークン: ${mean(ok.flatMap((r) => (r.inputTokens == null ? [] : [r.inputTokens])))}`
	]);
}

/** 実験の第4弾の記録（条件 B0）を、同じ規則で解釈して採点する。 */
function scoreRound4(resultsPath: string, labelsPath: string, model: string) {
	const records = (JSON.parse(readFileSync(resultsPath, 'utf8')).records as Record<string, unknown>[]).filter(
		(r) => r.cond === 'B0' && r.model === model && r.status === 200
	);
	const definition = latestDefinition('game')!;
	// 質問のキーと選択肢の名前は第4弾と同じなので、文面が違っても、答えは同じ関数で解釈できる。
	const predictions = records.flatMap((r) =>
		interpretAnswers(definition, r.answers as Record<string, unknown>)
			.filter((a) => a.kind === 'direction')
			.map((a) => ({ sample: r.sample as number, aspect: a.aspect, direction: a.value as Direction, needsCheck: a.needsCheck }))
	);
	score(`第4弾の文面（B0、${model}）`, predictions, labelsPath);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'run') {
	const i = args.indexOf('--model');
	await run(args[0], args[1], i >= 0 ? (args[i + 1] as ClefModel) : undefined);
} else if (command === 'score') {
	scoreResults(args[0], args[1]);
} else if (command === 'score-round4') {
	scoreRound4(args[0], args[1], args[2] ?? 'clef-flash');
} else {
	console.error('使い方は、このファイルの冒頭を参照');
	process.exit(1);
}
