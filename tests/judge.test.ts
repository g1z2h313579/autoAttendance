import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { judgeActivityDay as judgeDay } from "@/lib/judge/day";
import { computeMonth } from "@/lib/judge/month";
import { openDb } from "@/lib/db";
import { parsePmsetLog, type PowerEvent } from "@/lib/pmset/parse";
import { parseLocalDateTime as ts } from "@/lib/time";
import type { Sample, JudgeInput } from "@/lib/judge/types";

const office = "02:ab:cd:00:00:01";
const networks = [{ gateway_mac: office, label: "公司", is_office: 1 }];
const sample = (time: string, idle = 0, extra: Partial<Sample> = {}): Sample => ({
  ts: ts(time), idle_sec: idle, locked: 0, display_hold: "", gateway_mac: office, ...extra,
});
const event = (time: string, kind: PowerEvent["kind"], reason: string | null = null): PowerEvent => ({ ts: ts(time), kind, reason, raw: "" });
function judge(samples: Sample[] = [], events: PowerEvent[] = [], extra: Partial<JudgeInput> = {}) {
  return judgeDay({ date: "2026-10-07", samples, events, networks, settings: DEFAULT_SETTINGS,
    now: ts("2026-10-09 12:00:00"), ...extra });
}
function work(start = "2026-10-07 09:30:00", minutes = 540) {
  const first = ts(start);
  return Array.from({ length: minutes + 1 }, (_, i) => sample("2026-10-07 09:30:00", 0, { ts: first + i * 60 }));
}

describe("历史采样恢复引擎", () => {
  it("正常工作日精确到分钟并判为到岗", () => {
    expect(judge(work())).toMatchObject({ clock_in: "09:30", clock_out: "18:30", category: "出勤", active_min: 540, office_min: 541 });
  });
  it("只操作一下也算上班", () => {
    expect(judge([sample("2026-10-07 10:00:59")])).toMatchObject({ clock_in: "10:00", clock_out: "10:00", category: "在宅" });
  });
  it("午休分成两段会话", () => {
    const result = judge([...work("2026-10-07 09:30:00", 150), ...work("2026-10-07 13:00:00", 330)]);
    expect(result.sessions).toHaveLength(2);
    expect(result.active_min).toBe(480);
  });
  it("次日后台唤醒的空闲计时停走，不应制造工作时刻", () => {
    const last = ts("2026-10-07 18:33:00");
    const samples=[sample("2026-10-07 18:33:00"),sample("2026-10-08 05:21:00", ts("2026-10-08 05:21:00") - last, { locked: 1 }),sample("2026-10-08 05:55:00",3526,{locked:1})];
    expect(judge(samples).clock_out).toBe("18:33");
    expect(judge(samples,[],{date:"2026-10-08"}).clock_in).toBeNull();
  });
  it("当晚再次使用会顺延下班", () => {
    expect(judge([...work(), sample("2026-10-07 21:00:00")]).clock_out).toBe("21:00");
  });
  it("未锁屏的会议可保持活跃，锁屏后不能", () => {
    const first = sample("2026-10-07 09:30:00");
    const meeting = sample("2026-10-07 09:40:00", 600, { display_hold: "zoom.us" });
    expect(judge([first, meeting]).active_min).toBe(10);
    expect(judge([first, { ...meeting, locked: 1 }]).active_min).toBe(0);
    expect(judge([first, { ...meeting, locked: null }]).active_min).toBe(0);
  });
  it("开盖时间可校正，通知唤醒不能校正", () => {
    const samples = [sample("2026-10-07 09:31:00")];
    expect(judge(samples, [event("2026-10-07 09:30:00", "display_on")]).clock_in).toBe("09:30");
    expect(judge(samples, [event("2026-10-07 09:30:00", "wake", "notification")]).clock_in).toBe("09:31");
  });
  it("模拟电源日志可以补录完整工作区间", () => {
    const events = parsePmsetLog(readFileSync("tests/fixtures/pmset-sample.log", "utf8"));
    expect(judge([], events, { date: "2000-01-04", now: ts("2000-01-06 12:00:00") })).toMatchObject({ clock_in: "09:00", clock_out: "18:00", category: null, source: "pmset" });
  });
  it("不足两分钟的亮屏噪声被丢弃", () => {
    expect(judge([], [event("2026-10-07 06:00:00", "display_on"), event("2026-10-07 06:00:08", "display_off")]).clock_in).toBeNull();
  });
  it("空闲灭屏减去等待时间，合盖不减", () => {
    const events = [event("2026-10-07 09:00:00", "display_on"), event("2026-10-07 10:10:00", "display_off")];
    expect(judge([], events).clock_out).toBe("10:00");
    expect(judge([], [...events, event("2026-10-07 10:10:01", "sleep", "clamshell")]).clock_out).toBe("10:10");
  });
  it("混合采样和补录重叠不重复计时", () => {
    const samples = work("2026-10-07 13:00:00", 330);
    const events = [event("2026-10-07 09:30:00", "display_on"), event("2026-10-07 18:30:00", "display_off"), event("2026-10-07 18:30:01", "sleep", "clamshell")];
    const result = judge(samples, events);
    expect(result.source).toBe("mixed");
    expect(result.active_min).toBe(540);
  });
  it("三分钟只用于判断缺采，不截掉长空白的前三分钟", () => {
    const samples=[sample("2026-10-10 09:00:00"),sample("2026-10-10 10:00:00")];
    const events=[event("2026-10-10 09:00:00","display_on"),event("2026-10-10 10:00:00","display_off"),event("2026-10-10 10:00:01","sleep","clamshell")];
    expect(judge(samples,events,{date:"2026-10-10",now:ts("2026-10-12 12:00:00")})).toMatchObject({active_min:60,category:"休日出勤"});
  });
  it("周末短暂使用留空，长时间使用标记待确认", () => {
    expect(judge([sample("2026-10-10 10:00:00")], [], { date: "2026-10-10", now: ts("2026-10-12 12:00:00") }).category).toBeNull();
    const result = judge(work("2026-10-10 10:00:00", 61), [], { date: "2026-10-10", now: ts("2026-10-12 12:00:00") });
    expect(result.category).toBe("休日出勤");
    expect(result.flags).toContain("休息日上班待确认");
  });
  it("无活动工作日保持类别为空，等待本人补录", () => {
    expect(judge()).toMatchObject({ category: null, flags: ["待补录"] });
  });
  it("当前日只标进行中，未来日不计算", () => {
    expect(judge([], [], { now: ts("2026-10-07 12:00:00") })).toMatchObject({ category: null, status: "ongoing", flags: [] });
    expect(judge([], [], { now: ts("2026-10-06 12:00:00") })).toMatchObject({ category: null, status: "future", flags: [] });
  });
  it("公司分钟只计算活跃且明确未锁屏的当天采样", () => {
    const samples = work("2026-10-07 09:30:00", 40).map((s, i) => ({ ...s, locked: i < 11 ? 1 : 0 }));
    expect(judge(samples).office_min).toBe(30);
    expect(judge(samples).category).toBe("出勤");
  });
  it("跨零点标记阻止导出", () => {
    expect(judge([...work(), sample("2026-10-08 01:00:00")]).flags).toContain("跨零点");
  });
  it("节假日判为休息日，不受机器时区影响", () => {
    expect(judge([], [], { date: "2026-09-22" }).is_rest_day).toBe(true);
  });
});

