<script lang="ts">
	/** ページごとの題と説明（検索や、共有したときの表示に使う）。 */
	let { title, description, type = 'website', url }: { title?: string; description: string; type?: 'website' | 'article'; url?: string } = $props();
	const full = $derived(title ? `${title} · Zasuh` : 'Zasuh');
</script>

<svelte:head>
	<title>{full}</title>
	<meta name="description" content={description} />
	<meta property="og:site_name" content="Zasuh" />
	<meta property="og:type" content={type} />
	<meta property="og:title" content={full} />
	<meta property="og:description" content={description} />
	{#if url}
		<meta property="og:url" content={url} />
		<link rel="canonical" href={url} />
	{/if}
	<meta name="twitter:card" content="summary" />
</svelte:head>
