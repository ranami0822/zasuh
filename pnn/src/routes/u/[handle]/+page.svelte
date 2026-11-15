<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Icon from '../../../lib/Icon.svelte';
	import PostCard from '../../../lib/PostCard.svelte';
	import { press } from '../../../lib/press';
	import { api, ApiError, type Profile } from '../../../lib/api';

	let p = $state.raw<Profile | null>(null);
	let missing = $state(false);
	const handle = $derived(page.params.handle ?? '');

	async function load() {
		try { p = await api<Profile>('GET', `/api/users/${handle}`); }
		catch (e) { if (e instanceof ApiError && e.status === 404) missing = true; }
	}
	onMount(() => { load(); });

	async function toggleFollow() {
		try { await api(p!.following ? 'DELETE' : 'POST', `/api/users/${handle}/follow`); await load(); }
		catch (e) { if (e instanceof ApiError && e.status === 401) goto(`/me?next=${encodeURIComponent(location.pathname)}`); }
	}
</script>

<svelte:head><title>{p?.name ?? 'pnn'}</title></svelte:head>

<main class="page-col">
	<header class="topbar">
		<a class="p chip soft icon-only" href="/feed" use:press aria-label="場"><span class="f"><Icon name="feed" /></span></a>
		<span class="sp"></span>
		<a class="p chip soft icon-only" href="/" use:press aria-label="書く"><span class="f"><Icon name="pen" /></span></a>
	</header>
	{#if missing}
		<p class="muted">見つからない。</p>
	{:else if p}
		<div class="stack">
			<h1 class="big">{p.name}</h1>
			<p class="muted">@{p.handle}</p>
			{#if p.bio}<p class="bio">{p.bio}</p>{/if}
			{#if !p.isMe}
				<div><button class="p chip" class:soft={p.following} use:press onclick={toggleFollow}><span class="f">{p.following ? 'フォロー中' : 'フォロー'}</span></button></div>
			{/if}
			{#each p.posts as x (x.id)}<PostCard post={x} />{/each}
		</div>
	{/if}
</main>

<style>
	.bio { white-space: pre-wrap; line-height: var(--lh-write); }
</style>
