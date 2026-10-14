import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { saveDay, restoreAuto, confirmDay, confirmCleanDays, setMonthLocked, collectorHealth } from "@/lib/db/attendance";
import { computeMonth } from "@/lib/judge/month";
import { parseLocalDateTime as ts } from "@/lib/time";
const now = ts("2026-10-09 12:00:00");
describe("人工编辑与确认", () => {
  it("只改备注不会创建人工考勤，修改时间会记录历史", () => {
    const db = openDb(":memory:");
    try {
      saveDay(db, "2026-10-07", { category: "有給休暇", clock_in: null, clock_out: null, note: "待核实" }, now);
      expect(db.prepare("SELECT count(*) AS n FROM day_manual").get()).toMatchObject({ n: 0 });
      saveDay(db, "2026-10-07", { category: "出勤", clock_in: "09:30", clock_out: "18:30", note: "已补录" }, now);
      expect(computeMonth(db, "2026-10", now)[6]).toMatchObject({ category: "出勤", clock_in: "09:30", manual: true });
      expect(Number(db.prepare("SELECT count(*) AS n FROM edit_logs").get()!.n)).toBeGreaterThanOrEqual(4);
      restoreAuto(db, "2026-10-07", now);
      expect(computeMonth(db, "2026-10", now)[6].manual).toBe(false);
    } finally { db.close(); }
  });
  it("锁定后禁止修改、恢复、确认，解锁后可以修改", () => {
    const db = openDb(":memory:");
    try {
      computeMonth(db, "2026-09", now); setMonthLocked(db, "2026-09", true, now);
      expect(() => saveDay(db, "2026-09-01", { category: null, clock_in: null, clock_out: null, note: "" }, now)).toThrow("锁定");
      expect(() => restoreAuto(db, "2026-09-01", now)).toThrow("锁定");
      expect(() => confirmDay(db, "2026-09-01", now)).toThrow("锁定");
      setMonthLocked(db, "2026-09", false, now);
      expect(() => saveDay(db, "2026-09-01", { category: null, clock_in: null, clock_out: null, note: "" }, now)).not.toThrow();
    } finally { db.close(); }
  });
  it("一键确认不会确认缺数据休假、当前日和未来日", () => {
    const db = openDb(":memory:");
    try {
      confirmCleanDays(db, "2026-10", now);
      expect(db.prepare("SELECT date FROM day_meta WHERE confirmed_at IS NOT NULL").all().map(r => r.date)).toEqual(["2026-10-03", "2026-10-04"]);
      expect(() => confirmDay(db, "2026-10-09", now)).toThrow("结束");
    } finally { db.close(); }
  });
  it("非法日期、时间、类别会被拒绝", () => {
    const db = openDb(":memory:");
    const input = { category: "出勤" as const, clock_in: "09:30", clock_out: "18:30", note: "" };
    try {
      expect(() => saveDay(db, "2026-02-30", input, now)).toThrow();
      expect(() => saveDay(db, "2026-10-07", { ...input, clock_in: "25:00" }, now)).toThrow();
      expect(() => saveDay(db, "2026-10-07", { ...input, category: "错误" as never }, now)).toThrow();
    } finally { db.close(); }
  });
});

describe("事件监听服务状态",()=>{
 it("没有新电源事件也保持健康，不要求每五分钟采样",()=>{
  const db=openDb(":memory:");
  try {
   db.prepare("INSERT INTO settings(key,value) VALUES('collectorState',?)").run(JSON.stringify({mode:"power",pid:process.pid,helper_pid:process.pid,ready:true,running:true,last_event_at:1}));
   expect(collectorHealth(db,now).healthy).toBe(true);
  }finally{db.close();}
 });
 it("监听器退出或未准备好时显示异常，即使有刚写入的历史采样",()=>{
  const db=openDb(":memory:");
  try {
   db.prepare("INSERT INTO samples(ts,idle_sec,locked) VALUES(?,0,0)").run(now);
   db.prepare("INSERT INTO settings(key,value) VALUES('collectorState',?)").run(JSON.stringify({mode:"power",pid:process.pid,helper_pid:process.pid,ready:false,running:true,last_event_at:now}));
   expect(collectorHealth(db,now).healthy).toBe(false);
  }finally{db.close();}
 });
});

it("进行中的自动结束已更新时，依据页面原值保存备注不创建人工覆盖",()=>{
 const db=openDb(":memory:");
 try {
  db.prepare("INSERT INTO power_events(ts,kind,reason,raw) VALUES(?,'wake','user','test')").run(ts("2026-10-09 09:00:00"));
  saveDay(db,"2026-10-09",{category:null,clock_in:"09:00",clock_out:"10:00",note:"开会",baseline:{category:null,clock_in:"09:00",clock_out:"10:00"}},ts("2026-10-09 11:00:00"));
  expect(db.prepare("SELECT count(*) AS n FROM day_manual").get()).toMatchObject({n:0});
  expect(computeMonth(db,"2026-10",ts("2026-10-09 12:00:00"))[8]).toMatchObject({clock_out:"12:00",note:"开会",manual:false});
 }finally{db.close();}
});
it("编辑一个字段时，其他未改字段采用当前自动结果",()=>{
 const db=openDb(":memory:");
 try {
  db.prepare("INSERT INTO power_events(ts,kind,reason,raw) VALUES(?,'wake','user','test')").run(ts("2026-10-09 09:00:00"));
  saveDay(db,"2026-10-09",{category:"出勤",clock_in:"09:00",clock_out:"10:00",note:"",baseline:{category:null,clock_in:"09:00",clock_out:"10:00"}},ts("2026-10-09 11:00:00"));
  expect(db.prepare("SELECT category,clock_out FROM day_manual").get()).toMatchObject({category:"出勤",clock_out:"11:00"});
 }finally{db.close();}
});
