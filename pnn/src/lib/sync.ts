import { api as realApi, ApiError } from './api';
import type { Store } from './store';
import type { Doc } from './types';

/**
 * 公開・限定の文書を、サーバーへ送る（docs/pnn-server-design.md の第7節）。
 * 端末への保存とは別に、少し待ってから送る。失敗したら remote.pending を残し、あとで送り直す。
 * 下書きに戻した文書は、サーバーから取り下げる。
 */
export interface Sync {
	schedule(doc: Doc): void;
	/** 待っているものを、いますぐ送る */
	run(id: string): Promise<void>;
	/** 送る待ちの文書を、すべて送り直す（開いたとき、オンラインに戻ったとき） */
	retryAll(): Promise<void>;
}

/** 文書を変えたとき、送る待ちの印を付ける（page から呼ぶ） */
export function markPending(doc: Doc): Doc {
	const needs = doc.status !== 'draft' || !!doc.remote?.postId;
	return needs ? { ...doc, remote: { ...doc.remote, pending: true } } : doc;
}

export function createSync(
	store: Store,
	opts: {
		delay?: number;
		call?: typeof realApi;
		onChange?: (doc: Doc) => void;
		onNeedLogin?: () => void;
	} = {}
): Sync {
	const delay = opts.delay ?? 2000;
	const call = opts.call ?? realApi;
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const running = new Map<string, Promise<void>>();

	async function settle(id: string, sentAt: number, remote: Doc['remote']) {
		const latest = await store.get(id);
		if (!latest) return;
		// 送っているあいだに書き足されていたら、待ちを残す（次の送信で送る）
		const next: Doc = { ...latest, remote: remote && { ...remote, pending: latest.updatedAt > sentAt } };
		if (!next.remote) delete next.remote;
		await store.put(next);
		opts.onChange?.(next);
	}

	async function send(id: string) {
		const doc = await store.get(id);
		if (!doc) return;
		try {
			if (doc.status === 'draft') {
				if (doc.remote?.postId) await call('DELETE', `/api/docs/${id}`);
				await settle(id, doc.updatedAt, undefined);
			} else {
				const res = await call<{ id: string }>('PUT', `/api/docs/${id}`, {
					title: doc.title,
					body: doc.body,
					visibility: doc.status === 'public' ? 'public' : 'limited',
					reveal: !!doc.reveal
				});
				await settle(id, doc.updatedAt, { postId: res.id, pending: false });
			}
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) opts.onNeedLogin?.();
			// 待ちの印は、page が付けたまま残る。あとで送り直す
		}
	}

	function run(id: string): Promise<void> {
		const t = timers.get(id);
		if (t) { clearTimeout(t); timers.delete(id); }
		// 同じ文書の送信は、順番に
		const prev = running.get(id) ?? Promise.resolve();
		const p = prev.then(() => send(id));
		running.set(id, p);
		return p;
	}

	return {
		schedule(doc) {
			if (!doc.remote?.pending) return;
			const t = timers.get(doc.id);
			if (t) clearTimeout(t);
			timers.set(doc.id, setTimeout(() => void run(doc.id), delay));
		},
		run,
		async retryAll() {
			for (const d of await store.list()) if (d.remote?.pending) await run(d.id);
		}
	};
}
