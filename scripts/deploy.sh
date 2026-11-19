#!/bin/bash
# 本番へ反映する。使い方:
#   scripts/deploy.sh --build-only   作業用コピーを作って、ビルドだけする（本番には、触らない）
#   scripts/deploy.sh                ビルドして、デプロイする
#   scripts/deploy.sh --migrate      マイグレーション（migrations/）を、本番の D1 に適用してから、デプロイする
# 本番のデータベースへの変更（--migrate）と、デプロイは、ユーザーの依頼があるときだけ行う。
# リポジトリは root のもので、Cloudflare を呼ぶのは、非 root にする方針なので、ubuntu が書ける作業用コピーで行う。
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$PWD"
WORK="${ZASUH_WORK:-/tmp/zasuh-work}"
DEPLOY="$WORK/deploy"
MODE=deploy; MIGRATE=0
for a in "$@"; do case "$a" in --build-only) MODE=build ;; --migrate) MIGRATE=1 ;; *) echo "不明な引数: $a" >&2; exit 2 ;; esac; done

mkdir -p "$DEPLOY"
# 設定ファイルと本物の秘密（.dev.vars）、ローカル用の設定、履歴は、写さない。
tar --exclude=.git --exclude=.wrangler --exclude=.dev.vars --exclude=wrangler.local.jsonc --exclude=node_modules --exclude=.svelte-kit -cf - . | tar -xf - -C "$DEPLOY"
# 依存は、初回だけ、全体を写す（ubuntu はネットワークの設定が違い、npm install が通らないことがあるため）。パッケージを足したときは、消さずに、上書きで写す。
if [ ! -d "$DEPLOY/node_modules" ] || [ "$SRC/package-lock.json" -nt "$DEPLOY/.deps-synced" ]; then
  tar -cf - node_modules | tar -xf - -C "$DEPLOY"
  touch "$DEPLOY/.deps-synced"
fi
chown -R ubuntu "$DEPLOY"
runuser -u ubuntu -- env -i PATH="$PATH" HOME=/home/ubuntu bash -c "cd '$DEPLOY' && npm run build 2>&1 | tail -3"
[ "$MODE" = build ] && { echo "ビルドだけ済みました（本番には、触っていません）"; exit 0; }

if [ "$MIGRATE" = 1 ]; then "$SRC/scripts/cf.sh" d1 migrations apply DB --remote; fi
"$SRC/scripts/cf.sh" deploy
