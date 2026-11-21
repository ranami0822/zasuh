import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countQueries } from './count-queries';
import { createTestDb } from './db';

describe('countQueries（D1 への問い合わせを数える）', () => {
	let raw: D1Database;
	let dispose: () => Promise<void>;

	beforeEach(async () => {
		({ db: raw, dispose } = await createTestDb());
	});
	afterEach(() => dispose());

	it('first、all、run を、1 回ずつ数える。prepare と bind だけでは数えない', async () => {
		const counter = countQueries(raw);
		const stmt = counter.db.prepare('SELECT 1 AS n WHERE ? = ?').bind(1, 1);
		expect(counter.count()).toBe(0);

		await stmt.first();
		expect(counter.count()).toBe(1);
		await counter.db.prepare('SELECT 1 AS n').all();
		expect(counter.count()).toBe(2);
		await counter.db.prepare('SELECT 1 AS n').run();
		expect(counter.count()).toBe(3);
	});

	it('raw も、1 回と数える', async () => {
		const counter = countQueries(raw);
		await counter.db.prepare('SELECT 1 AS n').raw();
		expect(counter.count()).toBe(1);
	});

	it('db.batch() は、文が何個でも、1 回', async () => {
		const counter = countQueries(raw);
		await counter.db.batch([
			counter.db.prepare('SELECT 1'),
			counter.db.prepare('SELECT 2'),
			counter.db.prepare('SELECT 3')
		]);
		expect(counter.count()).toBe(1);
	});

	it('reset で、0 に戻る', async () => {
		const counter = countQueries(raw);
		await counter.db.prepare('SELECT 1').run();
		counter.reset();
		expect(counter.count()).toBe(0);
		await counter.db.prepare('SELECT 1').run();
		expect(counter.count()).toBe(1);
	});

	it('動きは変えない。書き込みと読み取りが、同じ db に反映され、結果の形も同じ', async () => {
		const counter = countQueries(raw);
		await counter.db
			.prepare('INSERT INTO works (id, slug, name, category, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
			.bind('w1', 'w1', '作り物', 'game', 'active', '2026-11-01T00:00:00.000Z')
			.run();
		const viaCounter = await counter.db.prepare('SELECT name FROM works WHERE id = ?').bind('w1').first<{ name: string }>();
		const viaRaw = await raw.prepare('SELECT name FROM works WHERE id = ?').bind('w1').first<{ name: string }>();
		expect(viaCounter).toEqual({ name: '作り物' });
		expect(viaRaw).toEqual(viaCounter);
		const { results } = await counter.db.prepare('SELECT id FROM works').all<{ id: string }>();
		expect(results).toEqual([{ id: 'w1' }]);
		// 元の db を直接使った問い合わせは、数えない。
		expect(counter.count()).toBe(3);
	});
});
