import type { Store } from './store';
import type { Doc } from './types';

export type SaveState = 'ok' | 'saving' | 'error';

export interface Saver {
	/** 変更を知らせる。delay ミリ秒の間、続けて来たものは、最後の1回にまとめる */
	schedule(doc: Doc): void;
	/** 待っているものを、いますぐ書き出す（閉じる前、文書の切り替え前） */
	flush(): Promise<void>;
	/** 待っているものを、書かずに捨てる（その文書を消すとき） */
	cancel(id: string): void;
}

export function createSaver(store: Store, opts: { delay?: number; onState?: (s: SaveState) => void } = {}): Saver {
	const delay = opts.delay ?? 250;
	let pending: Doc | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let inflight: Promise<void> = Promise.resolve();

	const write = (): Promise<void> => {
		if (timer) { clearTimeout(timer); timer = undefined; }
		const doc = pending;
		pending = undefined;
		if (!doc) return inflight;
		opts.onState?.('saving');
		// 書き出しは順番に行う（古い版が、新しい版を上書きしない）
		inflight = inflight
			.then(() => store.put(doc))
			.then(() => { if (!pending) opts.onState?.('ok'); })
			.catch(() => {
				// 失敗しても、入力は続けられる。次の変更で、また書く
				pending ??= doc;
				opts.onState?.('error');
			});
		return inflight;
	};

	return {
		schedule(doc) {
			pending = doc;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => void write(), delay);
		},
		flush: write,
		cancel(id) {
			if (pending?.id === id) {
				pending = undefined;
				if (timer) { clearTimeout(timer); timer = undefined; }
			}
		}
	};
}
