// 把电源日志事件导入数据库。
// 原生事件立即保存，系统日志在启动、唤醒及每小时补齐；主键 (ts, kind) 去重。
import { getSetting, setSetting, transaction, type Db } from "../db";
import { parsePmsetLog, type PowerEvent } from "./parse";

/** 增量导入时往回多看一段时间，防止同一秒内的事件被漏掉 */
const OVERLAP_SEC = 3600;

/** 写入事件，返回新增或由系统日志补充准确原因的条数。 */
export function insertPowerEvents(db: Db, events: PowerEvent[]): number {
  const stmt = db.prepare(
    `INSERT INTO power_events (ts, kind, reason, raw) VALUES (?, ?, ?, ?)
      ON CONFLICT(ts,kind) DO UPDATE SET reason=excluded.reason,raw=excluded.raw
      WHERE power_events.raw LIKE 'NSWorkspace %' AND excluded.raw NOT LIKE 'NSWorkspace %'`,
  );
  let added = 0;
  transaction(db, () => {
    for (const e of events) {
      added += Number(stmt.run(e.ts, e.kind, e.reason, e.raw).changes);
    }
  });
  return added;
}

/** 已导入的最新事件时间，没有时为 0 */
export function lastPowerEventTs(db: Db): number {
  const row = db.prepare("SELECT MAX(ts) AS ts FROM power_events").get() as { ts: number | null };
  return row.ts ?? 0;
}

/**
 * 解析整段 `pmset -g log` 文本并导入，返回新增条数。
 * 默认增量导入（只处理最近导入时间之后的行）；导入保存下来的旧日志文件时用 full，全部处理并靠主键去重。
 */
export function importPmsetText(db: Db, text: string, opts: { full?: boolean } = {}): number {
  // 原生事件不能推进系统日志游标，否则早晨唤醒会跳过昨晚的漏记睡眠。
  const previous = getSetting<number>(db, "powerLogCursor") ?? Number(db.prepare("SELECT COALESCE(MAX(ts),0) AS ts FROM power_events WHERE raw NOT LIKE 'NSWorkspace %'").get()!.ts);
  const since = opts.full ? 0 : Math.max(0, previous - OVERLAP_SEC);
  const events = parsePmsetLog(text, since);
  const changed = insertPowerEvents(db, events);
  setSetting(db, "powerLogCursor", events.reduce((cursor,event) => Math.max(cursor,event.ts), previous));
  return changed;
}
