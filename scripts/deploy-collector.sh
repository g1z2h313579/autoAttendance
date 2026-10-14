#!/bin/bash
# 构建并部署采集程序：复制到 ~/Library/Application Support/kaoqin/app，
# 生成 launchd 配置并（重新）启动。可以重复执行，用于升级。
set -euo pipefail
cd "$(dirname "$0")/.."

# 固定使用 Homebrew 的 node@22，避免 node 升级主版本后路径或 API 变化
NODE_BIN="${NODE_BIN:-/opt/homebrew/opt/node@22/bin/node}"
if [ ! -x "$NODE_BIN" ]; then
  echo "找不到 node：$NODE_BIN（可以用环境变量 NODE_BIN 指定）" >&2
  exit 1
fi
major=$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')
if [ "$major" != "22" ]; then
  echo "需要 Node 22，当前是 $major" >&2
  exit 1
fi

LABEL="local.kaoqin.collector"
DATA_DIR="$HOME/Library/Application Support/kaoqin"
APP_DIR="$DATA_DIR/app"
LOG_DIR="$HOME/Library/Logs/kaoqin"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

npm run --silent build:collector
mkdir -p "$APP_DIR" "$LOG_DIR" "$(dirname "$PLIST")"
cp dist/collector.mjs "$APP_DIR/collector.mjs"
cp dist/power-listener "$APP_DIR/power-listener"

sed -e "s|__NODE__|$NODE_BIN|g" \
    -e "s|__APP__|$APP_DIR|g" \
    -e "s|__LOG__|$LOG_DIR|g" \
    scripts/launchd/collector.plist > "$PLIST"
plutil -lint "$PLIST" > /dev/null

# 已在运行时先停掉，等它完全退出后再重新加载
if launchctl print "$DOMAIN/$LABEL" > /dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL" || true
  for _ in $(seq 1 20); do
    launchctl print "$DOMAIN/$LABEL" > /dev/null 2>&1 || break
    sleep 0.5
  done
fi
launchctl bootstrap "$DOMAIN" "$PLIST"

echo "采集程序已部署：$APP_DIR/collector.mjs"
echo "日志：$LOG_DIR/collector.log"
launchctl print "$DOMAIN/$LABEL" | grep -E "^\s*(state|pid) =" || true
