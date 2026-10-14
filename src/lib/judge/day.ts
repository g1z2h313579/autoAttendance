import { businessDayWindow, jstDate, jstHHMM } from "../time";
import { backfillSessions } from "./backfill";
import { isRestDay } from "./calendar";
import { meetingActive, sampleSessions, unionSessions } from "./sessions";
import type { DayResult, JudgeInput } from "./types";

/** 仅用于没有电源事件的旧采样数据恢复起止依据。 */
export function judgeActivityDay(input: JudgeInput): DayResult {
  const { date, samples, events, networks, settings, now } = input;
  const { start, end } = businessDayWindow(date, settings.dayBoundaryHour);
  const status = now < start ? "future" : now < end ? "ongoing" : "past";
  const rest = isRestDay(date, settings);
  const result: DayResult = { date, category: null, clock_in: null, clock_out: null, active_min: 0, office_min: 0,
    source: "none", flags: [], sessions: [], status, is_rest_day: rest };
  if (status === "future") return result;
  const limit = Math.min(end, now);
  const recorded = sampleSessions(samples.filter(s => s.ts <= now), start, limit, settings);
  const backfilled = backfillSessions(samples.filter(s => s.ts <= now), events, start, limit, settings);
  result.sessions = unionSessions([...recorded, ...backfilled]);
  const first = result.sessions[0];
  if (first && settings.wakeCorrectionSec > 0) {
    const corrections = events.filter(e => e.ts >= Math.max(start, first.start - settings.wakeCorrectionSec) && e.ts <= first.start &&
      (e.kind === "display_on" || (e.kind === "wake" && e.reason !== "notification")));
    if (corrections.length) first.start = Math.min(first.start, ...corrections.map(e => e.ts));
  }
  result.source = recorded.length && backfilled.length ? "mixed" : recorded.length ? "samples" : backfilled.length ? "pmset" : "none";
  result.active_min = Math.floor(result.sessions.reduce((sum, s) => sum + s.end - s.start, 0) / 60);
  const office = new Set(networks.filter(n => n.is_office === 1).map(n => n.gateway_mac));
  const activeSamples = samples.filter(s => s.ts >= start && s.ts < limit && s.locked === 0 &&
    ((s.idle_sec !== null && s.idle_sec < settings.idleActiveSec) || meetingActive(s, settings)));
  // 同一分钟多条采样（重启时可能出现）只计算一次。
  result.office_min = new Set(activeSamples.filter(s => s.gateway_mac && office.has(s.gateway_mac)).map(s => Math.floor(s.ts / 60))).size;
  if (first) {
    const last = result.sessions.at(-1)!;
    result.clock_in = jstHHMM(first.start);
    result.clock_out = jstHHMM(last.end);
    if (jstDate(last.end) !== date) result.flags.push("跨零点");
    if (last.end - first.start < settings.shortDayHours * 3600) result.flags.push("工时过短");
  }
  if (backfilled.length) result.flags.push("含补录");
  if (!rest) {
    if (!first) {
      if (status === "past") result.flags.push("待补录");
    } else if (result.source === "pmset") result.flags.push("地点未知");
    else result.category = result.office_min >= settings.officeMinMinutes ? "出勤" : "在宅";
    const unknown = new Set(networks.filter(n => !n.label).map(n => n.gateway_mac));
    if (activeSamples.some(s => s.gateway_mac && unknown.has(s.gateway_mac))) result.flags.push("新网络");
  } else if (result.active_min >= settings.holidayWorkMinMinutes) {
    result.category = "休日出勤";
    result.flags.push("休息日上班待确认");
  } else { result.clock_in = null; result.clock_out = null; result.flags = result.flags.filter(f => f !== "工时过短" && f !== "跨零点"); }
  return result;
}

