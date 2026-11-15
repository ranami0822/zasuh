<script lang="ts">
	import Icon from '../../lib/Icon.svelte';
	import { icons, type IconName } from '../../lib/icons';
	import { press } from '../../lib/press';

	const names = Object.keys(icons) as IconName[];
	const colors: [string, string][] = [
		['bg', '背景'], ['face', '面'], ['ring', '輪'], ['bit', '小要素'],
		['card', 'カード'], ['card-red', 'カード（赤み）'], ['press', '押下'],
		['ink', '文字'], ['soft', '補足の文字'], ['mint', 'ミント']
	];
	const spaces = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
	let theme = $state<'light' | 'dark'>(typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
	function toggle() {
		theme = theme === 'light' ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		try { localStorage.setItem('pnn-theme', theme); } catch {}
	}
</script>

<svelte:head><title>design / pnn</title></svelte:head>

<main class="page">
	<header class="head">
		<h1>pnn design</h1>
		<button class="p chip soft icon-only" use:press={{ k: 1.1 }} onclick={toggle} aria-label="明るさ"><span class="f"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></span></button>
	</header>

	<section>
		<h2>色</h2>
		<div class="duo">
			{#each ['light', 'dark'] as t (t)}
				<div class="panel" data-theme={t}>
					{#each colors as [id, name] (id)}
						<div class="sw"><span class="chipc" style:background="var(--{id})"></span><span>{name}</span><span class="tok">--{id}</span></div>
					{/each}
				</div>
			{/each}
		</div>
	</section>

	<section>
		<h2>間隔</h2>
		<div class="spaces">
			{#each spaces as s (s)}
				<div class="sp"><span class="bar" style:width="var(--{s})"></span><span class="tok">--{s}</span></div>
			{/each}
		</div>
	</section>

	<section>
		<h2>文字</h2>
		<p class="t32">夜中にしか書けない</p>
		<p class="t16">本文は 16px、題は 32px。ピクセルの書体は、16 の倍数でくっきり出る。</p>
	</section>

	<section>
		<h2>形</h2>
		<div class="row">
			<span class="shape pill"></span><span class="shape card"></span><span class="shape box"></span>
		</div>
	</section>

	<section>
		<h2>部品</h2>
		<div class="row">
			<button class="p chip" use:press><span class="f">chip</span></button>
			<button class="p chip soft" use:press><span class="f">soft</span></button>
			<button class="p btn" use:press><span class="f">btn</span></button>
			<button class="p btn mint" use:press><span class="f">mint</span></button>
		</div>
		<textarea class="field" rows="1" placeholder="field"></textarea>
		<div class="dlg sample"><h2>dialog</h2><p>直角。線なし。影は全方向。</p></div>
	</section>

	<section>
		<h2>アイコン</h2>
		<div class="icons">
			{#each names as n (n)}
				<div class="ic"><span class="tile"><Icon name={n} /></span><span>{icons[n].label}</span><span class="tok">{n}</span></div>
			{/each}
		</div>
	</section>
</main>

<style>
	.page { position: relative; z-index: var(--z-app); width: min(var(--measure), 100%); margin-inline: auto; padding: var(--s5) var(--gutter) var(--s8); display: grid; gap: var(--s6); }
	.head { display: flex; align-items: center; justify-content: space-between; gap: var(--gap); }
	h1, h2 { font-weight: 400; }
	h1 { font-size: var(--t-title); line-height: var(--lh-title); }
	h2 { font-size: var(--t-body); color: var(--soft); margin-bottom: var(--s3); }
	section { display: grid; gap: var(--s3); align-content: start; }
	.tok { color: var(--soft); }
	.duo { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--s3); }
	.panel { background: var(--bg); color: var(--ink); padding: var(--s4); display: grid; gap: var(--s2); box-shadow: var(--sh-card); }
	.sw { display: grid; grid-template-columns: var(--s6) 1fr auto; gap: var(--s3); align-items: center; }
	.chipc { width: var(--s6); height: var(--s6); border-radius: var(--r-pill); box-shadow: var(--sh-card); }
	.spaces { display: grid; gap: var(--s2); }
	.sp { display: flex; align-items: center; gap: var(--s3); }
	.sp .bar { height: var(--s3); background: var(--card); border-radius: var(--r-pill); display: block; }
	.t32 { font-size: var(--t-title); line-height: var(--lh-title); }
	.t16 { line-height: var(--lh-write); }
	.row { display: flex; flex-wrap: wrap; gap: var(--s3); align-items: center; }
	.shape { width: var(--s8); height: var(--s7); background: var(--card); box-shadow: var(--sh-pop); display: block; }
	.pill { border-radius: var(--r-pill); }
	.card { border-radius: var(--r-card); }
	.box { border-radius: var(--r-box); }
	.sample { width: 100%; }
	.icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--s3); }
	.ic { display: grid; gap: var(--s1); justify-items: start; }
	.tile { width: var(--s8); height: var(--s8); display: grid; place-items: center; background: var(--face); border-radius: var(--r-card); color: var(--ink); }
</style>
