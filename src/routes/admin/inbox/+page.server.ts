import { fail } from '@sveltejs/kit';
import { CRITIC_MESSAGES } from '#messages';
import { decideCandidate, openCandidates } from '#server/critics';
import { listMessages, setMessageStatus } from '#server/inbox';
import { database } from '#server/request';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const kind = url.searchParams.get('kind') ?? '';
	return { kind, items: await listMessages(database(), { kind }), candidates: await openCandidates(database()) };
};

export const actions: Actions = {
	status: async ({ request }) => {
		const form = await request.formData();
		const ok = await setMessageStatus(database(), String(form.get('id') ?? ''), form.get('status') === 'open' ? 'open' : 'closed');
		if (!ok) return fail(400, { error: '操作できませんでした。ページを開き直してください。' });
		return { ok: true };
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
