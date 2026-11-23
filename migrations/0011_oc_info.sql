-- OpenCritic の作品情報（発売日、機種、ジャンル、開発元、販売元、Steam の ID、英語の説明）。JSON で 1 列に持つ（docs/mvp-design.md の 26 章）。
-- 点数・画像は、保存しない。NULL は、取っていない（手で作った作品など）。足すだけ。
ALTER TABLE works ADD COLUMN oc_info TEXT;
ALTER TABLE works ADD COLUMN oc_info_at TEXT;
-- 承認なしで、自動で作った作品の印（管理画面で見分け、非表示にするため）。
ALTER TABLE works ADD COLUMN auto_added INTEGER NOT NULL DEFAULT 0;

-- 自動の取り込みの、1 日 1 回の権利（UTC の日付）。毎分の定期実行が、枠の中で重なっても、1 回だけ動く。
CREATE TABLE discovery_runs (
  day TEXT PRIMARY KEY,
  started_at TEXT NOT NULL
);
