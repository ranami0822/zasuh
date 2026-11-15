export type Status = 'draft' | 'limited' | 'public';

export interface Doc {
	id: string;
	title: string;
	body: string;
	status: Status;
	createdAt: number;
	updatedAt: number;
	/** 公開の予約。サーバーができるまでは、待ち行列に入るだけ。 */
	publish?: { requestedAt: number; status: 'queued' | 'sent' | 'failed' };
}
