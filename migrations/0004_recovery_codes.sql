-- 復旧コード（パスキーを使えなくなったときの手段。docs/mvp-design.md の16章）。
-- コードそのものは保存しない（ハッシュだけ）。1つのアカウントに、1つ。使うか、作り直すと、古いコードは無効になる。
CREATE TABLE recovery_codes (
  reviewer_id TEXT PRIMARY KEY REFERENCES reviewers (id),
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- コードを入力した回数（送信元の日ごとのハッシュ）。総当たりを、遅くするため。
CREATE TABLE recovery_attempts (
  ip_day_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX recovery_attempts_ip ON recovery_attempts (ip_day_hash);
