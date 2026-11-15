<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '../../lib/Icon.svelte';
	import PostCard from '../../lib/PostCard.svelte';
	import { press } from '../../lib/press';
	import { api, ApiError, type Me, type PostView } from '../../lib/api';
	import { getMe, login, logout, register } from '../../lib/account';

	let me = $state.raw<Me | null>(null);
	let loaded = $state(false);
	let error = $state('');
	let handle = $state('');
	let name = $state('');
	let bio = $state('');
	let tab = $state<'mine' | 'saved'>('mine');
	let saved = $state.raw<PostView[]>([]);
	let theme = $state<'light' | 'dark'>('light');
	let done = $state(false);

	async function load() {
		me = await getMe().catch(() => null);
		if (me) { handle = me.handle ?? ''; name = me.name; bio = me.bio; }
		loaded = true;
	}
	onMount(() => {
		theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
		load();
	});

	function next() {
		const n = new URLSearchParams(location.search).get('next');
		return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
	}

	async function auth(fn: () => Promise<void>) {
		error = '';
		try {
			await fn();
			const n = next();
			if (n) { goto(n); return; }
			await load();
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'passkey が使えなかった';
		}
	}

	async function saveProfile() {
		error = ''; done = false;
		try {
			me = await api<Me>('PATCH', '/api/me', { handle: handle || undefined, name, bio });
			done = true;
		} catch (e) {
			error = e instanceof ApiError ? (e.status === 409 ? 'その名前は、使われている' : e.message) : 'つながらない';
		}
	}

	async function showSaved() {
		tab = 'saved';
		saved = await api<PostView[]>('GET', '/api/saves').catch(() => []);
	}

	async function out() { await logout(); me = null; }

	function toggleTheme() {
		theme = theme === 'light' ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		try { localStorage.setItem('pnn-theme', theme); } catch {}
	}
</script>

<svelte:head><title>自分 / pnn</title></svelte:head>

<main class="page-col">
	<header class="topbar">
		<a class="p chip soft icon-only" href="/" use:press aria-label="書く"><span class="f"><Icon name="pen" /></span></a>
		<span class="sp"></span>
		<button class="p chip soft icon-only" use:press={{ k: 1.1 }} onclick={toggleTheme} aria-label="明るさ"><span class="f"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></span></button>
		<a class="p chip soft icon-only" href="/feed" use:press aria-label="場"><span class="f"><Icon name="feed" /></span></a>
	</header>

	{#if loaded && !me}
		<div class="stack">
			<h1 class="big">pnn</h1>
			<div class="row">
				<button class="p btn" use:press onclick={() => auth(register)}><span class="f">はじめる</span></button>
				<button class="p btn soft" use:press onclick={() => auth(login)}><span class="f">入る</span></button>
			</div>
			{#if error}<p class="muted">{error}</p>{/if}
		</div>
	{:else if me}
		<div class="stack">
			<label class="lab"><span class="muted">@</span><input class="input" bind:value={handle} placeholder="名前（英数字）" autocomplete="off" autocapitalize="off" /></label>
			<input class="input" bind:value={name} placeholder="表示名" />
			<textarea class="input" rows="3" bind:value={bio} placeholder="紹介"></textarea>
			<div class="row">
				<button class="p btn" use:press onclick={saveProfile}><span class="f">{done ? '保存した' : '保存'}</span></button>
				<span class="muted">フォロワー {me.followers}</span>
				<span class="sp"></span>
				<button class="p chip soft" use:press onclick={out}><span class="f">出る</span></button>
			</div>
			{#if error}<p class="muted">{error}</p>{/if}

			<div class="row tabs">
				<button class="p chip" class:soft={tab !== 'mine'} use:press onclick={() => (tab = 'mine')}><span class="f">書いたもの</span></button>
				<button class="p chip" class:soft={tab !== 'saved'} use:press onclick={showSaved} aria-label="保存した投稿"><span class="f"><Icon name="bookmark" small /></span></button>
			</div>
			{#each tab === 'mine' ? me.posts : saved as p (p.id)}<PostCard post={p} />{/each}
		</div>
	{/if}
</main>

<style>
	.row { display: flex; flex-wrap: wrap; gap: var(--gap); align-items: center; }
	.sp { flex: 1; }
	.tabs { margin-top: var(--s5); }
	.lab { display: flex; gap: var(--s2); align-items: center; }
	.input { width: 100%; min-height: var(--tap); border: 0; outline: 0; background: var(--ring); color: var(--ink); border-radius: var(--r-card); padding: var(--s3) var(--s4); caret-color: var(--card-red); }
	textarea.input { resize: vertical; line-height: var(--lh-write); }
</style>
