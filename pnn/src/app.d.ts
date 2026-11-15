import type { Viewer } from './lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			viewer: Viewer | null;
		}
	}
}
export {};
