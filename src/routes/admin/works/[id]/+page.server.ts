import { error, fail } from '@sveltejs/kit';
import { CRITIC_MESSAGES } from '#messages';
import { revisionsWithoutStars } from '#server/admin-data';
import { bindingClient } from '#server/clef';
import { getOpenCriticId, linkOpenCritic } from '#server/critics';
import { readRevision } from '#server/reading';
import { database, runtimeEnv } from '#server/request';
import { latest, REGISTRY } from '#server/tags';
import { getWork, selectedTagIds, updateWork } from '#server/works';
import type { Actions, PageServerLoad } from './$types';

/** 星で読み直す、1回の操作あたりの件数。 */
const REREAD_LIMIT = 10;

export const load: PageServerLoad = async ({ params }) => {
	const db = database();
	const work = await getWork(db, { id: params.id });
	if (!work) error(404, '作品が見つかりません');
	return {
		work,
		openCriticId: await getOpenCriticId(db, work.id),
		selected: await selectedTagIds(db, work.id),
		domain: REGISTRY.domainTags[work.category].map((id) => latest(REGISTRY, id).label),
		extras: REGISTRY.extraTags[work.category].map((id) => ({ id, label: latest(REGISTRY, id).label })),
		withoutStars: (await revisionsWithoutStars(db, work.id)).length,
		rereadLimit: REREAD_LIMIT
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
	},
	linkCritic: async ({ request, params }) => {
		const form = await request.formData();
		const ocId = String(form.get('ocId') ?? '');
		const result = await linkOpenCritic(database(), params.id, ocId, new Date());
		if (!result.ok) return fail(400, { criticError: CRITIC_MESSAGES[result.error], ocId });
		console.log(JSON.stringify({ event: 'critic_linked', workId: params.id }));
		return { criticLinked: true, ocId };
	},
	// 星を入れる前に読んだレビューを、いまの質問の組で読み直す。並列にせず、1件ずつ。
	rereadStars: async ({ params }) => {
		const db = database();
		const deps = { db, clef: bindingClient(runtimeEnv().AI) };
		const revisionIds = (await revisionsWithoutStars(db, params.id)).slice(0, REREAD_LIMIT);
		const reread = { ok: 0, skipped: 0, error: 0 };
		for (const revisionId of revisionIds) {
			try {
				reread[(await readRevision(deps, revisionId, { reread: true })).status]++;
			} catch (e) {
				// 1件の失敗で、残りを止めない。
				reread.error++;
				console.error(JSON.stringify({ event: 'reread_failed', revisionId, message: String(e) }));
			}
		}
		console.log(JSON.stringify({ event: 'stars_reread', workId: params.id, ...reread }));
		return { reread };
	}
};