/** 按首次唤醒与末次睡眠生成一个连续区间，中间不扣睡眠或空闲。 */
export function judgeDay(input: JudgeInput): DayResult {
  const { date, samples, events, networks, settings, now } = input;
  const { start, end } = businessDayWindow(date, settings.dayBoundaryHour);
  const status = now < start ? "future" : now < end ? "ongoing" : "past";
  const rest = isRestDay(date, settings);
  const result: DayResult = { date, category: null, clock_in: null, clock_out: null, active_min: 0, office_min: 0,
    source: "none", flags: [], sessions: [], status, is_rest_day: rest };
  if (status === "future") return result;
  const limit = Math.min(end, now);
  const ordered = events.filter(e => e.ts <= now).sort((a,b) => a.ts-b.ts);
  const notificationWake = (ts: number) => ordered.some(e => e.kind === "wake" && e.reason === "notification" && Math.abs(e.ts-ts) <= 60);
  const realStart = (e: typeof events[number]) => {
    if (e.kind === "wake") return e.reason === "user";
    if (e.kind !== "display_on") return false;
    if (ordered.some(w => w.kind === "wake" && w.reason === "user" && Math.abs(w.ts-e.ts) <= 60)) return true;
    if (notificationWake(e.ts)) return false;
    const off = ordered.find(next => next.ts > e.ts && (next.kind === "display_off" || next.kind === "sleep"));
    // 系统会偶尔亮屏几秒；没有用户唤醒依据的短亮屏不当成开盖工作。
    return !off || off.ts-e.ts >= settings.backfillMinDisplayMin*60;
  };
  let first: number | null = null, finish: number | null = null;
  let asleep = false, background = false;
  for (const e of ordered) {
    if (e.ts < start || e.ts >= end || e.ts > limit) continue;
    if (e.kind === "dark_wake" || (e.kind === "wake" && e.reason === "notification")) { background = true; continue; }
    if (realStart(e)) {
      first ??= e.ts; asleep = false; background = false; finish = null;
    } else if (e.kind === "sleep" && first !== null && !asleep && !background &&
      !["maintenance", "service", "notification"].includes(e.reason ?? "")) {
      asleep = true; finish = e.ts;
    }
  }
  if (first === null) {
    // 旧版本保存的操作采样仍可用于历史首尾；新网络快照没有 idle_sec，不制造工作。
    const legacy = judgeActivityDay({ ...input, events: [] });
    if (!legacy.sessions.length) {
      if (!rest && status === "past") result.flags.push("待补录");
      return result;
    }
    first = legacy.sessions[0].start;
    finish = legacy.sessions.at(-1)!.end;
    result.source = "samples";
  } else {
    result.source = "pmset";
    if (!asleep) finish = status === "ongoing" ? limit : null;
  }
  result.clock_in = jstHHMM(first);
  result.clock_out = finish === null ? null : jstHHMM(finish);
  const duration = Math.max(0, (finish ?? first)-first);
  result.active_min = Math.floor(duration/60);
  result.sessions = [{ start: first, end: finish ?? first, source: result.source }];
  if (finish !== null && jstDate(finish) !== date) result.flags.push("跨零点");
  if (finish === null) result.flags.push("缺少结束事件");
  else if (duration < settings.shortDayHours*3600) result.flags.push("工时过短");
  result.flags.push("下班待核对");
  const observed = samples.filter(s => s.ts >= first! && s.ts <= limit && s.ts < end && s.locked !== 1 && s.gateway_mac);
  const office = new Set(networks.filter(n => n.is_office === 1).map(n => n.gateway_mac));
  const known = new Set(networks.map(n => n.gateway_mac));
  if (!rest) {
    if (observed.some(s => office.has(s.gateway_mac!))) result.category = "出勤";
    else if (observed.some(s => known.has(s.gateway_mac!))) result.category = "在宅";
    else result.flags.push("地点未知");
    const named = new Set(networks.filter(n => n.label).map(n => n.gateway_mac));
    if (observed.some(s => !named.has(s.gateway_mac!))) result.flags.push("新网络");
  } else if (result.active_min >= settings.holidayWorkMinMinutes) {
    result.category = "休日出勤"; result.flags.push("休息日上班待确认");
  } else if (finish !== null) {
    result.clock_in = null; result.clock_out = null; result.flags = [];
  }
  return result;
}
