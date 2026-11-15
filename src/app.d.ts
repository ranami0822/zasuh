import type { Env } from './lib/server/env';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: Env;
			ctx: { waitUntil(promise: Promise<unknown>): void };
		}
	}
}

export {};
