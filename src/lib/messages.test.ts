import { describe, expect, it } from 'vitest';
import { AUTH_MESSAGES, CATEGORY_LABEL, DISCLOSURE_LABEL, INBOX_MESSAGES, KIND_LABEL, MESSAGES, REASON_LABEL } from './messages';
import { MESSAGE_KINDS } from './server/inbox';
import { DISCLOSURES, REPORT_REASONS } from './server/reviews';
import { CATEGORIES } from './server/works';

const nonEmpty = (table: Record<string, string>) => Object.values(table).every((text) => text.trim().length > 0);

describe('画面に出す文と、ラベルの表', () => {
	it('エラーの文は、すべて空でない（型は、キーの抜けだけを防ぐ）', () => {
		for (const table of [MESSAGES, INBOX_MESSAGES, AUTH_MESSAGES]) expect(nonEmpty(table)).toBe(true);
	});

	it('選択肢の値には、すべて、ラベルがある（値を足して、ラベルを忘れると、画面に生の値が出る）', () => {
		expect(Object.keys(DISCLOSURE_LABEL).sort()).toEqual([...DISCLOSURES].sort());
		expect(Object.keys(REASON_LABEL).sort()).toEqual([...REPORT_REASONS].sort());
		expect(Object.keys(KIND_LABEL).sort()).toEqual([...MESSAGE_KINDS].sort());
		expect(Object.keys(CATEGORY_LABEL).sort()).toEqual([...CATEGORIES].sort());
		for (const table of [DISCLOSURE_LABEL, REASON_LABEL, KIND_LABEL, CATEGORY_LABEL]) expect(nonEmpty(table)).toBe(true);
	});

	it('エラーの文は、上限の数字が、実際の上限と合っている', async () => {
		const { BODY_MAX, BODY_MIN, EDIT_MAX, NOTE_MAX } = await import('./server/reviews');
		const { MESSAGE_BODY_MAX, MESSAGE_BODY_MIN } = await import('./server/inbox');
		const comma = (n: number) => n.toLocaleString('en-US');
		expect(MESSAGES.body_too_short).toContain(`${BODY_MIN}文字`);
		expect(MESSAGES.body_too_long).toContain(`${comma(BODY_MAX)}文字`);
		expect(MESSAGES.note_too_long).toContain(`${NOTE_MAX}文字`);
		expect(MESSAGES.edit_limit).toContain(`${EDIT_MAX}回`);
		expect(INBOX_MESSAGES.body_too_short).toContain(`${MESSAGE_BODY_MIN}文字`);
		expect(INBOX_MESSAGES.body_too_long).toContain(`${comma(MESSAGE_BODY_MAX)}文字`);
	});
});
