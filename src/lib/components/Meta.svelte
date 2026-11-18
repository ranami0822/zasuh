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
	<meta property="og:image" content="https://review.anami.party/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>
