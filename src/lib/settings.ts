// 默认配置与输入校验。数据库只保存覆盖值。
import { getSetting, setSetting, transaction, type Db } from "./db";
import { parseDate } from "./time";

export const DEFAULT_SETTINGS = {
  dayBoundaryHour: 5, idleActiveSec: 300, sessionGapMin: 15, backfillGapSec: 180,
  backfillMinDisplayMin: 2, wakeCorrectionSec: 120, officeMinMinutes: 30,
  holidayWorkMinMinutes: 60, shortDayHours: 4, displaySleepMin: 10,
  meetingApps: ["zoom.us", "Microsoft Teams", "Google Chrome", "Slack"],
  companyHolidays: [] as string[], exportDirectory: "",
};
export type Settings = typeof DEFAULT_SETTINGS;
export const NUMBER_SETTINGS: { key: keyof Settings; label: string; min: number; max: number }[] = [
  { key: "dayBoundaryHour", label: "业务日分界小时", min: 0, max: 12 },
  { key: "holidayWorkMinMinutes", label: "休息日上班所需区间分钟", min: 1, max: 1440 },
  { key: "shortDayHours", label: "工时过短阈值（小时）", min: 0, max: 12 },
];

export function readSettings(db: Db): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    const value = getSetting(db, key);
    if (value !== undefined) Object.assign(settings, { [key]: value });
  }
  return settings;
}

export function saveSettings(db: Db, input: Settings): void {
  for (const { key, min, max, label } of NUMBER_SETTINGS) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${label}须为 ${min}–${max} 之间的整数`);
    }
  }
  if (!Array.isArray(input.meetingApps) || input.meetingApps.some(x => typeof x !== "string" || x.length > 100 || x.includes(","))) {
    throw new Error("会议程序须每行一个进程名，不能包含逗号");
  }
  if (!Array.isArray(input.companyHolidays)) throw new Error("公司休息日格式错误");
  input.companyHolidays.forEach(parseDate);
  if (input.exportDirectory && !input.exportDirectory.startsWith("/")) throw new Error("导出目录须填写绝对路径");
  transaction(db, () => {
    for (const key of Object.keys(input) as (keyof Settings)[]) {
      if (!(key in DEFAULT_SETTINGS) || key === "displaySleepMin") continue;
      setSetting(db, key, input[key]);
    }
  });
}
