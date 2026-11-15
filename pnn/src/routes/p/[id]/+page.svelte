<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Icon from '../../../lib/Icon.svelte';
	import { press } from '../../../lib/press';
	import { api, ApiError, type PostDetail } from '../../../lib/api';
	import { render } from '../../../lib/render';

	let d = $state.raw<PostDetail | null>(null);
	let missing = $state(false);
	let text = $state('');
	let sending = $state(false);
	const id = $derived(page.params.id ?? '');

	async function load() {
		try { d = await api<PostDetail>('GET', `/api/posts/${id}`); }
		catch (e) { if (e instanceof ApiError && e.status === 404) missing = true; }
	}
	onMount(() => { load(); });

	async function act(fn: () => Promise<unknown>) {
		try { await fn(); await load(); }
		catch (e) { if (e instanceof ApiError && e.status === 401) goto(`/me?next=${encodeURIComponent(location.pathname)}`); }
	}
	const toggleLike = () => act(() => api(d!.liked ? 'DELETE' : 'POST', `/api/posts/${id}/like`));
	const toggleSave = () => act(() => api(d!.saved ? 'DELETE' : 'POST', `/api/posts/${id}/save`));
	const hide = (rid: string, hidden: boolean) => act(() => api('POST', `/api/replies/${rid}/hide`, { hidden }));
	async function send() {
		if (!text.trim() || sending) return;
		sending = true;
		await act(async () => { await api('POST', `/api/posts/${id}/replies`, { body: text }); text = ''; });
		sending = false;
	}
	const date = (t: number) => { const x = new Date(t); return `${x.getFullYear()}.${x.getMonth() + 1}.${x.getDate()}`; };
</script>

<svelte:head><title>{d?.post.title || 'pnn'}</title></svelte:head>

<main class="page-col">
	<header class="topbar">
		<a class="p chip soft icon-only" href="/feed" use:press aria-label="場"><span class="f"><Icon name="feed" /></span></a>
		<span class="sp"></span>
		<a class="p chip soft icon-only" href="/" use:press aria-label="書く"><span class="f"><Icon name="pen" /></span></a>
	</header>

	{#if missing}
		<p class="muted">見つからない。</p>
	{:else if d}
		<article class="stack">
			{#if d.post.title}<h1 class="big">{d.post.title}</h1>{/if}
			<div class="meta-row">
				{#if d.post.author}<a class="item author" href="/u/{d.post.author.handle}"><Icon name="person" small />{d.post.author.name}</a>{/if}
				<span class="item">{date(d.post.createdAt)}</span>
				{#if d.post.visibility === 'limited'}<span class="item">限定</span>{/if}
			</div>
			<!-- render は、記号をすべて逃がしてから、許した記法だけを HTML にする -->
			<div class="prose">{@html render(d.post.body)}</div>

			<div class="row">
				<button class="p chip soft" class:on={d.liked} use:press={{ k: 1.3 }} onclick={toggleLike} aria-label="いいね" aria-pressed={d.liked} disabled={d.isAuthor}>
					<span class="f row-i"><Icon name={d.liked ? 'heart-filled' : 'heart'} />{d.post.likes}</span>
				</button>
				<button class="p chip soft icon-only" class:on={d.saved} use:press onclick={toggleSave} aria-label="保存" aria-pressed={d.saved}>
					<span class="f"><Icon name={d.saved ? 'bookmark-filled' : 'bookmark'} /></span>
				</button>
			</div>

			{#if d.own}
				<div class="own muted">
					{d.own.reveal ? '名乗る' : '名乗らない'} ・ {d.own.counted} / {d.own.threshold}
					{#if d.own.reveal && !d.own.hasHandle} ・ <a href="/me">名前を決める</a>{/if}
				</div>
			{/if}

			<section class="stack replies">
				{#each d.replies as r (r.id)}
					<div class="reply" class:hidden={r.hidden}>
						<div class="prose">{@html render(r.body)}</div>
						<div class="meta-row">
							{#if r.byAuthor}<span class="item">書いた人</span>{/if}
							{#if r.mine && !r.byAuthor}<span class="item">あなた</span>{/if}
							<span class="item">{date(r.createdAt)}</span>
							{#if d.isAuthor && !r.byAuthor}
								<button class="p chip soft tight" use:press onclick={() => hide(r.id, !r.hidden)}><span class="f">{r.hidden ? '戻す' : '隠す'}</span></button>
							{/if}
						</div>
					</div>
				{/each}
				<textarea class="input" rows="3" bind:value={text} aria-label="返信"></textarea>
				<div class="row end">
					<button class="p btn" use:press onclick={send} disabled={!text.trim() || sending} aria-label="返信する"><span class="f"><Icon name="reply" /></span></button>
				</div>
			</section>
		</article>
	{/if}
</main>

<style>
	.row { display: flex; flex-wrap: wrap; gap: var(--gap); align-items: center; }
	.row.end { justify-content: flex-end; }
	.row-i { display: inline-flex; align-items: center; gap: var(--s1); }
	.author { color: inherit; text-decoration: none; }
	.own { background: var(--face); padding: var(--s3) var(--s4); border-radius: var(--r-card); }
	.own a { color: var(--ink); }
	.replies { margin-top: var(--s5); }
	.reply { background: var(--face); border-radius: var(--r-card); padding: var(--s3) var(--s4); display: grid; gap: var(--s2); }
	.reply.hidden { opacity: .5; }
	.input { width: 100%; border: 0; outline: 0; resize: vertical; background: var(--ring); color: var(--ink); border-radius: var(--r-card); padding: var(--s3) var(--s4); line-height: var(--lh-write); caret-color: var(--card-red); }
	button:disabled { opacity: .5; cursor: default; }
</style>
