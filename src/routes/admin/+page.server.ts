import { fail, redirect } from '@sveltejs/kit';
import { adminOverview } from '#server/admin-data';
import { database } from '#server/request';
import { createWork } from '#server/works';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => ({
	...(await adminOverview(database())),
	// 受信箱の「作品として登録する」から来たときの、入力済みの値。
	prefill: {
		slug: '',
		name: url.searchParams.get('name') ?? '',
		category: url.searchParams.get('category') === 'software' ? 'software' : 'game',
		url: url.searchParams.get('url') ?? '',
		summary: '',
		bandFrom: null as string | null,
		bandTo: null as string | null
	}
});

const ERRORS: Record<string, string> = {
	bad_slug: 'URL 用の名前は、小文字の英数字とハイフンで、63文字以内にしてください。',
	slug_taken: 'その URL 用の名前は、すでに使われています。',
	bad_name: '名前は、1〜100文字にしてください。',
	bad_category: '分野を選んでください。',
	bad_url: 'リンクは、http か https で始まる URL にしてください。',
	summary_too_long: '紹介文は、500文字以内にしてください。',
	bad_band: 'タイトルの帯の色が、正しくないか、文字が読みにくくなる組み合わせです。'
};

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const values = {
			slug: String(form.get('slug') ?? ''),
			name: String(form.get('name') ?? ''),
			category: String(form.get('category') ?? ''),
			url: String(form.get('url') ?? ''),
			summary: String(form.get('summary') ?? ''),
			bandFrom: String(form.get('bandFrom') ?? ''),
			bandTo: String(form.get('bandTo') ?? '')
		};
		const result = await createWork(database(), values, new Date());
		if (!result.ok) return fail(400, { error: ERRORS[result.error] ?? '登録できませんでした。', values: { ...values, bandFrom: values.bandFrom || null, bandTo: values.bandTo || null } });
		redirect(303, `/admin/works/${result.id}`);
	}
};
