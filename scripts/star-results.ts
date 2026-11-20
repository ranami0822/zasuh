/**
 * 星の実験の、読み取り結果（`eval-star.ts run` の出力）の読み方。通信しない。
 * 結果のファイルには、レビューの本文を含めない（識別子と回答だけ）。
 */
import type { ReadingAnswer } from '../src/lib/server/reading';
import { stability } from './star-metrics';
import type { ConditionName } from './star-questions';

export interface RunRecord {
	sample: number;
	run: number;
	recommendationid?: string;
	votedUp?: boolean;
	status: 'ok' | 'error';
	error?: string;
	latencyMs?: number;
	inputTokens?: number | null;
	answers?: ReadingAnswer[];
}
export interface Results {
	condition: ConditionName;
	model: string;
	questionSetHash: string;
	records: RunRecord[];
}

/** 回ごとの、観点ごとの答え。 */
export interface Item {
	direction?: ReadingAnswer;
	mention?: ReadingAnswer;
	star?: ReadingAnswer;
	votedUp?: boolean;
}

export function byItem(results: Results, run: number) {
	const out = new Map<string, Item>();
	for (const r of results.records.filter((x) => x.status === 'ok' && x.run === run)) {
		for (const a of r.answers!) {
			const item = out.get(`${r.sample}:${a.aspect}`) ?? { votedUp: r.votedUp };
			item[a.kind] = a;
			out.set(`${r.sample}:${a.aspect}`, item);
		}
	}
	return out;
}


export interface Comparison {
	/** 言及のある共通の項目での、星の安定性。星がなければ null。 */
	star: { n: number; changed: number; meanAbsDiff: number } | null;
	/** 向き（choice）の答えが変わった割合。choice がなければ null。 */
	direction: { n: number; changed: number } | null;
}

/**
 * 同じ項目を、条件（言い換え、順序、繰り返し）を変えて読んだ2つの結果を比べる。回は、指定がなければ、どちらも 0 回目（S1 の繰り返しは、同じファイルを2つ渡して、回を変える）。
 * 星: どちらかの読み取りで言及ありと答えた共通の項目だけ。言及のない項目の星は、使わない。
 * 向き: 共通の項目すべて（B0 と B0-V2 の比較が、星の安定性の基準になる）。
 */
export function compareRuns(a: Results, b: Results, runA = 0, runB = 0): Comparison {
	const ia = byItem(a, runA);
	const ib = byItem(b, runB);
	const keys = [...ia.keys()].filter((k) => ib.has(k));
	const mentioned = (k: string) => ia.get(k)!.mention?.value === 'true' || ib.get(k)!.mention?.value === 'true';
	const starKeys = keys.filter((k) => ia.get(k)!.star && ib.get(k)!.star && mentioned(k));
	const s = stability(
		starKeys.map((k) => ia.get(k)!.star!.star!.score),
		starKeys.map((k) => ib.get(k)!.star!.star!.score)
	);
	const dirKeys = keys.filter((k) => ia.get(k)!.direction && ib.get(k)!.direction);
	const changed = dirKeys.filter((k) => ia.get(k)!.direction!.value !== ib.get(k)!.direction!.value).length;
	return {
		star: s.n > 0 ? { n: s.n, changed: s.changed, meanAbsDiff: s.meanAbsDiff } : null,
		direction: dirKeys.length > 0 ? { n: dirKeys.length, changed: changed / dirKeys.length } : null
	};
}
