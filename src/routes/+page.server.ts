import { database } from '#server/request';
import { rankedWorks, tagOptions } from '#server/pages';
import { CATEGORY_LABEL } from '#messages';
import { CATEGORIES } from '#server/works';
import type { Category } from '#server/question-sets/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, platform }) => {
	const db = database(platform);
	const asked = url.searchParams.get('c');
	const category = (CATEGORIES as readonly string[]).includes(asked ?? '') ? (asked as Category) : 'game';
	const tags = await tagOptions(db, category);
	const tagParam = url.searchParams.get('t');
	const tag = tags.find((t) => t.id === tagParam)?.id;
	return {
		category,
		categories: CATEGORIES.map((id) => ({ id, label: CATEGORY_LABEL[id] })),
		tags,
		tag: tag ?? null,
		works: await rankedWorks(db, category, tag)
	};
};
