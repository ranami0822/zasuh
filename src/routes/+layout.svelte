<script lang="ts">
	import '#styles/tokens.css';
	import '#styles/app.css';
	import { Toast, ToastDescription, ToastRegion, ToastTitle } from '@ui-sdk/svelte/toast';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Zasuh</title>
</svelte:head>

{@render children()}

<ToastRegion>
	<Toast>
		<ToastTitle />
		<ToastDescription />
	</Toast>
</ToastRegion>
