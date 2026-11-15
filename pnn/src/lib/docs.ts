import type { Store } from './store';
import type { Doc, Status } from './types';

export function newDoc(now = Date.now()): Doc {
	return { id: crypto.randomUUID(), title: '', body: '', status: 'draft', createdAt: now, updatedAt: now };
}

export function isEmpty(d: Pick<Doc, 'title' | 'body'>): boolean {
	return d.title.trim() === '' && d.body.trim() === '';
}

/** 開いたらすぐ書けるように、最後に開いた文書か、空の文書を返す（一覧は先に出さない） */
export async function openInitial(store: Store): Promise<Doc> {
	const last = await store.getMeta('last');
	if (last) {
		const d = await store.get(last);
		if (d) return d;
	}
	const [latest] = await store.list();
	if (latest) return latest;
	const d = newDoc();
	await store.put(d);
	await store.setMeta('last', d.id);
	return d;
}

/** 一覧に出す名前。題が無ければ、本文の最初の行 */
export function labelOf(d: Pick<Doc, 'title' | 'body'>): string {
	const t = d.title.trim();
	if (t) return t;
	const first = d.body.split('\n').find((l) => l.trim() !== '');
	return first ? first.replace(/^[#>\-\s]+/, '').slice(0, 24) : '';
}

export const statusOrder: Status[] = ['draft', 'limited', 'public'];
export const statusLabel: Record<Status, string> = { draft: '下書き', limited: '限定', public: '公開' };
