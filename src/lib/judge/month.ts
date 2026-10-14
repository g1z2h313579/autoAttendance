// 读写缓存与人工覆盖；纯判定逻辑不访问数据库。
import { transaction, type Db } from "../db";
import { readSettings } from "../settings";
import { businessDayWindow, datesOfMonth, nowSec } from "../time";
import type { PowerEvent } from "../pmset/parse";
import { judgeDay } from "./day";
import { isRestDay } from "./calendar";
import type { DayResult, Network, Sample } from "./types";

export function dayInput(db: Db, date: string, now = nowSec()) {
  const settings = readSettings(db);
  const { start, end } = businessDayWindow(date, settings.dayBoundaryHour);
  const samples = db.prepare("SELECT * FROM samples WHERE ts >= ? AND ts < ? ORDER BY ts").all(start - settings.backfillGapSec, end + 86400) as unknown as Sample[];
  const events = db.prepare("SELECT * FROM power_events WHERE ts >= ? AND ts <= ? ORDER BY ts").all(start - 86400, end + 10) as unknown as PowerEvent[];
  const networks = db.prepare("SELECT * FROM networks").all() as unknown as Network[];
  return { date, samples, events, networks, settings, now };
}

export function mergeManual(db: Db, day: DayResult): DayResult {
  const manual = db.prepare("SELECT category, clock_in, clock_out FROM day_manual WHERE date = ?").get(day.date) as Pick<DayResult, "category" | "clock_in" | "clock_out"> | undefined;
  const meta = db.prepare("SELECT note, confirmed_at FROM day_meta WHERE date = ?").get(day.date) as { note: string | null; confirmed_at: number | null } | undefined;
  if (!manual) return { ...day, ...meta, manual: false };
  const flags = day.flags.filter(f => !["地点未知", "休假待确认", "休息日上班待确认", "工时过短", "跨零点", "缺少结束事件", "下班待核对"].includes(f));
  if (manual.clock_in && manual.clock_out) {
    if (manual.clock_out < manual.clock_in) flags.push("跨零点");
    else if ((Number(manual.clock_out.slice(0, 2)) * 60 + Number(manual.clock_out.slice(3))) -
      (Number(manual.clock_in.slice(0, 2)) * 60 + Number(manual.clock_in.slice(3))) < readSettings(db).shortDayHours * 60) flags.push("工时过短");
  }
  return { ...day, ...manual, ...meta, flags, source: "manual", manual: true };
}

export function computeMonth(db: Db, ym: string, now = nowSec()): DayResult[] {
  const dates = datesOfMonth(ym);
  return transaction(db, () => {
    const locked = db.prepare("SELECT locked_at FROM months WHERE ym = ?").get(ym) as { locked_at: number | null } | undefined;
    const settings = readSettings(db);
    const upsert = db.prepare(`INSERT INTO day_auto (date, category, clock_in, clock_out, active_min, office_min, source, flags, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET category=excluded.category, clock_in=excluded.clock_in,
      clock_out=excluded.clock_out, active_min=excluded.active_min, office_min=excluded.office_min, source=excluded.source, flags=excluded.flags, computed_at=excluded.computed_at`);
    return dates.map(date => {
      let day: DayResult;
      if (locked?.locked_at) {
        const row = db.prepare("SELECT * FROM day_auto WHERE date = ?").get(date) as unknown as (Omit<DayResult, "flags"> & { flags: string }) | undefined;
        const { start, end } = businessDayWindow(date, settings.dayBoundaryHour);
        day = { date, category: null, clock_in: null, clock_out: null, active_min: 0, office_min: 0, source: "none", ...row,
          flags: row ? JSON.parse(row.flags) : [], sessions: [], is_rest_day: isRestDay(date, settings), status: now < start ? "future" : now < end ? "ongoing" : "past" };
      } else {
        day = judgeDay(dayInput(db, date, now));
        if (day.status !== "future") {
          const before=db.prepare("SELECT category,clock_in,clock_out,active_min,office_min,source,flags FROM day_auto WHERE date=?").get(date);
          const manual=db.prepare("SELECT date FROM day_manual WHERE date=?").get(date);
          const values={category:day.category,clock_in:day.clock_in,clock_out:day.clock_out,active_min:day.active_min,office_min:day.office_min,source:day.source,flags:JSON.stringify(day.flags)};
          if (before && !manual && Object.entries(values).some(([key,value])=>before[key]!==value)) db.prepare("UPDATE day_meta SET confirmed_at=NULL WHERE date=?").run(date);
          upsert.run(day.date, day.category, day.clock_in, day.clock_out, day.active_min, day.office_min, day.source, values.flags, now);
        }
      }
      return mergeManual(db, day);
    });
  });
}
