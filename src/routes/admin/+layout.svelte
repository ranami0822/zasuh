<script lang="ts">
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head><title>管理 · Zasuh</title><meta name="robots" content="noindex" /></svelte:head>

<div class="page">
	<div class="header">
		<a class="brand" href="/admin">Zasuh 管理</a>
		{#if data.signedIn}
			<nav class="row">
				<a class="tag" href="/admin">作品</a>
				<a class="tag" href="/admin/reports">通報</a>
				<form method="post" action="/admin/login?/logout"><button class="tag" type="submit">ログアウト</button></form>
			</nav>
		{/if}
	</div>
	{@render children()}
</div>
