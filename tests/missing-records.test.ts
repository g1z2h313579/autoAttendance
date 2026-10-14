import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@/lib/db";
import { confirmCleanDays, confirmDay, restoreAuto, saveDay } from "@/lib/db/attendance";
import { judgeDay } from "@/lib/judge/day";
import { computeMonth } from "@/lib/judge/month";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { exportChecks, exportMonth } from "@/lib/export/month";
import { installTemplate } from "@/lib/export/templates";
import { parseLocalDateTime as ts } from "@/lib/time";

const now = ts("2026-10-09 12:00:00");
const input = { date: "2026-10-07", samples: [], events: [], networks: [], settings: DEFAULT_SETTINGS, now };

describe("无记录工作日", () => {
  it("无事件或只有网络快照都不能推断为休假", () => {
    for (const samples of [[], [{ ts: ts("2026-10-07 09:30:00"), idle_sec: null, locked: null, display_hold: null, gateway_mac: null }]]) {
      expect(judgeDay({ ...input, samples })).toMatchObject({ category: null, clock_in: null, clock_out: null, flags: ["待补录"] });
    }
  });
  it("休息日、当前日、未来日不要求补录空白", () => {
    for (const date of ["2026-10-03", "2026-10-09", "2026-10-12"]) {
      expect(judgeDay({ ...input, date }).flags).toEqual([]);
    }
  });
  it("待补录日期不能确认；只改备注也不能绕过", () => {
    const db = openDb(":memory:");
    try {
      expect(() => confirmDay(db, input.date, now)).toThrow("类别");
      saveDay(db, input.date, { category: null, clock_in: null, clock_out: null, note: "暂未核对" }, now);
      expect(() => confirmDay(db, input.date, now)).toThrow("类别");
      expect(db.prepare("SELECT confirmed_at FROM day_meta WHERE date=?").get(input.date)?.confirmed_at).toBeNull();
    } finally { db.close(); }
  });
  it("本人明确填写休假或补齐工作时间后可以确认，恢复自动后再次待补录", () => {
    const db = openDb(":memory:");
    try {
      saveDay(db, input.date, { category: "有給休暇", clock_in: null, clock_out: null, note: "" }, now);
      expect(computeMonth(db, "2026-10", now)[6]).toMatchObject({ category: "有給休暇", flags: [], manual: true });
      expect(() => confirmDay(db, input.date, now)).not.toThrow();
      restoreAuto(db, input.date, now);
      expect(computeMonth(db, "2026-10", now)[6]).toMatchObject({ category: null, flags: ["待补录"], confirmed_at: null });
      saveDay(db, input.date, { category: "在宅", clock_in: "09:00", clock_out: "18:00", note: "" }, now);
      expect(() => confirmDay(db, input.date, now)).not.toThrow();
      expect(exportChecks([computeMonth(db, "2026-10", now)[6]]).errors).toEqual([]);
    } finally { db.close(); }
  });
  it("旧的未锁定自动休假会重算并撤销确认，人工休假保留", () => {
    const db = openDb(":memory:");
    try {
      computeMonth(db, "2026-10", now);
      db.prepare("UPDATE day_auto SET category=?,flags=? WHERE date=?").run("有給休暇", '["休假待确认"]', input.date);
      db.prepare("INSERT INTO day_meta(date,confirmed_at) VALUES(?,1)").run(input.date);
      saveDay(db, "2026-10-06", { category: "有給休暇", clock_in: null, clock_out: null, note: "" }, now);
      expect(computeMonth(db, "2026-10", now)[6]).toMatchObject({ category: null, flags: ["待补录"], confirmed_at: null });
      expect(computeMonth(db, "2026-10", now)[5]).toMatchObject({ category: "有給休暇", manual: true });
    } finally { db.close(); }
  });
  it("即使已有确认标记，无记录工作日仍不可作为正式表导出", () => {
    expect(exportChecks([{ ...judgeDay(input), confirmed_at: 1 }]).errors.join(" ")).toContain("补录");
  });
  it.each([
    { category: null, clock_in: null, clock_out: null },
    { category: null, clock_in: "09:00", clock_out: "18:00" },
    { category: "在宅" as const, clock_in: null, clock_out: null },
  ])("批量确认也拒绝人工清空后的不完整工作日：%j", fields => {
    const db = openDb(":memory:");
    try {
      db.prepare("INSERT INTO power_events(ts,kind,reason) VALUES(?,'wake','user')").run(ts("2026-10-07 09:00:00"));
      db.prepare("INSERT INTO power_events(ts,kind,reason) VALUES(?,'sleep','clamshell')").run(ts("2026-10-07 18:00:00"));
      saveDay(db, input.date, { ...fields, note: "" }, now);
      confirmCleanDays(db, "2026-10", now);
      expect(db.prepare("SELECT confirmed_at FROM day_meta WHERE date=?").get(input.date)?.confirmed_at ?? null).toBeNull();
    } finally { db.close(); }
  });
  it("强制导出不能跳过待补录，但月初草稿仍能生成且不锁定月份", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kaoqin-missing-"));
    vi.stubEnv("KAOQIN_DATA_DIR", directory);
    const db = openDb(":memory:");
    try {
      await expect(exportMonth(db, "2026-09", { force: true, lock: true, now })).rejects.toThrow("补录");
      expect(db.prepare("SELECT * FROM months").all()).toEqual([]);
      await installTemplate(db, readFileSync("tests/fixtures/template-example.xlsx"), "test.xlsx");
      const draft = await exportMonth(db, "2026-09", { draft: true, force: true, now });
      expect(existsSync(draft.path)).toBe(true);
      expect(draft.name).toContain("草稿");
      expect(draft.warnings.some(warning => warning.includes("补录"))).toBe(true);
      expect(db.prepare("SELECT * FROM months").all()).toEqual([]);
    } finally { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); }
  });
  it("导出返回服务端实际使用的时间快照，进行中日期跨分钟时仍能匹配新文件", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kaoqin-export-snapshot-"));
    vi.stubEnv("KAOQIN_DATA_DIR", directory);
    const db = openDb(":memory:");
    try {
      await installTemplate(db, readFileSync("tests/fixtures/template-example.xlsx"), "test.xlsx");
      const start = ts("2026-09-01 09:00:00");
      db.prepare("INSERT INTO power_events(ts,kind,reason) VALUES(?,'wake','user')").run(start);
      db.prepare("INSERT INTO networks(gateway_mac,label,is_office,first_seen,last_seen) VALUES(?,'公司',1,?,?)").run("aa:bb:cc:dd:ee:ff", start, start);
      db.prepare("INSERT INTO samples(ts,gateway_mac) VALUES(?,?)").run(start, "aa:bb:cc:dd:ee:ff");
      expect(computeMonth(db, "2026-09", ts("2026-09-01 10:30:00"))[0].clock_out).toBe("10:30");
      const result = await exportMonth(db, "2026-09", { force: true, now: ts("2026-09-01 10:31:00") });
      expect(JSON.parse(result.revision)[0]).toEqual(["2026-09-01", { category: "出勤", clock_in: "09:00", clock_out: "10:31", note: "" }]);
    } finally { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); }
  });
});