describe("月度缓存", () => {
  it("自动结果改变后撤销旧确认，未改变的人工覆盖保留确认", () => {
    const db=openDb(":memory:");const now=ts("2026-10-09 12:00:00");
    try {
      computeMonth(db,"2026-10",now);
      db.prepare("INSERT INTO day_meta (date,confirmed_at) VALUES (?,?)").run("2026-10-07",1);
      db.prepare("INSERT INTO day_manual VALUES (?,?,?,?,?)").run("2026-10-06","出勤","09:30","18:30",1);
      db.prepare("INSERT INTO day_meta (date,confirmed_at) VALUES (?,?)").run("2026-10-06",1);
      db.prepare("INSERT INTO samples (ts,idle_sec,locked) VALUES (?,0,0)").run(ts("2026-10-07 09:30:00"));
      db.prepare("INSERT INTO samples (ts,idle_sec,locked) VALUES (?,0,0)").run(ts("2026-10-06 09:30:00"));
      const days=computeMonth(db,"2026-10",now);
      expect(days[6].confirmed_at).toBeNull();expect(days[5].confirmed_at).toBe(1);
    }finally{db.close();}
  });
  it("重算不覆盖人工值，锁定后不改变缓存", () => {
    const db = openDb(":memory:");
    try {
      db.prepare("INSERT INTO day_manual VALUES (?, ?, ?, ?, ?)").run("2026-10-07", "出勤", "10:00", "19:00", 1);
      const rows = computeMonth(db, "2026-10", ts("2026-10-09 12:00:00"));
      expect(rows.find(d => d.date === "2026-10-07")).toMatchObject({ category: "出勤", clock_in: "10:00", clock_out: "19:00", source: "manual" });
      db.prepare("INSERT INTO months (ym, locked_at) VALUES (?, ?)").run("2026-10", 1);
      const before = db.prepare("SELECT * FROM day_auto").all();
      computeMonth(db, "2026-10", ts("2026-11-01 12:00:00"));
      expect(db.prepare("SELECT * FROM day_auto").all()).toEqual(before);
    } finally { db.close(); }
  });
});
