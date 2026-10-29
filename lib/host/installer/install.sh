#!/usr/bin/env sh
# dsh-config-migrator 自带安装器（macOS / Linux）
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js 22 或更新版本：https://nodejs.org/" >&2
  exit 1
fi
exec node "$(dirname "$0")/install.mjs" "$@"
