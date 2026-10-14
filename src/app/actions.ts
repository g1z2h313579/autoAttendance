"use server";
import { revalidatePath } from "next/cache";
import { withDb } from "@/lib/db/server";
import { confirmCleanDays, confirmDay, restoreAuto, saveDay, saveNetwork, setMonthLocked } from "@/lib/db/attendance";
import { readSettings, saveSettings, NUMBER_SETTINGS, type Settings } from "@/lib/settings";
import type { Category } from "@/lib/judge/types";
async function perform(fn: () => void, message = "已保存") {
  try { fn(); revalidatePath("/", "layout"); return { ok: true, message }; }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : "操作失败，请稍后重试" }; }
}
const string = (form: FormData, name: string) => String(form.get(name) ?? "");
export async function saveDayAction(form: FormData) {
  return perform(() => withDb(db => saveDay(db, string(form, "date"), {
    category: (string(form, "category") || null) as Category | null,
    clock_in: string(form, "clock_in") || null, clock_out: string(form, "clock_out") || null, note: string(form, "note"),
    baseline: form.has("original_category") && form.has("original_clock_in") && form.has("original_clock_out") ? {
      category: (string(form, "original_category") || null) as Category | null,
      clock_in: string(form, "original_clock_in") || null, clock_out: string(form, "original_clock_out") || null,
    } : undefined,
  })));
}
export async function dayOperationAction(form: FormData) {
  return perform(() => withDb(db => {
    if (string(form, "operation") === "restore") restoreAuto(db, string(form, "date"));
    else confirmDay(db, string(form, "date"));
  }), string(form, "operation") === "restore" ? "已恢复自动判定" : "已确认");
}
export async function monthOperationAction(form: FormData) {
  const operation = string(form, "operation");
  return perform(() => withDb(db => {
    if (operation === "confirm") confirmCleanDays(db, string(form, "ym"));
    else if (operation === "lock" || operation === "unlock") setMonthLocked(db, string(form, "ym"), operation === "lock");
    else throw new Error("操作无效");
  }), operation === "confirm" ? "已确认所有已结束且无标记的日期" : operation === "lock" ? "月份已锁定" : "月份已解锁");
}
export async function saveNetworkAction(form: FormData) {
  return perform(() => withDb(db => saveNetwork(db, string(form, "mac"), string(form, "label"), form.get("office") === "on")));
}
export async function saveSettingsAction(form: FormData) {
  return perform(() => withDb(db => {
    const settings: Settings = { ...readSettings(db) };
    for (const { key } of NUMBER_SETTINGS) Object.assign(settings, { [key]: Number(string(form, key)) });
    if (form.has("meetingApps")) settings.meetingApps = string(form, "meetingApps").split("\n").map(s => s.trim()).filter(Boolean);
    settings.companyHolidays = string(form, "companyHolidays").split(/\s+/).filter(Boolean);
    settings.exportDirectory = string(form, "exportDirectory").trim();
    saveSettings(db, settings);
    db.exec(`UPDATE day_meta SET confirmed_at=NULL WHERE substr(date,1,7) NOT IN (SELECT ym FROM months WHERE locked_at IS NOT NULL)`);
  }), "设置已保存；未锁定月份将在下次查看时重算");
}
