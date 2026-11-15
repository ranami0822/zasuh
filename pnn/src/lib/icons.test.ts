import { describe, expect, it } from 'vitest';
import { iconPath, icons, type IconDef } from './icons';

describe('icons', () => {
	const entries = Object.entries(icons) as [keyof typeof icons, IconDef][];

	it('絵は、16×16 の格子で、# と . だけ', () => {
		for (const [name, d] of entries) {
			if (!d.rows) continue;
			expect(d.rows.length, `${name} の行数`).toBe(16);
			for (const r of d.rows) expect(r, `${name} の行`).toMatch(/^[#.]{16}$/);
		}
	});

	it('mirror は、絵を持つ別のアイコンを指す', () => {
		for (const [name, d] of entries) {
			if (!d.mirror) continue;
			const t = (icons as Record<string, IconDef>)[d.mirror];
			expect(t?.rows, `${name} の mirror`).toBeTruthy();
		}
	});

	it('どのアイコンにも、読み上げの名前があり、描くものがある', () => {
		for (const [name, d] of entries) {
			expect(d.label.length, name).toBeGreaterThan(0);
			expect(iconPath(name).length, name).toBeGreaterThan(0);
		}
	});

	it('左右反転は、反対向きになる', () => {
		expect(iconPath('redo')).not.toBe(iconPath('undo'));
		const maxX = (p: string) => Math.max(...[...p.matchAll(/M(\d+) /g)].map((m) => +m[1]));
		expect(maxX(iconPath('redo'))).toBeGreaterThan(8);
	});
});
