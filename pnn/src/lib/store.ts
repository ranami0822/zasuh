import type { Doc } from './types';

/** 保存と読み込みは、この口に閉じる。テストでは memoryStore に差し替える。 */
export interface Store {
	get(id: string): Promise<Doc | undefined>;
	put(doc: Doc): Promise<void>;
	remove(id: string): Promise<void>;
	/** 新しい順 */
	list(): Promise<Doc[]>;
	getMeta(key: string): Promise<string | undefined>;
	setMeta(key: string, value: string): Promise<void>;
}

const DB = 'pnn';
const VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
	return new Promise((res, rej) => {
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((res, rej) => {
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
		tx.onabort = () => rej(tx.error ?? new Error('transaction aborted'));
	});
}

function isDoc(x: unknown): x is Doc {
	const d = x as Doc;
	return !!d && typeof d.id === 'string' && typeof d.title === 'string' && typeof d.body === 'string' && typeof d.updatedAt === 'number';
}

export function createIdbStore(factory: IDBFactory = indexedDB): Store {
	let opened: Promise<IDBDatabase> | undefined;
	const open = () =>
		(opened ??= new Promise<IDBDatabase>((res, rej) => {
			const r = factory.open(DB, VERSION);
			r.onupgradeneeded = () => {
				const db = r.result;
				const docs = db.createObjectStore('docs', { keyPath: 'id' });
				docs.createIndex('updatedAt', 'updatedAt');
				db.createObjectStore('meta', { keyPath: 'key' });
			};
			r.onsuccess = () => res(r.result);
			r.onerror = () => rej(r.error);
		}));

	return {
		async get(id) {
			const db = await open();
			const v = await req(db.transaction('docs').objectStore('docs').get(id));
			return isDoc(v) ? v : undefined;
		},
		async put(doc) {
			const db = await open();
			const tx = db.transaction('docs', 'readwrite');
			tx.objectStore('docs').put(doc);
			await done(tx);
		},
		async remove(id) {
			const db = await open();
			const tx = db.transaction('docs', 'readwrite');
			tx.objectStore('docs').delete(id);
			await done(tx);
		},
		async list() {
			const db = await open();
			const all = (await req(db.transaction('docs').objectStore('docs').getAll())) as unknown[];
			// 読めない文書は消さずに飛ばす
			return all.filter(isDoc).sort((a, b) => b.updatedAt - a.updatedAt);
		},
		async getMeta(key) {
			const db = await open();
			const v = (await req(db.transaction('meta').objectStore('meta').get(key))) as { value: string } | undefined;
			return v?.value;
		},
		async setMeta(key, value) {
			const db = await open();
			const tx = db.transaction('meta', 'readwrite');
			tx.objectStore('meta').put({ key, value });
			await done(tx);
		}
	};
}

export function createMemoryStore(): Store {
	const docs = new Map<string, Doc>();
	const meta = new Map<string, string>();
	return {
		async get(id) { const d = docs.get(id); return d && structuredClone(d); },
		async put(doc) { docs.set(doc.id, structuredClone(doc)); },
		async remove(id) { docs.delete(id); },
		async list() { return [...docs.values()].map((d) => structuredClone(d)).sort((a, b) => b.updatedAt - a.updatedAt); },
		async getMeta(k) { return meta.get(k); },
		async setMeta(k, v) { meta.set(k, v); }
	};
}
