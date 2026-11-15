<script lang="ts">
	import { iconPath, icons, type IconName } from './icons';
	let { name }: { name: IconName } = $props();
	const d = $derived(iconPath(name));
</script>

<svg class="icon" viewBox="0 0 16 16" shape-rendering="crispEdges" role="img" aria-label={icons[name].label}>
	<path {d} fill="currentColor" />
</svg>

<style>
	.icon { display: block; width: var(--icon); height: var(--icon); }
</style>
