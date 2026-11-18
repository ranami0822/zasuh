<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="header">
	<a class="brand" href="/">Zasuh</a>
	<a class="tag" href={page.data.account ? '/me/security' : '/login'}>{page.data.account ? 'アカウント' : 'ログイン'}</a>
</div>
