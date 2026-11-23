<script lang="ts">
	/**
	 * 紹介ページの背景（飾り。読み上げない）。
	 * 四角を敷き詰め、左から右へ、星5（緑）から星1（赤）の色にする。色は、評価の棒と同じ（tokens.css の --sentiment-N-fill）。
	 * 下へ行くほど、四角が抜けて、地の色に溶ける。
	 * 内部散乱: 四角の中が、ぼんやり光る（縁は深く沈む）。光源が、ゆっくり左から右へ流れ（16秒で1周）、四角ごとに、位相をずらして息をする。
	 * 「動きを減らす」の設定では、止めて、1枚だけ描く。画面の外にあるときと、タブが隠れているときは、描かない。
	 * 重さの対策: 動かない部分（にじみ、色、縁の沈み）と、光の芯は、作り直すとき（大きさ、密度、配色が変わったとき）に1回だけ描く。
	 * 毎フレームは、芯の画像を、四角ごとの強さ（globalAlpha）で重ねるだけ。
	 */
	type Rgb = [number, number, number];
	type Tile = { x: number; y: number; rgb: Rgb; phase: number };

	let canvas: HTMLCanvasElement;

	const FRAME_MS = 33; // 約 30fps。電池を使いすぎない。
	const SEED = 7;
	const SWEEP_MS = 16000; // 光源が、左の外から右の外まで流れて、戻るまで。
	const SWEEP_FROM = -0.6; // 光の広がり（W の 0.16 倍）の約 3.75 倍だけ外に置く。端で、光が、ほぼ 0 になる（折り返しで、ちらつかない）。
	const SWEEP_TO = 1.6;

	const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
	const rgba = (c: Rgb, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
	const clampByte = (v: number) => Math.max(0, Math.min(255, v));

	function readHex(name: string, fallback: Rgb): Rgb {
		const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return /^#[0-9a-f]{6}$/i.test(v) ? ([1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb) : fallback;
	}

	$effect(() => {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dark = matchMedia('(prefers-color-scheme: dark)');
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const layer = document.createElement('canvas'); // 動かない部分（にじみ、色、縁の沈み）。
		const glow = document.createElement('canvas'); // 四角ごとの光の芯（強さ 1 で描く）。毎フレーム、強さを変えて重ねる。
		const small = document.createElement('canvas'); // にじみを作るための、小さい作業用。
		let tiles: Tile[] = [];
		let W = 0;
		let H = 0;
		let S = 32;
		let dpr = 1;
		let key = '';
		let raf = 0;
		let last = 0;
		let visible = true;
		let still = motion.matches;

		const currentDpr = () => Math.min(2, devicePixelRatio || 1);

		/** 大きさ、密度、配色が前と同じなら、作り直さない。 */
		function build(force = false) {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			const nextKey = `${w}x${h}@${currentDpr()}/${dark.matches}`;
			if (!force && nextKey === key) return false;
			key = nextKey;
			W = w;
			H = h;
			if (W === 0 || H === 0) return true;
			dpr = currentDpr();
			for (const c of [canvas, layer, glow]) {
				c.width = Math.round(W * dpr);
				c.height = Math.round(H * dpr);
			}
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
					const m = mix(stops[i], stops[i + 1], pos - i);
					// 四角ごとの、わずかな明暗のずれ（離散的な見え方）。ここで1回だけ決める。
					tiles.push({ x, y, rgb: [clampByte(m[0] * (1 + jitter)), clampByte(m[1] * (1 + jitter)), clampByte(m[2] * (1 + jitter))], phase });
				}
			}
			paintStatic();
			return true;
		}

		function paintStatic() {
			const lc = layer.getContext('2d');
			const gc = glow.getContext('2d');
			const sc = small.getContext('2d');
			if (!lc || !gc || !sc) return;
			const d = dark.matches;
			lc.setTransform(dpr, 0, 0, dpr, 0, 0);
			gc.setTransform(dpr, 0, 0, dpr, 0, 0);
			lc.clearRect(0, 0, W, H);
			gc.clearRect(0, 0, W, H);
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
				const cx = t.x + S / 2;
				const cy = t.y + S / 2;
				lc.fillStyle = rgba(t.rgb, 1);
				lc.fillRect(t.x, t.y, S, S);
				// 縁を深くする（光の外側が、暗く沈む）。
				const deep: Rgb = [t.rgb[0] * 0.5, t.rgb[1] * 0.5, t.rgb[2] * 0.5];
				const v = lc.createRadialGradient(cx, cy, S * 0.12, cx, cy, S * 0.74);
				v.addColorStop(0, rgba(deep, 0));
				v.addColorStop(0.6, rgba(deep, d ? 0.3 : 0.26));
				v.addColorStop(1, rgba(deep, d ? 0.7 : 0.6));
				lc.fillStyle = v;
				lc.fillRect(t.x, t.y, S, S);
				// 厚みのある、ぼんやりした芯（強さ 1）。毎フレームは、これを、強さを変えて重ねる。
				const hot: Rgb = [Math.min(255, t.rgb[0] * 1.28 + 14), Math.min(255, t.rgb[1] * 1.28 + 14), Math.min(255, t.rgb[2] * 1.28 + 14)];
				const g = gc.createRadialGradient(cx, cy, 0, cx, cy, S * 0.7);
				g.addColorStop(0, rgba(hot, 1));
				g.addColorStop(0.25, rgba(hot, 0.82));
				g.addColorStop(0.5, rgba(hot, 0.46));
				g.addColorStop(0.75, rgba(hot, 0.16));
				g.addColorStop(1, rgba(hot, 0));
				gc.fillStyle = g;
				gc.fillRect(t.x, t.y, S, S);
			}
		}

		function draw(time: number) {
			if (W === 0 || H === 0) return;
			const d = dark.matches;
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx!.clearRect(0, 0, W, H);
			ctx!.drawImage(layer, 0, 0, W, H);
			// 光源は、左の外から右の外へ流れる。止めるときは、右寄りの1点に置く。
			const lx = still ? W * 0.62 : (SWEEP_FROM + ((time % SWEEP_MS) / SWEEP_MS) * (SWEEP_TO - SWEEP_FROM)) * W;
			const ly = H * 0.28;
			const sigma2 = 2 * (W * 0.16) ** 2;
			const size = S * dpr;
			ctx!.save();
			ctx!.globalCompositeOperation = 'screen';
			for (const t of tiles) {
				const dx = t.x + S / 2 - lx;
				const dy = (t.y + S / 2 - ly) * 0.8;
				const lit = Math.exp(-(dx * dx + dy * dy) / sigma2);
				const breathe = still ? 0 : Math.sin(time / 1600 + t.phase) * 0.08;
				ctx!.globalAlpha = Math.min(1, Math.max(0, (d ? 0.55 : 0.62) + lit * 0.3 + breathe));
				ctx!.drawImage(glow, t.x * dpr, t.y * dpr, size, size, t.x, t.y, S, S);
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

		/** 作り直して（必要なときだけ）、描く。動く設定なら、ループを始める。 */
		function restart(force = false) {
			cancelAnimationFrame(raf);
			raf = 0;
			still = motion.matches;
			build(force);
			draw(performance.now());
			if (!still && visible && !document.hidden) raf = requestAnimationFrame(loop);
		}
		const onScheme = () => restart(true);
		const onMotion = () => restart();

		let pending = 0;
		const onResize = () => {
			cancelAnimationFrame(pending);
			pending = requestAnimationFrame(() => restart());
		};
		const resize = new ResizeObserver(onResize);
		resize.observe(canvas);
		// 大きさが変わらず、画素の密度だけが変わったとき（密度の違う画面へ、ウィンドウを移したとき）も、作り直す。
		window.addEventListener('resize', onResize);
		const seen = new IntersectionObserver((entries) => {
			visible = entries[entries.length - 1].isIntersecting;
			if (visible && !still && raf === 0 && !document.hidden) raf = requestAnimationFrame(loop);
		});
		seen.observe(canvas);
		const onVisibility = () => {
			if (!document.hidden && visible && !still && raf === 0) raf = requestAnimationFrame(loop);
		};
		document.addEventListener('visibilitychange', onVisibility);
		dark.addEventListener('change', onScheme);
		motion.addEventListener('change', onMotion);
		restart(true);

		return () => {
			cancelAnimationFrame(raf);
			cancelAnimationFrame(pending);
			resize.disconnect();
			seen.disconnect();
			window.removeEventListener('resize', onResize);
			document.removeEventListener('visibilitychange', onVisibility);
			dark.removeEventListener('change', onScheme);
			motion.removeEventListener('change', onMotion);
			// 裏の canvas のメモリを、早く返す（スマホの Safari は、解放が遅い）。
			for (const c of [layer, glow, small]) {
				c.width = 0;
				c.height = 0;
			}
		};
	});
</script>

<canvas class="tiles" bind:this={canvas} aria-hidden="true"></canvas>
