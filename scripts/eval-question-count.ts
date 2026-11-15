/**
 * 質問の数と精度の実験（experiments/clef-mention/README.md の第6弾）。
 * 本番の質問セット（ゲーム v1）の4観点の質問に、無関係な観点の質問を足して、同じレビューを読む。
 * 採点するのは、元の4観点だけ。足した質問は、答えが「言及なし」以外になった数だけを数える。
 *
 *   読み取り: npx tsx scripts/eval-question-count.ts run <reviews.jsonl> <out.json>
 *   採点:     npx tsx scripts/eval-question-count.ts score <out.json> <labels.json> [<results5.json>]
 *   組み立ての確認（通信しない）: npx tsx scripts/eval-question-count.ts show
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { restClient } from '../src/lib/server/clef';
import { toClefQuestions } from '../src/lib/server/question-sets';
import { direction, gameV1, mention } from '../src/lib/server/question-sets/game-v1';
import type { Direction, Question, QuestionSetDefinition } from '../src/lib/server/question-sets/types';
import { interpretAnswers } from '../src/lib/server/reading';
import { FILLER_ASPECTS } from './question-count-fillers';

const BASE_ASPECTS = ['gameplay', 'music', 'comfort', 'price'];

export interface Condition {
	name: string;
	/** 質問の総数（観点の数の2倍）。 */
	size: number;
	/** 足した観点を、元の4観点の前に置くか。 */
	fillersFirst: boolean;
	/** 元の4観点の並びを逆にするか。 */
	reverseBase: boolean;
}

export const CONDITIONS: Condition[] = [
	{ name: 'q8', size: 8, fillersFirst: false, reverseBase: false },
	{ name: 'q16', size: 16, fillersFirst: false, reverseBase: false },
	{ name: 'q32', size: 32, fillersFirst: false, reverseBase: false },
	{ name: 'q64', size: 64, fillersFirst: false, reverseBase: false },
	{ name: 'q64-fillers-first', size: 64, fillersFirst: true, reverseBase: false },
	{ name: 'q8-reversed', size: 8, fillersFirst: false, reverseBase: true }
];

export function buildDefinition(c: Condition): QuestionSetDefinition {
	const aspects = gameV1.questions
		.filter((q) => q.kind === 'direction')
		.map((q) => q.aspect);
	const baseKeys = c.reverseBase ? [...aspects].reverse() : aspects;
	const base: Question[] = baseKeys.flatMap((key) => gameV1.questions.filter((q) => q.aspect === key));
	const fillers: Question[] = FILLER_ASPECTS.slice(0, (c.size - 8) / 2).flatMap((a) => [direction(a), mention(a)]);
	return {
		...gameV1,
		version: 0,
		questions: c.fillersFirst ? [...fillers, ...base] : [...base, ...fillers]
	};
}

const LABEL: Record<string, Direction> = { 肯定: 'positive', 否定: 'negative', 混在: 'mixed', 言及なし: 'none' };

async function run(reviewsPath: string, outPath: string) {
	const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = process.env;
	if (!accountId || !apiToken) throw new Error('CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が必要です');
	const clef = restClient({ accountId, apiToken, timeoutMs: 60_000 });
	const reviews = readFileSync(reviewsPath, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as { id: number; recommendationid?: string; text: string });

	const records: unknown[] = [];
	const save = () => writeFileSync(outPath, JSON.stringify({ model: 'clef-flash', records }, null, 1));
	for (const c of CONDITIONS) {
		const def = buildDefinition(c);
		const questions = toClefQuestions(def);
		for (const review of reviews) {
			const started = Date.now();
			try {
				const result = await clef.run('clef-flash', review.text, questions);
				const all = interpretAnswers(def, result.answers).filter((a) => a.kind === 'direction');
				records.push({
					cond: c.name,
					sample: review.id,
					status: 'ok',
					latencyMs: Date.now() - started,
					inputTokens: result.inputTokens,
					base: all.filter((a) => BASE_ASPECTS.includes(a.aspect)),
					fillerCount: all.length - BASE_ASPECTS.length,
					fillerNotNone: all.filter((a) => !BASE_ASPECTS.includes(a.aspect) && a.value !== 'none').length
				});
			} catch (e) {
				const message = (e as Error).message;
				records.push({ cond: c.name, sample: review.id, status: 'error', error: message });
				if (message.includes('429')) {
					// 無料枠を使い切った。続けても失敗するだけなので、ここまでを保存して止める。
					save();
					console.error('429（利用枠の超過）。ここまでの結果を保存して止めます。');
					process.exit(2);
				}
			}
			console.log(c.name, review.id, (records.at(-1) as { status: string }).status);
		}
		save();
	}
}

