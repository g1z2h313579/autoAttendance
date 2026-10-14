// 事件采集入口：记录唤醒、睡眠及事件时的网络；不再按分钟读取使用状态。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, setSetting, type Db } from "../lib/db";
import { dbPath, logsDir } from "../lib/paths";
import { importPmsetText, insertPowerEvents, lastPowerEventTs } from "../lib/pmset/import";
import { nowSec } from "../lib/time";
import type { CollectorState } from "../lib/collector-state";
import { createLogger, type Logger } from "./logger";
import { readPmsetLog } from "./probes";
import { listenPowerEvents } from "./power-listener";
import { recordNetworkSnapshot } from "./network-snapshot";

/** 电源日志补齐监听器停机期间的事件；重复导入不会重复写入。 */
async function importPmset(db: Db, log: Logger): Promise<void> {
  const text = await readPmsetLog();
  if (text === null) log("warn", "读取电源日志失败");
  else {
    const added = importPmsetText(db, text);
    if (added > 0) log("info", `补齐电源事件 ${added} 条`);
  }
}

function importFile(file: string): void {
  const db = openDb();
  try {
    const added = importPmsetText(db, readFileSync(file, "utf8"), { full: true });
    console.log(`已从 ${file} 导入电源事件 ${added} 条（数据库：${dbPath()}）`);
  } finally { db.close(); }
}

async function runDaemon(): Promise<void> {
  const log = createLogger(join(logsDir(), "collector.log"), process.stdout.isTTY);
  const db = openDb();
  const state: CollectorState = { mode: "power", pid: process.pid, helper_pid: null, ready: false, running: true, last_event_at: lastPowerEventTs(db) || null };
  const saveState = () => setSetting(db, "collectorState", state);
  saveState();
  log("info", `电源事件监听启动，pid=${process.pid}，数据库：${dbPath()}`);
  await importPmset(db, log);
  state.last_event_at = lastPowerEventTs(db) || null;
  saveState();
  let stopped = false, importing = false;
  let importTimer: ReturnType<typeof setTimeout> | undefined;
  const syncHistory = async () => {
    if (importing || stopped) return;
    importing = true;
    try {
      await importPmset(db, log);
      if (!stopped) { state.last_event_at = lastPowerEventTs(db) || null; saveState(); }
    } catch (error) { log("error", `补齐电源日志失败：${String(error)}`); }
    finally { importing = false; }
  };
  let networkAttempt: AbortController | undefined;
  const networkSnapshot = (ts: number) => {
    networkAttempt?.abort();
    networkAttempt = new AbortController();
    return recordNetworkSnapshot(db, ts, { signal: networkAttempt.signal, warn: message => log("warn", message) });
  };
  const listener = listenPowerEvents(join(dirname(fileURLToPath(import.meta.url)), "power-listener"), {
    ready: pid => {
      state.helper_pid = pid; state.ready = true; saveState();
      log("info", `原生事件监听器就绪，pid=${pid}；每分钟采样已关闭`);
      void networkSnapshot(nowSec());
    },
    event: event => {
      if (stopped) return;
      insertPowerEvents(db, [event]);
      state.last_event_at = event.ts; saveState();
      log("info", `电源事件：${event.kind}`);
      if (event.kind === "sleep") networkAttempt?.abort();
      if (event.kind === "wake" || event.kind === "display_on") {
        void networkSnapshot(event.ts);
        // 唤醒后补齐睡眠前尚未落库的事件，同时取得系统记录的准确唤醒原因。
        if (importTimer) clearTimeout(importTimer);
        importTimer = setTimeout(() => { void syncHistory(); }, 1500);
      }
    },
    failure: message => { log("error", message); shutdown("监听器失效", 1); },
  });
  // 每小时仅补齐电源日志，不采集键鼠、空闲或会议程序状态。
  const historyTimer = setInterval(() => void syncHistory(), 60 * 60_000);
  function shutdown(signal: string, exitCode = 0) {
    if (stopped) return;
    stopped = true; clearInterval(historyTimer); if (importTimer) clearTimeout(importTimer);
    networkAttempt?.abort(); listener.stop(); state.running = false; state.ready = false; saveState();
    log("info", `收到 ${signal}，退出`); db.close(); process.exit(exitCode);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

const args = process.argv.slice(2);
if (args[0] === "--import-pmset") {
  if (!args[1]) { console.error("用法：collector.mjs --import-pmset <文件>"); process.exit(2); }
  importFile(args[1]);
} else {
  runDaemon().catch(error => { console.error("事件监听启动失败：", error); process.exit(1); });
}
