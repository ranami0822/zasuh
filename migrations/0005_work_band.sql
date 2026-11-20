-- 作品ページのタイトルの帯の色（何から何へのグラデーション。docs/mvp-design.md の19章）。
-- どちらも、#rrggbb。両方 NULL なら、既定の灰色。
ALTER TABLE works ADD COLUMN band_from TEXT;
ALTER TABLE works ADD COLUMN band_to TEXT;
