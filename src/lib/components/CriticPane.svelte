<script lang="ts">
	import StarDist from '#components/StarDist.svelte';
	import { tickerAdvance, type CriticItem, type CriticPane } from '#critic-pane';

	/**
	 * 専門家の欄（作品ページ。docs/mvp-design.md の 22.10）。暗い面。
	 * 総合の星の分布（読者の欄と同じ部品）、媒体の帯（自動で横に流れる。触ると止まる）、畳んだ一覧（初期は閉じる）。
	 * 星は、AI が文章から読んだ結果（見出しの「AI」の印）。本文・抜粋・媒体の点数・ロゴは、出さない。
	 */
	let { pane }: { pane: CriticPane } = $props();

	/** 帯の流れる速さ（px/秒）。 */
	const TICKER_SPEED = 30;
	/** 指を離してから、流れを再開するまで（ミリ秒）。 */
	const RESUME_AFTER_TOUCH_MS = 2500;

	const uid = $props.id();
	const listId = `${uid}-list`;
	const titleId = `${uid}-title`;

	let open = $state(false);
	let track = $state<HTMLElement>();
	let trackWidth = $state(0);
	let setWidth = $state(0);
	// 1組の幅が、帯の幅より広いときだけ、流す（複製の組も、そのときだけ並べる）。
	const loops = $derived(trackWidth > 0 && setWidth > trackWidth);

	let hovering = $state(false);
	let pressed = $state(false);
	let focused = $state(false);
	let reduced = $state(false);
	let pageHidden = $state(false);
	let inView = $state(false);
	const running = $derived(loops && !reduced && !pageHidden && inView && !hovering && !pressed && !focused);

	let resumeTimer: ReturnType<typeof setTimeout> | undefined;
	function pressStart() {
		clearTimeout(resumeTimer);
		pressed = true;
	}
	function pressEnd() {
		clearTimeout(resumeTimer);
		resumeTimer = setTimeout(() => (pressed = false), RESUME_AFTER_TOUCH_MS);
	}

	// 動きを減らす設定、ページが見えているか、帯が画面に入っているか。
	$effect(() => {
		if (!track) return;
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const onMotion = () => (reduced = motion.matches);
		const onVisibility = () => (pageHidden = document.hidden);
		onMotion();
		onVisibility();
		motion.addEventListener('change', onMotion);
		document.addEventListener('visibilitychange', onVisibility);
		const io = new IntersectionObserver(([entry]) => (inView = entry.isIntersecting));
		io.observe(track);
		return () => {
			motion.removeEventListener('change', onMotion);
			document.removeEventListener('visibilitychange', onVisibility);
			io.disconnect();
			clearTimeout(resumeTimer);
		};
	});

	// 流す。位置は、手元の数で持つ（scrollLeft は、整数に丸められることがあり、1コマ 0.5px の差が消えるため）。
	// 止まっている間に、手で動かした位置から、続ける。
	$effect(() => {
		if (!running || !track) return;
		const el = track;
		let pos = el.scrollLeft;
		let last: number | null = null;
		let frame = requestAnimationFrame(function step(t) {
			if (last !== null) {
				pos = tickerAdvance(pos, t - last, TICKER_SPEED, setWidth);
				el.scrollLeft = pos;
			}
			last = t;
			frame = requestAnimationFrame(step);
		});
		return () => cancelAnimationFrame(frame);
	});

	/** いちばん近い星（色の段階。星の札と同じ決まり）。 */
	const level = (stars: number) => Math.min(5, Math.max(1, Math.round(stars)));
</script>

<section class="critic" aria-labelledby={titleId}>
	<h2 class="critic__title" id={titleId}>
		専門家<span class="critic__ai"><span aria-hidden="true">AI</span><span class="sr-only">（星は、AI が文章から読み取った値）</span></span>
	</h2>
	<StarDist size="hero" n={pane.n} soft={pane.soft} mean={pane.mean} se={pane.se} />

	<!-- 媒体の帯。手で横に動かせる。複製の組は、読み上げとフォーカスの対象にしない。 -->
	<div
		class="critic__ticker"
		class:loops
		role="group"
		aria-label="媒体ごとの星"
		bind:this={track}
		bind:clientWidth={trackWidth}
		onpointerenter={(e) => {
			if (e.pointerType !== 'touch') hovering = true;
		}}
		onpointerleave={(e) => {
			if (e.pointerType !== 'touch') hovering = false;
		}}
		onpointerdown={pressStart}
		onpointerup={(e) => {
			if (e.pointerType !== 'touch') pressEnd();
		}}
		onpointercancel={(e) => {
			if (e.pointerType !== 'touch') pressEnd();
		}}
		ontouchstart={pressStart}
		ontouchend={pressEnd}
		ontouchcancel={pressEnd}
		onfocusin={() => (focused = true)}
		onfocusout={(e) => {
			if (!track?.contains(e.relatedTarget as Node | null)) focused = false;
		}}
	>
		<ul class="critic__set" bind:offsetWidth={setWidth}>
			{#each pane.items as item, i (i)}
				<li>{@render entry(item, false)}</li>
			{/each}
		</ul>
		{#if loops}
			<ul class="critic__set" aria-hidden="true">
				{#each pane.items as item, i (i)}
					<li>{@render entry(item, true)}</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="critic__foot">
		<a href={pane.sourceUrl} rel="noopener noreferrer nofollow">出典: OpenCritic</a>
		<button
			type="button"
			class="iconbtn critic__toggle"
			aria-expanded={open}
			aria-controls={listId}
			aria-label={open ? '専門家のレビューの一覧を閉じる' : '専門家のレビューの一覧を開く'}
			title={open ? '一覧を閉じる' : '一覧を開く'}
			onclick={() => (open = !open)}
		>
			<svg class="chevron" class:open viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6" /></svg>
		</button>
	</div>

	<ul class="critic__list" id={listId} hidden={!open}>
		{#each pane.items as item, i (i)}
			<li>
				<a class="critic__row" href={item.url} target="_blank" rel="noopener noreferrer nofollow">
					<span class="critic__name">
						<span class="critic__outlet">{item.outlet}</span>
						{@render aspects(item)}
					</span>
					<span class="critic__date num">{item.publishedOn ? item.publishedOn.slice(0, 7) : ''}</span>
					{@render score(item.stars)}
					<span class="critic__ext" aria-hidden="true">↗</span><span class="sr-only">（新しいタブで開く）</span>
				</a>
			</li>
		{/each}
	</ul>
</section>

{#snippet score(stars: number)}
	<span class="critic__score s{level(stars)}"><span aria-hidden="true">★</span><span class="sr-only">星</span><b class="num">{stars.toFixed(1)}</b></span>
{/snippet}

{#snippet aspects(item: CriticItem)}
	{#each item.aspects as a (a.key)}
		<span class="critic__aspect">{a.label}<b class="critic__score s{level(a.stars)} num">{a.stars.toFixed(1)}</b></span>
	{/each}
{/snippet}

{#snippet entry(item: CriticItem, copy: boolean)}
	<a class="critic__entry" href={item.url} target="_blank" rel="noopener noreferrer nofollow" tabindex={copy ? -1 : undefined}>
		<span class="critic__outlet">{item.outlet}</span>
		{@render score(item.stars)}
		{@render aspects(item)}
		<span class="critic__ext" aria-hidden="true">↗</span><span class="sr-only">（新しいタブで開く）</span>
	</a>
{/snippet}
