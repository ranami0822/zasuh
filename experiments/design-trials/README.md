# デザインの試しの案

アプリには、組み込まない。実画面に、スタイルを上書きして、スクリーンショットで比べるための置き場。

- `mono.css`: 灰色の濃淡と白黒に、差し色を1色（orange / red / pink / cyan）だけ載せる案。評価の棒は、赤と緑のまま。角は、レイアウトの面だけ直角。
- 使い方（Playwright）: 画面を開き、`page.addStyleTag({ content: <mono.css の中身> })` と、`document.documentElement.dataset.accent = 'orange'` を実行する。ダークは、`colorScheme: 'dark'`。
- 経緯と判断は、`docs/mvp-design.md` の18章。

注: この案は、`docs/mvp-design.md` の19章で、本番のデザイン（`src/lib/styles/tokens.css`）に置き換わった。比べた記録として残す。
- `orange-text.css`: オレンジの文字の2案（明るい地の見出し / 暗い面の上だけ）。`document.documentElement.dataset.orangeText = 'light-headings' | 'dark-only'`。経緯は `docs/mvp-design.md` の20章。
  - 案B（暗い面の上だけ）を採用し、`src/lib/styles/app.css` に入れた（20.5）。
- `banner.css`: エラー・注意・成功のバナーの3案（灰に寄せた淡い色 / 灰の面＋色の四角 / 墨の面＋色の四角）。`document.documentElement.dataset.banner = 'muted' | 'mark' | 'ink'`。
