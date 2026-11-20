<script lang="ts">
	import '#styles/tokens.css';
	import '#styles/app.css';
	import { Toast, ToastDescription, ToastRegion, ToastTitle } from '@ui-sdk/svelte/toast';
	import { page } from '$app/state';
	import Footer from '#components/Footer.svelte';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="shell">
	{@render children()}
	<!-- 管理画面には、フッターを出さない。 -->
	{#if !page.url.pathname.startsWith('/admin')}<Footer />{/if}
</div>

<ToastRegion>
	<Toast>
		<ToastTitle />
		<ToastDescription />
	</Toast>
</ToastRegion>
