-- 観点ごとの星の集計（docs/mvp-design.md の 20.6、20.7）。足すだけ。aspect_stats（向きの集計。0001）は、使わなくなる（残す。消すのは別の番号で）。
-- 作品 × タグ。tag_id = '_overall' は、分野のタグの答えをまとめたもの。
-- 数えるのは、言及あり（noul が 0.5 以上）で、星の段階ごとの確率を読めた答えだけ。
-- 利害関係のあるレビュー、非表示のレビュー、ほかと文面がほぼ同じレビューは含めない。
-- n_mention: 数えた答えの件数。soft_1〜soft_5: 段階ごとの確率の合計（ソフトな件数。星1〜5。整数に丸めない）。
-- mean: 平均（1〜5）。se: 平均の幅。NULL は、件数が少なくて出さない。
-- score_lower: 順位に使う、控えめな値（平均 - 1.96 × 幅。件数が少ないときは、共通の標準偏差で代用）。
CREATE TABLE aspect_star_stats (
  work_id TEXT NOT NULL REFERENCES works (id),
  tag_id TEXT NOT NULL,
  n_mention INTEGER NOT NULL,
  soft_1 REAL NOT NULL,
  soft_2 REAL NOT NULL,
  soft_3 REAL NOT NULL,
  soft_4 REAL NOT NULL,
  soft_5 REAL NOT NULL,
  mean REAL,
  se REAL,
  score_lower REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, tag_id)
);
