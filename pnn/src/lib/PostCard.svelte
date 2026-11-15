<script lang="ts">
	import Icon from './Icon.svelte';
	import { excerpt } from './render';
	import type { PostView } from './api';
	let { post }: { post: PostView } = $props();
	const date = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
</script>

<a class="card-link" href="/p/{post.id}">
	{#if post.title}<span class="t">{post.title}</span>{/if}
	{#if post.body}<span class="ex">{excerpt(post.body)}</span>{/if}
	<span class="meta-row">
		<span class="item"><Icon name="heart" small />{post.likes}</span>
		<span class="item"><Icon name="reply" small />{post.replies}</span>
		{#if post.author}<span class="item"><Icon name="person" small />{post.author.name}</span>{/if}
		<span class="item">{date(post.createdAt)}</span>
	</span>
</a>

<style>
	.t { font-size: var(--t-title); line-height: var(--lh-title); }
	.ex { line-height: var(--lh-write); }
</style>
