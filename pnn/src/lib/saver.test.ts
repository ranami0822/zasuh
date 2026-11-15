import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStore, type Store } from './store';
import { createSaver, type SaveState } from './saver';
import { newDoc } from './docs';

describe('saver', () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); });

	it('続けて来た変更は、最後の1回にまとめて、250ms 後に書く', async () => {
		const store = createMemoryStore();
		const spy = vi.spyOn(store, 'put');
		const saver = createSaver(store);
		const d = newDoc();
		saver.schedule({ ...d, body: 'a' });
		await vi.advanceTimersByTimeAsync(100);
		saver.schedule({ ...d, body: 'ab' });
		await vi.advanceTimersByTimeAsync(100);
		expect(spy).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(200);
		expect(spy).toHaveBeenCalledTimes(1);
		expect((await store.get(d.id))?.body).toBe('ab');
	});

	it('flush で、待たずにいますぐ書く', async () => {
		const store = createMemoryStore();
		const saver = createSaver(store);
		const d = { ...newDoc(), body: 'x' };
		saver.schedule(d);
		await saver.flush();
		expect((await store.get(d.id))?.body).toBe('x');
	});

	it('cancel で、その文書の待ちを捨てる', async () => {
		const store = createMemoryStore();
		const saver = createSaver(store);
		const d = { ...newDoc(), body: 'x' };
		saver.schedule(d);
		saver.cancel(d.id);
		await vi.advanceTimersByTimeAsync(500);
		expect(await store.get(d.id)).toBeUndefined();
	});

	it('書き出しは順番に行い、古い版が新しい版を上書きしない', async () => {
		const mem = createMemoryStore();
		const order: string[] = [];
		const store: Store = {
			...mem,
			async put(doc) {
				// 最初の書き出しを遅くする
				if (doc.body === 'old') await new Promise((r) => setTimeout(r, 300));
				order.push(doc.body);
				await mem.put(doc);
			}
		};
		const saver = createSaver(store, { delay: 10 });
		const d = newDoc();
		saver.schedule({ ...d, body: 'old' });
		await vi.advanceTimersByTimeAsync(20);
		saver.schedule({ ...d, body: 'new' });
		await vi.advanceTimersByTimeAsync(1000);
		expect(order).toEqual(['old', 'new']);
		expect((await mem.get(d.id))?.body).toBe('new');
	});

	it('失敗は error で知らせ、次の変更でまた書く', async () => {
		const mem = createMemoryStore();
		let fail = true;
		const store: Store = { ...mem, async put(doc) { if (fail) throw new Error('quota'); await mem.put(doc); } };
		const states: SaveState[] = [];
		const saver = createSaver(store, { onState: (s) => states.push(s) });
		const d = { ...newDoc(), body: 'x' };
		saver.schedule(d);
		await vi.advanceTimersByTimeAsync(300);
		expect(states.at(-1)).toBe('error');
		fail = false;
		saver.schedule({ ...d, body: 'xy' });
		await vi.advanceTimersByTimeAsync(300);
		expect(states.at(-1)).toBe('ok');
		expect((await mem.get(d.id))?.body).toBe('xy');
	});
});
