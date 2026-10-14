#!/bin/bash
# 停止并卸载常驻服务（删除 launchd 配置和部署的程序）。
# 数据库、模板、导出文件和日志都保留，需要时手动删除：
#   ~/Library/Application Support/kaoqin
#   ~/Library/Logs/kaoqin
set -euo pipefail

DOMAIN="gui/$(id -u)"
for LABEL in local.kaoqin.collector local.kaoqin.web; do
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  if launchctl print "$DOMAIN/$LABEL" > /dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$LABEL" || true
    echo "已停止 $LABEL"
  fi
  rm -f "$PLIST"
done

rm -rf "$HOME/Library/Application Support/kaoqin/app"
echo "已卸载。数据保留在 ~/Library/Application Support/kaoqin"
