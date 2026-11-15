export type Status = 'draft' | 'limited' | 'public';

export interface Doc {
	id: string;
	title: string;
	body: string;
	status: Status;
	createdAt: number;
	updatedAt: number;
	/** 共感されたら名乗る（投稿ごとのトグル。いつでも変えられる） */
	reveal?: boolean;
	/** サーバーとのつながり。pending は、送る待ち（オフラインや失敗のとき） */
	remote?: { postId?: string; pending: boolean };
}
