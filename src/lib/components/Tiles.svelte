<script lang="ts">
	/**
	 * 紹介ページの背景（飾り。読み上げない）。
	 * 四角を敷き詰め、左から右へ、星5（緑）から星1（赤）の色にする。色は、評価の棒と同じ（tokens.css の --sentiment-N-fill）。
	 * 下へ行くほど、四角が抜けて、地の色に溶ける。
	 * 内部散乱: 四角の中が、ぼんやり光る（縁は深く沈む）。光源が、ゆっくり左から右へ流れ、四角ごとに、位相をずらして息をする。
	 * 「動きを減らす」の設定では、止めて、1枚だけ描く。画面の外にあるときと、タブが隠れているときは、描かない。
	 */
	type Rgb = [number, number, number];
	type Tile = { x: number; y: number; rgb: Rgb; jitter: number; phase: number };

	let canvas: HTMLCanvasElement;

	const FRAME_MS = 33; // 約 30fps。電池を使いすぎない。
	const SEED = 7;

	const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
	const rgba = (c: Rgb, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
	const clampByte = (v: number) => Math.max(0, Math.min(255, v));

	function readHex(name: string, fallback: Rgb): Rgb {
		const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return /^#[0-9a-f]{6}$/i.test(v) ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb : fallback;
	}

	$effect(() => {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dark = matchMedia('(prefers-color-scheme: dark)');
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const layer = document.createElement('canvas'); // 動かない部分（にじみ、色、縁の沈み）。1回だけ描く。
		const small = document.createElement('canvas');
		let tiles: Tile[] = [];
		let W = 0;
		let H = 0;
		let S = 32;
		let dpr = 1;
		let raf = 0;
		let last = 0;
		let visible = true;
		let still = motion.matches;

		function build() {
			W = canvas.clientWidth;
			H = canvas.clientHeight;
			if (W === 0 || H === 0) return;
			dpr = Math.min(2, devicePixelRatio || 1);
			canvas.width = Math.round(W * dpr);
			canvas.height = Math.round(H * dpr);
			layer.width = canvas.width;
			layer.height = canvas.height;
			const narrow = W < 560;
			S = narrow ? 22 : 32;
			const G = narrow ? 3 : 4;

			// 星5（緑）→ 星1（赤）。
			const stops = [5, 4, 3, 2, 1].map((n) => readHex(`--sentiment-${n}-fill`, [128, 128, 128]));
			let seed = SEED;
			const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
			const cols = Math.ceil(W / (S + G)) + 1;
			const rows = Math.ceil(H / (S + G)) + 1;
			tiles = [];
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					const x = c * (S + G);
					const y = r * (S + G);
					const wave = Math.sin(c * 0.31 + r * 0.17) * 0.06 + Math.sin(c * 0.09 - r * 0.23) * 0.08;
					const t = Math.min(0.9999, Math.max(0, (x / W) * 0.86 + (y / H) * 0.14 + wave + (rnd() - 0.5) * 0.05));
					const fy = y / H;
					const keep = fy < 0.5 ? 1 : Math.max(0, 1 - (fy - 0.5) / 0.5);
					const dropped = rnd() > Math.pow(keep, 1.4);
					const jitter = (rnd() - 0.5) * 0.08;
					const phase = rnd() * Math.PI * 2;
					if (dropped) continue;
					const pos = t * (stops.length - 1);
					const i = Math.floor(pos);
					tiles.push({ x, y, rgb: mix(stops[i], stops[i + 1], pos - i), jitter, phase });
				}
			}
			paintLayer();
		}

		const baseOf = (t: Tile): Rgb => [clampByte(t.rgb[0] * (1 + t.jitter)), clampByte(t.rgb[1] * (1 + t.jitter)), clampByte(t.rgb[2] * (1 + t.jitter))];

		function paintLayer() {
			const lc = layer.getContext('2d');
			const sc = small.getContext('2d');
			if (!lc || !sc) return;
			const d = dark.matches;
			lc.setTransform(dpr, 0, 0, dpr, 0, 0);
			lc.clearRect(0, 0, W, H);
			// 外へのにじみは弱く（隙間に少し漏れる程度）。主役は、四角の中の光。
			for (const [k, alpha] of [[0.2, d ? 0.42 : 0.38], [0.06, d ? 0.22 : 0.16]] as const) {
				small.width = Math.max(1, Math.ceil(W * k));
				small.height = Math.max(1, Math.ceil(H * k));
				for (const t of tiles) {
					sc.fillStyle = rgba(t.rgb, 1);
					sc.fillRect(t.x * k, t.y * k, S * k, S * k);
				}
				lc.save();
				lc.imageSmoothingEnabled = true;
				lc.imageSmoothingQuality = 'high';
				lc.globalAlpha = alpha;
				lc.drawImage(small, 0, 0, W, H);
				lc.restore();
			}
			for (const t of tiles) {
				const base = baseOf(t);
				lc.fillStyle = rgba(base, 1);
				lc.fillRect(t.x, t.y, S, S);
				// 縁を深くする（光の外側が、暗く沈む）。中の光は、毎回、あとから足す。
				const deep: Rgb = [base[0] * 0.5, base[1] * 0.5, base[2] * 0.5];
				const cx = t.x + S / 2;
				const cy = t.y + S / 2;
				const v = lc.createRadialGradient(cx, cy, S * 0.12, cx, cy, S * 0.74);
				v.addColorStop(0, rgba(deep, 0));
				v.addColorStop(0.6, rgba(deep, d ? 0.3 : 0.26));
				v.addColorStop(1, rgba(deep, d ? 0.7 : 0.6));
				lc.fillStyle = v;
				lc.fillRect(t.x, t.y, S, S);
			}
		}

		function draw(time: number) {
			if (W === 0 || H === 0) return;
			const d = dark.matches;
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx!.clearRect(0, 0, W, H);
			ctx!.drawImage(layer, 0, 0, W, H);
			// 光源は、ゆっくり左から右へ（16秒で1周）。止めるときは、右寄りの1点に置く。
			const lx = still ? W * 0.62 : (((time / 1000 / 16) % 1.4) - 0.2) * W;
			const ly = H * 0.28;
			const sigma2 = 2 * (W * 0.16) ** 2;
			ctx!.save();
			ctx!.globalCompositeOperation = 'screen';
			for (const t of tiles) {
				const cx = t.x + S / 2;
				const cy = t.y + S / 2;
				const dx = cx - lx;
				const dy = (cy - ly) * 0.8;
				const lit = Math.exp(-(dx * dx + dy * dy) / sigma2);
				const breathe = still ? 0 : Math.sin(time / 1600 + t.phase) * 0.08;
				const k = Math.max(0, (d ? 0.55 : 0.62) + lit * 0.3 + breathe);
				const base = baseOf(t);
				const hot: Rgb = [Math.min(255, base[0] * 1.28 + 14), Math.min(255, base[1] * 1.28 + 14), Math.min(255, base[2] * 1.28 + 14)];
				// 厚みのある、ぼんやりした芯。加算で重ねて、光って見せる。
				const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, S * 0.7);
				g.addColorStop(0, rgba(hot, k));
				g.addColorStop(0.25, rgba(hot, 0.82 * k));
				g.addColorStop(0.5, rgba(hot, 0.46 * k));
				g.addColorStop(0.75, rgba(hot, 0.16 * k));
				g.addColorStop(1, rgba(hot, 0));
				ctx!.fillStyle = g;
				ctx!.fillRect(t.x, t.y, S, S);
			}
			ctx!.restore();
		}

		function loop(time: number) {
			raf = 0;
			if (still || !visible || document.hidden) return;
			if (time - last >= FRAME_MS) {
				last = time;
				draw(time);
			}
			raf = requestAnimationFrame(loop);
		}

		function restart() {
			cancelAnimationFrame(raf);
			raf = 0;
			still = motion.matches;
			build();
			draw(0);
			if (!still && visible && !document.hidden) raf = requestAnimationFrame(loop);
		}

		let pending = 0;
		const resize = new ResizeObserver(() => {
			cancelAnimationFrame(pending);
			pending = requestAnimationFrame(restart);
		});
		resize.observe(canvas);
		const seen = new IntersectionObserver((entries) => {
			visible = entries[entries.length - 1].isIntersecting;
			if (visible && !still && raf === 0 && !document.hidden) raf = requestAnimationFrame(loop);
		});
		seen.observe(canvas);
		const onVisibility = () => {
			if (!document.hidden && visible && !still && raf === 0) raf = requestAnimationFrame(loop);
		};
		document.addEventListener('visibilitychange', onVisibility);
		dark.addEventListener('change', restart);
		motion.addEventListener('change', restart);
		restart();

		return () => {
			cancelAnimationFrame(raf);
			cancelAnimationFrame(pending);
			resize.disconnect();
			seen.disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
			dark.removeEventListener('change', restart);
			motion.removeEventListener('change', restart);
		};
	});
</script>

<canvas class="tiles" bind:this={canvas} aria-hidden="true"></canvas>
