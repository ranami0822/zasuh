#!/bin/bash
# Cloudflare を呼ぶコマンドを、非 root で実行する（認証情報は、環境変数で渡し、出力しない）。
# 使い方: scripts/cf.sh <wrangler の引数...>      例: scripts/cf.sh d1 list
# 前提: 環境変数 CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN がある（環境の設定）。ubuntu ユーザーがいる。
# 実行場所は、ubuntu が書ける作業用コピー（scripts/deploy.sh が作る。ZASUH_WORK の下の deploy）。
set -euo pipefail
WORK="${ZASUH_WORK:-/tmp/zasuh-work}"
DEPLOY="$WORK/deploy"
[ -d "$DEPLOY" ] || { echo "作業用コピーがありません。先に scripts/deploy.sh --build-only を実行してください" >&2; exit 1; }
CA="$WORK/ca.crt"
if [ ! -r "$CA" ]; then cp /root/.ccr/ca-bundle.crt "$CA"; chmod a+r "$CA"; fi
cd "$DEPLOY"
exec runuser -u ubuntu -- env -i PATH="$PATH" HOME=/home/ubuntu \
  HTTPS_PROXY="${HTTPS_PROXY:-}" https_proxy="${HTTPS_PROXY:-}" \
  CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:?}" CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:?}" \
  NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1 NODE_EXTRA_CA_CERTS="$CA" CI=1 \
  npx wrangler "$@"
