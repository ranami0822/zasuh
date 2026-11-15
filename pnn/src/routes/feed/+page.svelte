<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '../../lib/Icon.svelte';
	import PostCard from '../../lib/PostCard.svelte';
	import { press } from '../../lib/press';
	import { api, type PostView } from '../../lib/api';

	let posts = $state.raw<PostView[]>([]);
	let next = $state<number | null>(null);
	let loaded = $state(false);
	let failed = $state(false);

	async function load(before: number | null = null) {
		try {
			const r = await api<{ posts: PostView[]; next: number | null }>('GET', '/api/feed' + (before ? `?before=${before}` : ''));
			posts = before ? [...posts, ...r.posts] : r.posts;
			next = r.next;
			failed = false;
		} catch { failed = true; }
		loaded = true;
	}
	onMount(() => { load(); });
</script>

<svelte:head><title>場 / pnn</title></svelte:head>

<main class="page-col">
	<header class="topbar">
		<a class="p chip soft icon-only" href="/" use:press aria-label="書く"><span class="f"><Icon name="pen" /></span></a>
		<span class="sp"></span>
		<a class="p chip soft icon-only" href="/me" use:press aria-label="自分"><span class="f"><Icon name="person" /></span></a>
	</header>
	<div class="stack">
		{#each posts as p (p.id)}<PostCard post={p} />{/each}
		{#if loaded && !posts.length && !failed}<p class="muted">まだ、なにもない。</p>{/if}
		{#if failed}<p class="muted">つながらない。</p>{/if}
		{#if next}
			<button class="p chip soft" use:press onclick={() => load(next)}><span class="f">もっと</span></button>
		{/if}
	</div>
</main>
