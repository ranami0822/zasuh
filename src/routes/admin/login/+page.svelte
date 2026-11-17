<script lang="ts">
	import { Button } from '@ui-sdk/svelte/button';
	import { Field, FieldLabel } from '@ui-sdk/svelte/field';
	import { Input } from '@ui-sdk/svelte/input';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

{#if !data.configured}
	<p class="banner warning">管理画面は、合言葉（ADMIN_TOKEN）が設定されていないので、開けません。</p>
{:else}
	<form method="post" action="?/login" class="card stack">
		{#if form?.error}<p class="banner error" role="alert">{form.error}</p>{/if}
		<Field name="token">
			<FieldLabel>合言葉</FieldLabel>
			<Input class="input" type="password" required autocomplete="current-password" />
		</Field>
		<div class="row"><Button type="submit" class="btn">入る</Button></div>
	</form>
{/if}
