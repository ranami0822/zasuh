import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

/** 1 回と数える、文のメソッド。bind と prepare は数えない。 */
const COUNTED_METHODS: readonly PropertyKey[] = ['first', 'all', 'run', 'raw'];

/**
 * D1 への問い合わせを数える（docs/critics-incremental-plan.md の 3.6）。
 * 数えるもの: prepare した文の first / all / run / raw を、1 回ずつ。db.batch() は、文の数に関わらず、1 回
 * （無料の D1 の「1 回の呼び出しで 50 問い合わせ」の数え方。公式の文書）。prepare と bind だけでは、数えない。
 * 渡した db の動きは、変えない。
 */
export function countQueries(db: D1Database): { db: D1Database; count: () => number; reset: () => void } {
	let n = 0;
	// 包んだ文 → 元の文。db.batch() に渡すとき、元の文に直す。
	const originals = new WeakMap<object, D1PreparedStatement>();

	const wrapStatement = (original: D1PreparedStatement): D1PreparedStatement => {
		const wrapped = new Proxy(original, {
			get(target, prop) {
				if (prop === 'bind') {
					// bind した文も、元の文への参照を持つ形で包む。
					return (...values: unknown[]) => wrapStatement(target.bind(...values));
				}
				if (COUNTED_METHODS.includes(prop)) {
					return (...args: unknown[]) => {
						n++;
						return Reflect.apply(Reflect.get(target, prop, target), target, args);
					};
				}
				const value = Reflect.get(target, prop, target);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});
		originals.set(wrapped, original);
		return wrapped;
	};

	const counted = new Proxy(db, {
		get(target, prop) {
			if (prop === 'prepare') {
				return (query: string) => wrapStatement(target.prepare(query));
			}
			if (prop === 'batch') {
				return (statements: D1PreparedStatement[]) => {
					n++;
					return target.batch(statements.map((s) => originals.get(s) ?? s));
				};
			}
			// dump、exec、withSession など、ほかのものは、数えずに、元の db にそのまま渡す。
			const value = Reflect.get(target, prop, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});

	return {
		db: counted,
		count: () => n,
		reset: () => {
			n = 0;
		}
	};
}
