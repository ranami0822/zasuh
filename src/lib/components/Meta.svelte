<script lang="ts">
	/** ページごとの題と説明（検索や、共有したときの表示に使う）。 */
	let { title, description, type = 'website' }: { title?: string; description: string; type?: 'website' | 'article' } = $props();
	const full = $derived(title ? `${title} · Zasuh` : 'Zasuh');
</script>

<svelte:head>
	<title>{full}</title>
	<meta name="description" content={description} />
	<meta property="og:site_name" content="Zasuh" />
	<meta property="og:type" content={type} />
	<meta property="og:title" content={full} />
	<meta property="og:description" content={description} />
	<meta name="twitter:card" content="summary" />
</svelte:head>