interface BaseAnswer {
	aspect: string;
	value: Direction;
	prob: number;
}
interface Rec {
	cond: string;
	sample: number;
	status: string;
	latencyMs?: number;
	inputTokens?: number | null;
	base?: BaseAnswer[];
	fillerCount?: number;
	fillerNotNone?: number;
}

function score(resultsPath: string, labelsPath: string) {
	const records = (JSON.parse(readFileSync(resultsPath, 'utf8')).records as Rec[]).filter((r) => r.status === 'ok');
	const labels = new Map<string, Direction>();
	for (const row of JSON.parse(readFileSync(labelsPath, 'utf8')).labels as Record<string, unknown>[]) {
		for (const a of BASE_ASPECTS) if (typeof row[a] === 'string') labels.set(`${row.id}:${a}`, LABEL[row[a] as string]);
	}
	const byCond = new Map<string, Rec[]>();
	for (const r of records) byCond.set(r.cond, [...(byCond.get(r.cond) ?? []), r]);
	const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : NaN);

	const q8 = new Map((byCond.get('q8') ?? []).map((r) => [r.sample, r]));
	console.log(`ラベルのある回答: ${labels.size}（正解ラベルから）`);
	for (const c of CONDITIONS) {
		const recs = byCond.get(c.name) ?? [];
		let n = 0, correct = 0, changed = 0, compared = 0, maxShift = 0;
		for (const r of recs) {
			for (const a of r.base!) {
				const gold = labels.get(`${r.sample}:${a.aspect}`);
				if (!gold) continue;
				n++;
				correct += a.value === gold ? 1 : 0;
				const ref = q8.get(r.sample)?.base!.find((b) => b.aspect === a.aspect);
				if (ref && c.name !== 'q8') {
					compared++;
					changed += ref.value !== a.value ? 1 : 0;
					maxShift = Math.max(maxShift, Math.abs(ref.prob - a.prob));
				}
			}
		}
		const extra = recs.reduce((s, r) => s + (r.fillerNotNone ?? 0), 0);
		const extraN = recs.reduce((s, r) => s + (r.fillerCount ?? 0), 0);
		console.log(
			`${c.name.padEnd(18)} レビュー ${String(recs.length).padStart(2)}件  正解 ${correct}/${n}` +
				(c.name === 'q8' ? '' : `  q8と答えが違う ${changed}/${compared}（確率の最大の差 ${maxShift.toFixed(2)}）`) +
				`  足した観点で「言及なし」以外 ${extra}/${extraN}` +
				`  平均 ${mean(recs.map((r) => r.latencyMs!))}ms ${mean(recs.map((r) => r.inputTokens ?? NaN).filter((x) => !Number.isNaN(x)))}トークン`
		);
	}
}

const [command, ...args] = process.argv.slice(2);
if (command === 'run') await run(args[0], args[1]);
else if (command === 'score') score(args[0], args[1]);
else if (command === 'show') {
	for (const c of CONDITIONS) {
		const def = buildDefinition(c);
		console.log(c.name, def.questions.length, def.questions.map((q) => q.key).slice(0, 4).join(','), '...', def.questions.at(-1)!.key);
	}
}
