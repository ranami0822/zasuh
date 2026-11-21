-- 専門家（批評家）の取得を、小さな実行の繰り返しにする（docs/critics-incremental-plan.md の 3.2）。足すだけ。
-- 作品ごとの、取得の進み具合。
-- critic_cursor: NULL は、途中ではない。数は、次の実行が取るページ（0 始まり）。
-- critic_done_on: 最後まで読み切った（または、その日は諦めた）UTC の日付 'YYYY-MM-DD'。
-- critic_searched_on: 候補を検索した UTC の日付（見つからなかったときも入れる）。
ALTER TABLE works ADD COLUMN critic_cursor INTEGER;
ALTER TABLE works ADD COLUMN critic_done_on TEXT;
ALTER TABLE works ADD COLUMN critic_searched_on TEXT;

-- 実行の枠ごとの記録。1 日の合計は、day で足す。critic_runs（0006）は、使わなくなる（残す）。
-- slot は 'YYYY-MM-DDTHH:MM'、day は slot の先頭 10 文字。
-- calls、searches、reads は、取る前は割り当て、終わったら実績（reads は、失敗した読み取りも数える）。
-- stopped は、終わった理由。NULL は、実行中か、異常終了。
CREATE TABLE critic_slots (
  slot TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  started_at TEXT NOT NULL,
  calls INTEGER NOT NULL,
  searches INTEGER NOT NULL,
  reads INTEGER NOT NULL,
  stopped TEXT
);
CREATE INDEX critic_slots_day ON critic_slots (day);
