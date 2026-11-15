import type { D1Database } from '@cloudflare/workers-types';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';

/** テスト用の D1（本番と同じ workerd の SQLite）に、migrations/ をすべて当てて返す */
export async function createTestDb(): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
	const mf = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: 'export default { fetch() { return new Response(null, { status: 404 }); } }',
			d1Databases: ['DB']
		})
	);
	const db = (await mf.getD1Database('DB')) as unknown as D1Database;
	for (const file of readdirSync('migrations').sort()) {
		const statements = readFileSync(`migrations/${file}`, 'utf8')
			.split('\n')
			.filter((l) => !l.trim().startsWith('--'))
			.join('\n')
			.split(';')
			.map((s) => s.trim())
			.filter(Boolean);
		await db.batch(statements.map((s) => db.prepare(s)));
	}
	return { db, dispose: () => mf.dispose() };
}
