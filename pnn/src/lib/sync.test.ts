import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { newDoc } from './docs';
import { createMemoryStore } from './store';
import { createSync, markPending } from './sync';
import type { Doc } from './types';

function setup(fail?: () => Error | null) {
	const store = createMemoryStore();
	const calls: [string, string, unknown][] = [];
	const call = vi.fn(async (m: string, p: string, d?: unknown) => {
		calls.push([m, p, d]);
		const err = fail?.();
		if (err) throw err;
		return { id: 'post-1' } as never;
	});
	const onNeedLogin = vi.fn();
	const sync = createSync(store, { delay: 10, call: call as never, onNeedLogin });
	return { store, calls, sync, onNeedLogin };
}
const doc = (p: Partial<Doc>): Doc => ({ ...newDoc(1), id: 'doc-1', title: '題', body: '本文', ...p });

describe('sync', () => {
	it('下書きは、送らない', () => {
		expect(markPending(doc({ status: 'draft' })).remote).toBeUndefined();
	});

	it('公開にすると、送って、投稿の ID を覚える', async () => {
		const { store, calls, sync } = setup();
		const d = markPending(doc({ status: 'public', reveal: true }));
		await store.put(d);
		await sync.run(d.id);
		expect(calls).toEqual([['PUT', '/api/docs/doc-1', { title: '題', body: '本文', visibility: 'public', reveal: true }]]);
		expect((await store.get(d.id))?.remote).toEqual({ postId: 'post-1', pending: false });
	});

	it('限定は limited で送る', async () => {
		const { store, calls, sync } = setup();
		const d = markPending(doc({ status: 'limited' }));
		await store.put(d);
		await sync.run(d.id);
		expect((calls[0][2] as { visibility: string }).visibility).toBe('limited');
	});

	it('下書きに戻すと、取り下げて、つながりを消す', async () => {
		const { store, calls, sync } = setup();
		const d = markPending(doc({ status: 'draft', remote: { postId: 'post-1', pending: false } }));
		await store.put(d);
		await sync.run(d.id);
		expect(calls).toEqual([['DELETE', '/api/docs/doc-1', undefined]]);
		expect((await store.get(d.id))?.remote).toBeUndefined();
	});

	it('失敗したら待ちを残し、retryAll で送り直す', async () => {
		let down = true;
		const { store, sync } = setup(() => (down ? new TypeError('offline') : null));
		const d = markPending(doc({ status: 'public' }));
		await store.put(d);
		await sync.run(d.id);
		expect((await store.get(d.id))?.remote?.pending).toBe(true);
		down = false;
		await sync.retryAll();
		expect((await store.get(d.id))?.remote).toEqual({ postId: 'post-1', pending: false });
	});

	it('ログインが要るときは知らせる', async () => {
		const { store, sync, onNeedLogin } = setup(() => new ApiError(401, 'login required'));
		const d = markPending(doc({ status: 'public' }));
		await store.put(d);
		await sync.run(d.id);
		expect(onNeedLogin).toHaveBeenCalled();
	});

	it('送っているあいだに書き足されたら、待ちを残す', async () => {
		const store = createMemoryStore();
		const d = markPending(doc({ status: 'public', updatedAt: 1 }));
		await store.put(d);
		const call = vi.fn(async () => {
			await store.put({ ...d, body: '書き足し', updatedAt: 2 });
			return { id: 'post-1' };
		});
		const sync = createSync(store, { call: call as never });
		await sync.run(d.id);
		const after = await store.get(d.id);
		expect(after?.body).toBe('書き足し');
		expect(after?.remote).toEqual({ postId: 'post-1', pending: true });
	});
});
