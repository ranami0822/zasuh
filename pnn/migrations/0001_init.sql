-- pnn の公開の場（docs/pnn-server-design.md の第4節）。
-- 日時は、ミリ秒の整数（UTC）。id は UUID（TEXT）。
-- 投稿・返信・いいね・保存は、利用者 ID ではなく仮名（author / liker / owner）で記録する。

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  handle TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT ''
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX credentials_user ON credentials(user_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  pending_user TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'limited')),
  reveal_user TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (author, doc_id)
);
CREATE INDEX posts_feed ON posts(visibility, created_at);
CREATE INDEX posts_reveal ON posts(reveal_user);

CREATE TABLE likes (
  post_id TEXT NOT NULL,
  liker TEXT NOT NULL,
  counts INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, liker)
);

CREATE TABLE saves (
  owner TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, post_id)
);

CREATE TABLE replies (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX replies_post ON replies(post_id, created_at);

CREATE TABLE follows (
  follower TEXT NOT NULL,
  followee TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower, followee)
);
CREATE INDEX follows_followee ON follows(followee);
