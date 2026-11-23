import { error, fail } from '@sveltejs/kit';
import { CRITIC_MESSAGES, CRITIC_SYNC_MESSAGES } from '#messages';
import { revisionsWithoutStars } from '#server/admin-data';
import { bindingClient } from '#server/clef';
import { DEFAULT_CRITIC_LIMITS, syncCriticsNow } from '#server/critic-sync';
import { getOpenCriticId, linkOpenCritic } from '#server/critics';
import { createOpenCriticClient, normalizeKey, type OpenCriticClient } from '#server/opencritic';
import { readRevision } from '#server/reading';
import { database, runtimeEnv } from '#server/request';
import { latest, REGISTRY } from '#server/tags';
import { getWork, selectedTagIds, updateWork } from '#server/works';
import type { Actions, PageServerLoad } from './$types';

/**
 * 星で読み直す、1回の操作あたりの件数。
 * 無料の D1 は、1回の呼び出しあたり 50 問い合わせまで。読み直し1件で、最初は 12 回、そのあとは 9 回ほど使う（担当の測定）ので、4 件で約 39 回。
 */
const REREAD_LIMIT = 4;

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
		rereadLimit: REREAD_LIMIT,
		criticReadLimit: DEFAULT_CRITIC_LIMITS.maxReads
	};
};

/**
 * 取得した抜粋の数と、点数が取れた数と、応答の項目の名前（最初に返ったページのもの）を数える（管理画面の帯に出す）。
 * OpenCritic の応答の項目名を、実際の応答で確かめ、点数の読み方を直すため（docs/mvp-design.md の 22.12）。
 */
function tallyReviews(oc: OpenCriticClient) {
	const tally = { snippets: 0, scored: 0, fields: [] as string[] };
	const counted: OpenCriticClient = {
		searchGame: (name) => oc.searchGame(name),
		async reviewsOfGame(ocId, skip) {
			const page = await oc.reviewsOfGame(ocId, skip);
			if (page.ok) {
				tally.snippets += page.value.snippets.length;
				tally.scored += page.value.snippets.filter((s) => s.ocScore !== null).length;
				if (tally.fields.length === 0) tally.fields = page.value.fields;
			}
			return page;
		}
	};
	return { oc: counted, tally };
}

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
	},
	// 専門家の評価を、時間帯を待たずに、この作品だけ、1 回分取得する（docs/mvp-design.md の 22.11）。依存の作り方は scheduled.ts と同じ。
	syncCritics: async ({ params }) => {
		const db = database();
		if ((await getOpenCriticId(db, params.id)) === null) return fail(400, { criticSyncError: CRITIC_SYNC_MESSAGES.no_oc_id });
		const env = runtimeEnv();
		const key = normalizeKey(env.OPENCRITIC_API_KEY);
		if (!key) return fail(503, { criticSyncError: CRITIC_SYNC_MESSAGES.no_key });
		try {
			const { oc, tally } = tallyReviews(createOpenCriticClient({ key }));
			const result = await syncCriticsNow({ db, clef: bindingClient(env.AI), oc, workId: params.id });
			const ok = result.stopped === 'done' || result.stopped === 'budget';
			const message = CRITIC_SYNC_MESSAGES[result.stopped === 'done' && result.works === 0 ? 'nothing' : result.stopped];
			// 点数が 0 件のときも出す（項目の名前を見て、読み方を直すため）。値は出さない。
			const scores = `点数が取れた抜粋: ${tally.scored}件 / 取得した抜粋: ${tally.snippets}件`;
			const fields = `OpenCritic の応答の項目: ${tally.fields.length > 0 ? tally.fields.join(', ') : '（なし）'}`;
			return { criticSync: { read: result.read, calls: result.calls, failed: result.failed, ok, message, scores, fields } };
		} catch (e) {
			// メッセージに、本文やキーは含まれない（scheduled.ts と同じ）。
			console.error(JSON.stringify({ event: 'critic_sync_failed', workId: params.id, message: String(e).slice(0, 200) }));
			return fail(500, { criticSyncError: CRITIC_SYNC_MESSAGES.failed });
		}
	}
};
