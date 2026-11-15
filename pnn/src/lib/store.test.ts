import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIdbStore } from './store';
import { openInitial, isEmpty, labelOf, newDoc } from './docs';

describe('idb store', () => {
	let store: ReturnType<typeof createIdbStore>;
	beforeEach(() => { store = createIdbStore(new IDBFactory()); });

	it('保存して読み出せる', async () => {
		const d = { ...newDoc(1000), title: 'あ', body: 'い' };
		await store.put(d);
		expect(await store.get(d.id)).toEqual(d);
	});

	it('新しい順に並ぶ。上書きで順番が変わる', async () => {
		const a = { ...newDoc(1), id: 'a', updatedAt: 1 };
		const b = { ...newDoc(2), id: 'b', updatedAt: 2 };
		await store.put(a); await store.put(b);
		expect((await store.list()).map((d) => d.id)).toEqual(['b', 'a']);
		await store.put({ ...a, updatedAt: 3 });
		expect((await store.list()).map((d) => d.id)).toEqual(['a', 'b']);
	});

	it('消せる', async () => {
		const d = newDoc();
		await store.put(d);
		await store.remove(d.id);
		expect(await store.get(d.id)).toBeUndefined();
	});

	it('メタを保存できる', async () => {
		expect(await store.getMeta('last')).toBeUndefined();
		await store.setMeta('last', 'x');
		expect(await store.getMeta('last')).toBe('x');
	});

	it('読めない文書は、消さずに一覧から飛ばす', async () => {
		const good = { ...newDoc(5), id: 'good', updatedAt: 5 };
		await store.put(good);
		// 壊れたデータを、直接入れる
		const idb = new IDBFactory();
		const raw = createIdbStore(idb);
		await raw.put(good);
		const db: IDBDatabase = await new Promise((res) => { const r = idb.open('pnn', 1); r.onsuccess = () => res(r.result); });
		await new Promise<void>((res) => { const tx = db.transaction('docs', 'readwrite'); tx.objectStore('docs').put({ id: 'bad' }); tx.oncomplete = () => res(); });
		expect((await raw.list()).map((d) => d.id)).toEqual(['good']);
		expect(await raw.get('bad')).toBeUndefined();
	});
});

describe('docs', () => {
	it('最初は空の文書を作り、最後に開いた文書を覚える', async () => {
		const store = createIdbStore(new IDBFactory());
		const first = await openInitial(store);
		expect(isEmpty(first)).toBe(true);
		const again = await openInitial(store);
		expect(again.id).toBe(first.id);
	});

	it('最後に開いた文書があれば、それを開く', async () => {
		const store = createIdbStore(new IDBFactory());
		const a = { ...newDoc(1), id: 'a', title: 'A', updatedAt: 1 };
		const b = { ...newDoc(2), id: 'b', title: 'B', updatedAt: 2 };
		await store.put(a); await store.put(b);
		await store.setMeta('last', 'a');
		expect((await openInitial(store)).id).toBe('a');
	});

	it('一覧の名前は、題、なければ本文の最初の行', () => {
		expect(labelOf({ title: '題', body: 'x' })).toBe('題');
		expect(labelOf({ title: ' ', body: '\n# 見出し\nあと' })).toBe('見出し');
		expect(labelOf({ title: '', body: '' })).toBe('');
	});
});
