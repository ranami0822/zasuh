import { fail, redirect } from '@sveltejs/kit';
import { CRITIC_MESSAGES, DISCOVERY_MESSAGES } from '#messages';
import { decideCandidate, openCandidates } from '#server/critics';
import { listMessages, setMessageStatus } from '#server/inbox';
import { approveWorkCandidate, discoverCandidates, openWorkCandidates, rejectWorkCandidate } from '#server/discovery';
import { createOpenCriticClient, normalizeKey } from '#server/opencritic';
import { database, runtimeEnv } from '#server/request';
import { createWikipediaClient } from '#server/wikipedia';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const kind = url.searchParams.get('kind') ?? '';
	return { kind, items: await listMessages(database(), { kind }), candidates: await openCandidates(database()), workCandidates: await openWorkCandidates(database()) };
};

export const actions: Actions = {
	status: async ({ request }) => {
		const form = await request.formData();
		const ok = await setMessageStatus(database(), String(form.get('id') ?? ''), form.get('status') === 'open' ? 'open' : 'closed');
		if (!ok) return fail(400, { error: '操作できませんでした。ページを開き直してください。' });
		return { ok: true };
	},
	discoverWorks: async () => {
		const key = normalizeKey(runtimeEnv().OPENCRITIC_API_KEY);
		if (!key) return fail(503, { discoverError: DISCOVERY_MESSAGES.no_key });
		const r = await discoverCandidates({ db: database(), oc: createOpenCriticClient({ key }), wiki: createWikipediaClient(), now: new Date() });
		console.log(JSON.stringify({ event: 'work_discovery', ...r }));
		// 一覧が 1 つも取れなかったときだけ失敗にする（途中まで取れたものは、候補に入っている）。
		if (r.error && r.listed === 0) return fail(502, { discoverError: DISCOVERY_MESSAGES[r.error] });
		return { discovered: r };
	},
	approveWork: async ({ request }) => {
		const ocId = Number((await request.formData()).get('ocId'));
		const r = await approveWorkCandidate(database(), ocId, new Date());
		if (!r.ok) return fail(400, { discoverError: DISCOVERY_MESSAGES[r.error] });
		console.log(JSON.stringify({ event: 'work_candidate_approved', ocId, workId: r.workId }));
		redirect(303, `/admin/works/${r.workId}`);
	},
	rejectWork: async ({ request }) => {
		const ocId = Number((await request.formData()).get('ocId'));
		if (!(await rejectWorkCandidate(database(), ocId))) return fail(400, { discoverError: DISCOVERY_MESSAGES.not_found });
		return { workRejected: true };
	},
	approveCandidate: async ({ request }) => {
		return decideFromForm(request, true);
	},
	rejectCandidate: async ({ request }) => {
		return decideFromForm(request, false);
	}
};

async function decideFromForm(request: Request, approved: boolean) {
	const form = await request.formData();
	const workId = String(form.get('workId') ?? '');
	const result = await decideCandidate(database(), workId, approved, new Date());
	if (!result.ok) return fail(400, { candidateError: CRITIC_MESSAGES[result.error] });
	console.log(JSON.stringify({ event: 'critic_candidate_decided', workId, approved }));
	return { candidateDecided: true };
}
