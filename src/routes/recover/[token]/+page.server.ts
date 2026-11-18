import { checkEmailToken } from '#server/auth';
import { database } from '#server/request';
import type { PageServerLoad } from './$types';

/** リンクを開いただけでは、使い切らない（メールの自動の確認に、先に開かれても、使えるように）。 */
export const load: PageServerLoad = async ({ params }) => ({
	valid: await checkEmailToken(database(), params.token, 'recover', new Date()),
	token: params.token
});
