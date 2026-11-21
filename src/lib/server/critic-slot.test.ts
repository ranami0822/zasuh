import { describe, expect, it } from 'vitest';
import { CRITIC_SLOT_CONFIG, criticSyncSlot } from '#server/critic-slot';

const at = (iso: string) => new Date(iso);

describe('criticSyncSlot（取得の枠）', () => {
	it('既定は、UTC 17:00〜21:00、5 分おき', () => {
		expect(CRITIC_SLOT_CONFIG).toEqual({ startHourUtc: 17, endHourUtc: 21, intervalMinutes: 5 });
	});

	it('時間帯の始まりは含み、終わりは含まない', () => {
		expect(criticSyncSlot(at('2026-11-21T16:59:59.999Z'))).toBeNull();
		expect(criticSyncSlot(at('2026-11-21T17:00:00.000Z'))).toBe('2026-11-21T17:00');
		expect(criticSyncSlot(at('2026-11-21T20:59:59.999Z'))).toBe('2026-11-21T20:55');
		expect(criticSyncSlot(at('2026-11-21T21:00:00.000Z'))).toBeNull();
	});

	it('時間帯の外は、null（夜中、朝、昼、夜）', () => {
		for (const hm of ['00:00', '06:17', '12:30', '23:59']) {
			expect(criticSyncSlot(at(`2026-11-21T${hm}:00.000Z`))).toBeNull();
		}
	});

	it('同じ枠の中の時刻は、同じ名前。枠の頭の時刻になる（秒・ミリ秒は関係ない）', () => {
		const names = ['17:05:00.000', '17:05:30.500', '17:07:59.999', '17:09:59.999'].map((t) => criticSyncSlot(at(`2026-11-21T${t}Z`)));
		expect(new Set(names)).toEqual(new Set(['2026-11-21T17:05']));
		expect(criticSyncSlot(at('2026-11-21T17:10:00.000Z'))).toBe('2026-11-21T17:10');
	});

	it('1 日に、枠は 48 個（重ならず、すべて違う名前）', () => {
		const names = new Set<string>();
		for (let m = 0; m < 24 * 60; m++) {
			const slot = criticSyncSlot(new Date(Date.UTC(2026, 10, 21, 0, m)));
			if (slot) names.add(slot);
		}
		expect(names.size).toBe(48);
	});

	it('日付は、UTC で決まる。日をまたぐ時間帯でも、日付は、その枠の頭の時刻の日', () => {
		const config = { startHourUtc: 23, endHourUtc: 24, intervalMinutes: 30 };
		expect(criticSyncSlot(at('2026-11-21T23:45:00.000Z'), config)).toBe('2026-11-21T23:30');
		expect(criticSyncSlot(at('2026-11-22T00:00:00.000Z'), config)).toBeNull();
	});

	it('設定を渡せる（10 分おき）', () => {
		const config = { startHourUtc: 1, endHourUtc: 2, intervalMinutes: 10 };
		expect(criticSyncSlot(at('2026-11-21T01:19:00.000Z'), config)).toBe('2026-11-21T01:10');
		expect(criticSyncSlot(at('2026-11-21T02:00:00.000Z'), config)).toBeNull();
	});
});
