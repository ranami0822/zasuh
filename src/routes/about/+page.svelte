<script lang="ts">
	import Meta from '#components/Meta.svelte';
	import Tiles from '#components/Tiles.svelte';

	/**
	 * 見本のレビュー1件を、AI が読み取ったときの星の分布（見本。実際の投稿でも、実際の読み取りでもない）。
	 * soft は、星1〜5の確率（合計 1）。書かれていない観点は、null（数えない）。
	 */
	const SAMPLE_ASPECTS: { label: string; soft: number[] | null }[] = [
		{ label: 'ゲーム性・内容', soft: [0, 0, 0.05, 0.31, 0.64] },
		{ label: '音楽・音', soft: [0, 0, 0, 0.2, 0.8] },
		{ label: '快適さ', soft: [0.15, 0.6, 0.25, 0, 0] },
		{ label: '価格', soft: null }
	];
	const meanOf = (soft: number[]) => soft.reduce((t, p, i) => t + p * (i + 1), 0);
</script>

<Meta title="紹介" description="理由がないと、それは評価じゃない。理由を書いたレビューを、AI が観点ごとに読み取って、星の分布にします。" />

<div class="about">
	<section class="about__hero">
		<Tiles />
		<div class="about__wrap">
			<div class="about__plate">
				<h1>理由がないと、<br />それは評価じゃない！</h1>
				<p>なぜそのレビューが、全体を影響しているのか？まともな、評価はレビューを直接参照するのではなく、Aiによる均等なレビューの分離器的な体系化で決まると思いませんか。</p>
			</div>
			<div class="panel about__sample">
				<h2>見本のレビュー<span class="muted">（見本です。実際の投稿ではありません）</span></h2>
				<p class="about__review">
					<mark>ボス戦のテンポが良く</mark>、負けてもすぐ再挑戦できた。<mark>曲が場面に合っていて</mark>、特に終盤は鳥肌が立った。ただ、<mark>ロードが長く</mark>、マップも見づらい。
				</p>
				<ul class="about__aspects">
					{#each SAMPLE_ASPECTS as a (a.label)}
						<li>
							<span>{a.label}</span>
							{#if a.soft}
								{@const mean = meanOf(a.soft).toFixed(1)}
								<div class="dist row" style="--bar: 8px">
									<div class="dist__bar" role="img" aria-label="星の分布。平均 {mean}">
										{#each a.soft as p, i (i)}
											<i class="s{i + 1}" style:flex={p} style:display={p > 0.001 ? 'block' : 'none'}></i>
										{/each}
									</div>
									<span class="dist__tail num" aria-hidden="true">★{mean}</span>
								</div>
							{:else}
								<div class="dist row" style="--bar: 8px">
									<div class="dist__bar empty" role="img" aria-label="言及なし"></div>
									<span class="dist__tail muted" aria-hidden="true">言及なし</span>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
				<p class="caption muted">下線は、理由にあたる部分。書かれていない観点は、数えません。</p>
			</div>
			<div class="about__actions">
				<a class="btn" href="/">レビューを書く作品を探す</a>
			</div>
		</div>
	</section>

	<section class="page about__rules">
		<h2>書くときの決まり</h2>
		<ul>
			<li>具体的な事実・特徴・体験が書かれた観点が、数えられます。「最高」「微妙」だけの文は、数えられません。</li>
			<li>作品の作り手、提供元、関係者は、利害関係を申告してください。別枠に表示し、集計には数えません。</li>
			<li>1つの作品に、1つの端末から、1件まで。直すときは編集してください（3回まで、投稿から7日以内）。</li>
		</ul>
		<p class="muted">くわしくは<a href="/terms">規約</a>。書きたい作品がないときは、<a href="/contact?kind=work_request">載せてほしい作品を頼めます</a>。</p>
	</section>
</div>
