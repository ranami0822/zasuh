/**
 * テストで、`cloudflare:workers` の代わりに読み込む（vite.config.ts の test.alias）。
 * 本物は、Workers の中でしか動かない。テストでは、env を差し替えて、waitUntil の呼び出しを控える。
 */
import { vi } from 'vitest';

export const env: Record<string, unknown> = {};
export const waitUntil = vi.fn();

/** env を、渡した値だけにする（前のテストの設定を残さない）。 */
export function setEnv(values: Record<string, unknown>): void {
	for (const key of Object.keys(env)) delete env[key];
	Object.assign(env, values);
}
