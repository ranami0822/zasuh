<script lang="ts">
	/** 触れたタグと向き（矢印と色。色だけで伝えない）。 */
	let { label, value }: { label: string; value: 'positive' | 'negative' | 'mixed' } = $props();
</script>

<span class="tag {value === 'positive' ? 'pos' : value === 'negative' ? 'neg' : 'mix'}">
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		{#if value === 'positive'}
			<path d="M17 7l-10 10M8 7h9v9" />
		{:else if value === 'negative'}
			<path d="M7 7l10 10M17 8v9H8" />
		{:else}
			<path d="M5 12h14" />
		{/if}
	</svg>
	{label}
</span>
