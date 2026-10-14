import { nowSec, parseDate, parseYm, hhmmToMinutes } from "../time";
import { computeMonth } from "../judge/month";
import { CATEGORIES, type Category, type DayResult } from "../judge/types";
import { getSetting, transaction, type Db } from "./index";
import type { CollectorState } from "../collector-state";

export function assertUnlocked(db: Db, ym: string): void {
  parseYm(ym);
  if (db.prepare("SELECT locked_at FROM months WHERE ym = ?").get(ym)?.locked_at) throw new Error("该月份已锁定，请先解锁");
}
function audit(db: Db, date: string, field: string, oldValue: unknown, newValue: unknown, now: number) {
  if ((oldValue ?? null) === (newValue ?? null)) return;
  db.prepare("INSERT INTO edit_logs (date, field, old_value, new_value, at) VALUES (?, ?, ?, ?, ?)")
    .run(date, field, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), now);
}
type DayFields = { category: Category | null; clock_in: string | null; clock_out: string | null };
export function saveDay(db: Db, date: string, values: DayFields & { note: string; baseline?: DayFields }, now = nowSec()): void {
  parseDate(date);
  if (values.category !== null && !CATEGORIES.includes(values.category)) throw new Error("考勤类别无效");
  if (values.clock_in) hhmmToMinutes(values.clock_in);
  if (values.clock_out) hhmmToMinutes(values.clock_out);
  if (values.note.length > 1000) throw new Error("备注不能超过 1000 字");
  const current = computeMonth(db, date.slice(0, 7), now).find(d => d.date === date)!;
  transaction(db, () => {
    assertUnlocked(db, date.slice(0, 7));
    const keys = ["category", "clock_in", "clock_out"] as const;
    // 未主动编辑的字段沿用最新自动值，避免只保存备注冻结进行中的下班时间。
    const effective = { ...values };
    for (const key of keys) if (values.baseline && values[key] === values.baseline[key]) Object.assign(effective, { [key]: current[key] });
    const changed = keys.some(key => effective[key] !== current[key]);
    if (changed) {
      db.prepare(`INSERT INTO day_manual (date, category, clock_in, clock_out, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET category=excluded.category, clock_in=excluded.clock_in, clock_out=excluded.clock_out, updated_at=excluded.updated_at`)
        .run(date, effective.category, effective.clock_in, effective.clock_out, now);
      for (const key of keys) audit(db, date, key, current[key], effective[key], now);
    }
    const noteChanged = values.note !== (current.note ?? "");
    if (noteChanged) audit(db, date, "note", current.note ?? "", values.note, now);
    if (changed || noteChanged) db.prepare(`INSERT INTO day_meta (date, note, confirmed_at) VALUES (?, ?, NULL)
      ON CONFLICT(date) DO UPDATE SET note=excluded.note, confirmed_at=NULL`).run(date, values.note);
  });
}
export function restoreAuto(db: Db, date: string, now = nowSec()): void {
  parseDate(date);
  transaction(db, () => {
    assertUnlocked(db, date.slice(0, 7));
    const before = db.prepare("SELECT * FROM day_manual WHERE date = ?").get(date);
    if (before) {
      db.prepare("DELETE FROM day_manual WHERE date = ?").run(date);
      db.prepare("UPDATE day_meta SET confirmed_at=NULL WHERE date=?").run(date);
      audit(db, date, "restore_auto", JSON.stringify(before), "自动判定", now);
    }
  });
}
function confirmationError(day: DayResult): string | undefined {
  if (day.status !== "past") return "业务日尚未结束，暂时不能确认";
  if (!day.category && (!day.is_rest_day || day.clock_in || day.clock_out)) return "请先补录并选择考勤类别";
  if (day.flags.includes("跨零点")) return "请先处理跨零点时间";
  if (day.flags.includes("地点未知")) return "请先选择到岗或居家";
  if (day.category && ["出勤", "在宅", "休日出勤"].includes(day.category) && (!day.clock_in || !day.clock_out)) return "请先补齐上下班时间";
}
export function confirmDay(db: Db, date: string, now = nowSec()): void {
  parseDate(date);
  assertUnlocked(db, date.slice(0, 7));
  const day = computeMonth(db, date.slice(0, 7), now).find(d => d.date === date)!;
  const error = confirmationError(day);
  if (error) throw new Error(error);
  transaction(db, () => {
    assertUnlocked(db, date.slice(0, 7));
    db.prepare("INSERT INTO day_meta (date, confirmed_at) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET confirmed_at=excluded.confirmed_at").run(date, now);
    audit(db, date, "confirmed_at", day.confirmed_at, now, now);
  });
}
export function confirmCleanDays(db: Db, ym: string, now = nowSec()): number {
  const days = computeMonth(db, ym, now);
  return transaction(db, () => {
    assertUnlocked(db, ym);
    let count = 0;
    for (const day of days) {
      if (confirmationError(day) || day.flags.length || day.confirmed_at) continue;
      db.prepare("INSERT INTO day_meta (date, confirmed_at) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET confirmed_at=excluded.confirmed_at").run(day.date, now);
      audit(db, day.date, "confirmed_at", null, now, now); count++;
    }
    return count;
  });
}
export function setMonthLocked(db: Db, ym: string, locked: boolean, now = nowSec()): void {
  parseYm(ym); if (locked) computeMonth(db, ym, now);
  db.prepare("INSERT INTO months (ym, locked_at) VALUES (?, ?) ON CONFLICT(ym) DO UPDATE SET locked_at=excluded.locked_at").run(ym, locked ? now : null);
}
export function saveNetwork(db: Db, mac: string, label: string, office: boolean): void {
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) throw new Error("网络标识无效");
  if (!label.trim() || label.length > 80) throw new Error("请填写 1–80 字的网络名称");
  if (!db.prepare("UPDATE networks SET label=?, is_office=? WHERE gateway_mac=?").run(label.trim(), office ? 1 : 0, mac).changes) throw new Error("网络记录不存在");
  db.exec(`UPDATE day_meta SET confirmed_at=NULL WHERE substr(date,1,7) NOT IN (SELECT ym FROM months WHERE locked_at IS NOT NULL)`);
}
export function collectorHealth(db: Db, now = nowSec()) {
  const state = getSetting<CollectorState>(db, "collectorState");
  if (state?.mode === "power") {
    const alive = (pid: number | null) => {
      if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
      try { process.kill(pid, 0); return true; } catch { return false; }
    };
    return { last_sample: state.last_event_at, healthy: state.running && state.ready && alive(state.pid) && alive(state.helper_pid) };
  }
  const row = db.prepare("SELECT MAX(ts) AS ts FROM samples").get() as { ts: number | null };
  return { last_sample: row.ts, healthy: row.ts !== null && now - row.ts <= 300 };
}
