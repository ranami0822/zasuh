import { database } from '#server/request';
import { rankedWorks, searchWorks, tagOptions } from '#server/pages';
import { CATEGORY_LABEL } from '#messages';
import { CATEGORIES } from '#server/works';
import type { Category } from '#server/question-sets/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const db = database();
	const asked = url.searchParams.get('c');
	const category = (CATEGORIES as readonly string[]).includes(asked ?? '') ? (asked as Category) : 'game';
	const tags = await tagOptions(db, category);
	const tagParam = url.searchParams.get('t');
	const tag = tags.find((t) => t.id === tagParam)?.id;
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	return {
		q,
		hits: q ? await searchWorks(db, q) : [],
		category,
		categories: CATEGORIES.map((id) => ({ id, label: CATEGORY_LABEL[id] })),
		tags,
		tag: tag ?? null,
		works: await rankedWorks(db, category, tag)
	};
};
