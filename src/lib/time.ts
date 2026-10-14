// 时间工具：内部一律用 Unix 秒，计算一律按东京时间。
// 日本没有夏令时，东京时间固定为 UTC+9，所以直接加偏移量，不依赖进程的 TZ 设置。

export const JST_OFFSET_SEC = 9 * 3600;

/** 默认业务日分界：每天 05:00 到次日 05:00 算同一天，凌晨加班算前一天 */
export const DEFAULT_DAY_BOUNDARY_HOUR = 5;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 当前 Unix 秒 */
export const nowSec = () => Math.floor(Date.now() / 1000);

/** Unix 秒 → 东京时间的各个字段 */
function jstParts(ts: number) {
  const d = new Date((ts + JST_OFFSET_SEC) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(), // 0 为周日
  };
}

/** 东京时间的日历日期 YYYY-MM-DD（按 0 点分界） */
export function jstDate(ts: number): string {
  const p = jstParts(ts);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** 东京时间的时刻 HH:MM，秒直接舍去 */
export function jstHHMM(ts: number): string {
  const p = jstParts(ts);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** 某个时刻属于哪个业务日（按分界小时切分） */
export function businessDate(ts: number, boundaryHour = DEFAULT_DAY_BOUNDARY_HOUR): string {
  return jstDate(ts - boundaryHour * 3600);
}

/** 业务日的时间窗口 [start, end)，单位 Unix 秒 */
export function businessDayWindow(
  date: string,
  boundaryHour = DEFAULT_DAY_BOUNDARY_HOUR,
): { start: number; end: number } {
  const [y, m, d] = parseDate(date);
  const start = Date.UTC(y, m - 1, d, boundaryHour) / 1000 - JST_OFFSET_SEC;
  return { start, end: start + 24 * 3600 };
}

/** 解析 YYYY-MM-DD，格式不对时抛错 */
export function parseDate(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`日期格式错误：${date}`);
  const parts: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (parts[0] < 1900 || parts[0] > 2100 || d.getUTCFullYear() !== parts[0] || d.getUTCMonth() !== parts[1] - 1 || d.getUTCDate() !== parts[2]) throw new Error(`日期无效：${date}`);
  return parts;
}

/** 某日期是星期几，0 为周日 */
export function weekdayOf(date: string): number {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 某个月的天数，ym 格式为 YYYY-MM */
export function daysInMonth(ym: string): number {
  const [y, m] = parseYm(ym);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 解析 YYYY-MM */
export function parseYm(ym: string): [number, number] {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error(`年月格式错误：${ym}`);
  const y = Number(m[1]), month = Number(m[2]);
  if (y < 1900 || y > 2100 || month < 1 || month > 12) throw new Error(`年月无效：${ym}`);
  return [y, month];
}

/** 某个月的全部日期 */
export function datesOfMonth(ym: string): string[] {
  const n = daysInMonth(ym);
  return Array.from({ length: n }, (_, i) => `${ym}-${pad2(i + 1)}`);
}

/** "HH:MM" → 当天 0 点起的分钟数 */
export function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`时刻格式错误：${hhmm}`);
  const hours = Number(m[1]), minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) throw new Error(`时刻无效：${hhmm}`);
  return hours * 60 + minutes;
}

/** 东京时间 "YYYY-MM-DD HH:MM:SS" 加时区后缀 → Unix 秒（用于解析系统日志） */
export function parseLocalDateTime(dateTime: string, tz = "+0900"): number {
  const iso = `${dateTime.replace(" ", "T")}${tz.slice(0, 3)}:${tz.slice(3)}`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`时间格式错误：${dateTime} ${tz}`);
  return Math.floor(ms / 1000);
}
