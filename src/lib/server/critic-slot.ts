/**
 * 専門家（批評家）の取得の、時間帯と枠（docs/critics-incremental-plan.md の 3.1）。D1 を知らない、純粋な関数。
 * 毎分の定期実行のうち、時間帯の中だけ取得を呼ぶ。1 枠（intervalMinutes 分）につき、取得は 1 回だけ（枠の取得は critics.ts の claimCriticSlot）。
 */

export interface CriticSlotConfig {
	/** 時間帯の始まり（UTC の時、含む）と終わり（含まない）。 */
	startHourUtc: number;
	endHourUtc: number;
	/** 枠の長さ（分）。60 を割り切れる値。 */
	intervalMinutes: number;
}

export const CRITIC_SLOT_CONFIG: CriticSlotConfig = { startHourUtc: 17, endHourUtc: 21, intervalMinutes: 5 };

/** now が入る枠の名前（'YYYY-MM-DDTHH:MM'。UTC。枠の頭の時刻）。時間帯の外なら null。 */
export function criticSyncSlot(now: Date, config: CriticSlotConfig = CRITIC_SLOT_CONFIG): string | null {
	const hour = now.getUTCHours();
	if (hour < config.startHourUtc || hour >= config.endHourUtc) return null;

	const minute = Math.floor(now.getUTCMinutes() / config.intervalMinutes) * config.intervalMinutes;
	const pad = (n: number, width = 2) => String(n).padStart(width, '0');
	const date = `${pad(now.getUTCFullYear(), 4)}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
	return `${date}T${pad(hour)}:${pad(minute)}`;
}
