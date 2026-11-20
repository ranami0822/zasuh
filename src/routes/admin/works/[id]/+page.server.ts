import { error, fail } from '@sveltejs/kit';
import { database } from '#server/request';
import { latest, REGISTRY } from '#server/tags';
import { getWork, selectedTagIds, updateWork } from '#server/works';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const db = database();
	const work = await getWork(db, { id: params.id });
	if (!work) error(404, '作品が見つかりません');
	return {
		work,
		selected: await selectedTagIds(db, work.id),
		domain: REGISTRY.domainTags[work.category].map((id) => latest(REGISTRY, id).label),
		extras: REGISTRY.extraTags[work.category].map((id) => ({ id, label: latest(REGISTRY, id).label }))
	};
};

const ERRORS: Record<string, string> = {
	bad_name: '名前は、1〜100文字にしてください。',
	bad_url: 'リンクは、http か https で始まる URL にしてください。',
	summary_too_long: '紹介文は、500文字以内にしてください。',
	bad_band: 'タイトルの帯の色が、正しくないか、文字が読みにくくなる組み合わせです。',
	bad_tags: 'タグの選択が正しくありません。',
	not_found: '作品が見つかりません。'
};

export const actions: Actions = {
	save: async ({ request, params }) => {
		const form = await request.formData();
		const input = {
			name: String(form.get('name') ?? ''),
			url: String(form.get('url') ?? ''),
			summary: String(form.get('summary') ?? ''),
			status: String(form.get('status') ?? 'active'),
			bandFrom: String(form.get('bandFrom') ?? ''),
			bandTo: String(form.get('bandTo') ?? '')
		};
		const tags = form.getAll('tags').map(String);
		const result = await updateWork(database(), params.id, input, tags, new Date());
		if (!result.ok) return fail(400, { error: ERRORS[result.error] ?? '保存できませんでした。' });
		return { saved: true };
	}
};
