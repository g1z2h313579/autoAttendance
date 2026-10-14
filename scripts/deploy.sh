#!/bin/bash
# 完整部署：先构建完成，再替换 Web 服务；数据与模板不删除。
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_BIN="${NODE_BIN:-/opt/homebrew/opt/node@22/bin/node}"
if [ ! -x "$NODE_BIN" ] || [ "$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  echo "需要 Node 22，请检查 NODE_BIN" >&2; exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
DATA_DIR="$HOME/Library/Application Support/kaoqin"
APP_DIR="$DATA_DIR/app/web"
NEXT_APP="$DATA_DIR/app/web-next-$(date +%Y%m%d-%H%M%S)-$$"
LOG_DIR="$HOME/Library/Logs/kaoqin"
PLIST="$HOME/Library/LaunchAgents/local.kaoqin.web.plist"
DOMAIN="gui/$(id -u)"
if [ "${KAOQIN_SKIP_BUILD:-0}" != "1" ]; then npm run build; fi
mkdir -p "$LOG_DIR" "$DATA_DIR/templates" "$(dirname "$PLIST")"
mkdir -p "$NEXT_APP"
# instrumentation 的文件追踪可能带入开发数据；明确排除，禁止随程序发布。
/usr/bin/rsync -a --exclude='/data/' --exclude='/tests/' --exclude='/doc/' --exclude='/dist/' --exclude='.env*' .next/standalone/ "$NEXT_APP/"
# 本机配置单独安装；Next 在服务启动时从工作目录加载，权限只允许当前用户读取。
if [ -f .env.local ]; then install -m 600 .env.local "$NEXT_APP/.env.local"; fi
mkdir -p "$NEXT_APP/.next/static"
/usr/bin/rsync -a .next/static/ "$NEXT_APP/.next/static/"
if [ -d public ]; then mkdir -p "$NEXT_APP/public"; /usr/bin/rsync -a public/ "$NEXT_APP/public/"; fi
DEFAULT_TEMPLATE="$DATA_DIR/templates/default-template.xlsx"
if [ -n "${KAOQIN_DEFAULT_TEMPLATE:-}" ]; then
  cp "$KAOQIN_DEFAULT_TEMPLATE" "$DEFAULT_TEMPLATE"
elif [ ! -f "$DEFAULT_TEMPLATE" ]; then
  cp src/assets/default-template.xlsx "$DEFAULT_TEMPLATE"
fi
# 使用 plistlib 替换占位符并正确转义 XML 特殊字符。
/usr/bin/python3 - "$NODE_BIN" "$APP_DIR" "$LOG_DIR" "$DEFAULT_TEMPLATE" "$PLIST" <<'PY'
import sys, plistlib
node,app,log,template,out=sys.argv[1:]
with open('scripts/launchd/web.plist','rb') as f: config=plistlib.load(f)
def replace(value):
    if isinstance(value,str):
        for a,b in [('__NODE__',node),('__APP__',app),('__LOG__',log),('__TEMPLATE__',template)]: value=value.replace(a,b)
    elif isinstance(value,list): value=[replace(x) for x in value]
    elif isinstance(value,dict): value={k:replace(v) for k,v in value.items()}
    return value
with open(out,'wb') as f: plistlib.dump(replace(config),f)
PY
plutil -lint "$PLIST" > /dev/null
if launchctl print "$DOMAIN/local.kaoqin.web" > /dev/null 2>&1; then
  launchctl bootout "$DOMAIN/local.kaoqin.web"
  for attempt in {1..20}; do
    launchctl print "$DOMAIN/local.kaoqin.web" > /dev/null 2>&1 || break
    sleep 0.5
  done
fi
PREVIOUS_APP="$DATA_DIR/app/web-previous-$(date +%Y%m%d-%H%M%S)-$$"
if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$PREVIOUS_APP"; fi
mv "$NEXT_APP" "$APP_DIR"
READY=0
STARTED=0
# bootout 的退出清理可能稍晚于服务消失；短暂加载失败时重试。
for attempt in {1..3}; do
  if launchctl bootstrap "$DOMAIN" "$PLIST"; then STARTED=1; break; fi
  sleep 1
done
if [ "$STARTED" = "1" ]; then
  for attempt in {1..20}; do
    if /usr/bin/curl --silent --fail --location http://127.0.0.1:3939/ > /dev/null; then READY=1; break; fi
    sleep 1
  done
fi
if [ "$READY" != "1" ]; then
  echo "Web 启动失败，恢复上一版本；请查看 $LOG_DIR/web.stderr.log" >&2
  launchctl bootout "$DOMAIN/local.kaoqin.web" || true
  mv "$APP_DIR" "$APP_DIR-failed-$$"
  if [ -d "$PREVIOUS_APP" ]; then mv "$PREVIOUS_APP" "$APP_DIR"; launchctl bootstrap "$DOMAIN" "$PLIST"; fi
  exit 1
fi
bash scripts/deploy-collector.sh
echo "部署完成：http://127.0.0.1:3939"
echo "日志：$LOG_DIR"
