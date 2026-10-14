// 电源日志解析与导入测试，样本为人工构造，不含本机活动记录。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { importPmsetText, insertPowerEvents } from "@/lib/pmset/import";
import { parseDisplaySleepMin, parsePmsetLine, parsePmsetLog } from "@/lib/pmset/parse";
import { jstHHMM, parseLocalDateTime } from "@/lib/time";

const sample = readFileSync(new URL("./fixtures/pmset-sample.log", import.meta.url), "utf8");

describe("解析单行", () => {
  it("亮屏", () => {
    const ev = parsePmsetLine(
      "2000-01-04 09:00:01 +0900 Notification        \tDisplay is turned on      \t   ",
    );
    expect(ev).toMatchObject({ kind: "display_on", reason: null });
    expect(ev!.ts).toBe(parseLocalDateTime("2000-01-04 09:00:01"));
  });

  it("合盖睡眠，包括退回 DarkWake 的情况", () => {
    const a = parsePmsetLine(
      "2000-01-04 18:00:02 +0900 Sleep               \tEntering Sleep state due to 'Clamshell Sleep':TCPKeepAlive=active Using AC\t",
    );
    const b = parsePmsetLine(
      "2000-01-03 02:43:25 +0900 Sleep               \tEntering DarkWake state due to 'Clamshell Sleep':TCPKeepAlive=active\t",
    );
    expect(a).toMatchObject({ kind: "sleep", reason: "clamshell" });
    expect(b).toMatchObject({ kind: "sleep", reason: "clamshell" });
  });

  it("唤醒原因：用户操作与通知", () => {
    const user = parsePmsetLine(
      "2000-01-04 09:00:02 +0900 Wake                \tWake from Deep Idle [CDNVA] : due to smc.sysState.Wake(0x70070000) lid SMC.OutboxNotEmpty RTP.multi-touch/UserActivity Assertion\t",
    );
    const notify = parsePmsetLine(
      "2000-01-03 02:43:15 +0900 Wake                \tDarkWake to FullWake from Deep Idle [CDNVAPB] : due to Notification Using AC\t",
    );
    expect(user).toMatchObject({ kind: "wake", reason: "user" });
    expect(notify).toMatchObject({ kind: "wake", reason: "notification" });
  });

  it("无关的行返回 null", () => {
    expect(parsePmsetLine("2000-01-04 00:08:18 +0900 WakeTime            \tWakeTime: 0.322 sec\t")).toBeNull();
    expect(parsePmsetLine("PM ASL data store: /var/log/powermanagement")).toBeNull();
  });
});

describe("解析整段日志", () => {
  const events = parsePmsetLog(sample);

  it("模拟日志的亮屏、灭屏时刻按顺序解析", () => {
    const day = events.filter((e) => e.raw.startsWith("2000-01-04") && e.kind.startsWith("display"));
    expect(day.map((e) => `${e.kind === "display_on" ? "亮" : "灭"}${jstHHMM(e.ts)}`)).toEqual([
      "亮09:00",
      "灭12:00",
      "亮13:00",
      "灭15:00",
      "亮15:15",
      "灭18:00",
    ]);
  });

  it("跳过无关行", () => {
    expect(events.some((e) => e.raw.includes("Assertions"))).toBe(false);
    expect(events.some((e) => e.raw.includes("WakeTime"))).toBe(false);
  });

  it("sinceTs 之前的事件被跳过", () => {
    const since = parseLocalDateTime("2000-01-04 00:00:00");
    expect(parsePmsetLog(sample, since).every((e) => e.ts >= since)).toBe(true);
  });
});

describe("导入数据库", () => {
  it("重复导入不产生重复数据", () => {
    const db = openDb(":memory:");
    const first = importPmsetText(db, sample);
    const second = importPmsetText(db, sample);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM power_events").get() as { n: number };
    expect(n).toBe(first);
  });

  it("增量导入会跳过旧事件，full 导入能补回来", () => {
    const db = openDb(":memory:");
    const all = parsePmsetLog(sample);
    // 先只导入最后一条，模拟数据库里已有较新的数据
    importPmsetText(db, all.at(-1)!.raw);
    const old = sample.split("\n").filter((l) => l.startsWith("2000-01-03")).join("\n");
    expect(importPmsetText(db, old)).toBe(0);
    expect(importPmsetText(db, old, { full: true })).toBeGreaterThan(0);
  });
});

it("读取熄屏等待时间", () => {
  expect(parseDisplaySleepMin(" sleep                1\n displaysleep         10\n")).toBe(10);
  expect(parseDisplaySleepMin("")).toBeNull();
});

it("系统日志补充原生事件的准确唤醒原因，重复导入幂等",()=>{
 const db=openDb(":memory:");
 try {
  const time=parseLocalDateTime("2000-01-04 23:00:00");
  insertPowerEvents(db,[{ts:time,kind:"wake",reason:"workspace",raw:'NSWorkspace {"kind":"wake"}'}]);
  const text="2000-01-04 23:00:00 +0900 Wake                \tWake due to Notification";
  importPmsetText(db,text);
  expect(db.prepare("SELECT reason FROM power_events WHERE ts=?").get(time)).toMatchObject({reason:"notification"});
  expect(importPmsetText(db,text)).toBe(0);
  insertPowerEvents(db,[{ts:time,kind:"wake",reason:"workspace",raw:'NSWorkspace {"kind":"wake"}'}]);
  expect(db.prepare("SELECT reason FROM power_events WHERE ts=?").get(time)).toMatchObject({reason:"notification"});
 }finally{db.close();}
});

it("早晨的原生唤醒不会跳过昨晚尚未补齐的结束事件",()=>{
 const db=openDb(":memory:");
 try {
  insertPowerEvents(db,[{ts:parseLocalDateTime("2000-01-04 09:00:00"),kind:"wake",reason:"user",raw:"历史系统日志"}]);
  insertPowerEvents(db,[{ts:parseLocalDateTime("2000-01-04 18:00:00"),kind:"sleep",reason:"workspace",raw:"NSWorkspace sleep"},{ts:parseLocalDateTime("2000-01-05 09:00:00"),kind:"wake",reason:"workspace",raw:"NSWorkspace wake"}]);
  importPmsetText(db,"2000-01-04 18:00:00 +0900 Sleep               \tEntering Sleep state due to 'Clamshell Sleep'\n2000-01-05 09:00:00 +0900 Wake                \tWake due to UserActivity");
  expect(db.prepare("SELECT reason FROM power_events WHERE ts=? AND kind='sleep'").get(parseLocalDateTime("2000-01-04 18:00:00"))).toMatchObject({reason:"clamshell"});
 }finally{db.close();}
});
