import holidays from "@holiday-jp/holiday_jp";
import { weekdayOf } from "../time";
import type { Settings } from "../settings";

export function isRestDay(date: string, settings: Settings): boolean {
  const weekday = weekdayOf(date);
  // 直接查日期字符串，避免第三方库用宿主机时区格式化 Date。
  return weekday === 0 || weekday === 6 || Object.hasOwn(holidays.holidays, date) || settings.companyHolidays.includes(date);
}
