/** サーバーの API を呼ぶ。失敗は ApiError（status つき） */
export class ApiError extends Error {
	constructor(public status: number, message: string) { super(message); }
}

export async function api<T = unknown>(method: string, path: string, data?: unknown, f: typeof fetch = fetch): Promise<T> {
	const res = await f(path, {
		method,
		headers: data === undefined ? {} : { 'content-type': 'application/json' },
		body: data === undefined ? undefined : JSON.stringify(data),
		credentials: 'same-origin'
	});
	const out = await res.json().catch(() => ({}));
	if (!res.ok) throw new ApiError(res.status, (out as { error?: string }).error ?? res.statusText);
	return out as T;
}

export interface PostView {
	id: string; title: string; body: string; visibility: 'public' | 'limited';
	createdAt: number; updatedAt: number; likes: number; replies: number;
	author: { handle: string; name: string } | null;
}
export interface ReplyView { id: string; body: string; createdAt: number; byAuthor: boolean; mine: boolean; hidden: boolean }
export interface PostDetail {
	post: PostView; replies: ReplyView[]; liked: boolean; saved: boolean; isAuthor: boolean;
	own?: { reveal: boolean; counted: number; threshold: number; hasHandle: boolean };
}
export interface Me { handle: string | null; name: string; bio: string; followers: number; createdAt: number; posts: PostView[] }
export interface Profile { handle: string; name: string; bio: string; posts: PostView[]; following: boolean; isMe: boolean }
