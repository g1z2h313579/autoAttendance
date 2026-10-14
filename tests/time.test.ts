import { describe, expect, it } from "vitest";
import {
  businessDate,
  businessDayWindow,
  datesOfMonth,
  daysInMonth,
  hhmmToMinutes,
  jstDate,
  jstHHMM,
  parseLocalDateTime,
  weekdayOf,
} from "@/lib/time";

// 2026-10-07 09:41:31 东京时间
const T = parseLocalDateTime("2026-10-07 09:41:31", "+0900");

describe("时间工具", () => {
  it("解析带时区的本地时间", () => {
    expect(T).toBe(Date.UTC(2026, 9, 7, 0, 41, 31) / 1000);
  });

  it("东京时间的日期和时刻，秒直接舍去", () => {
    expect(jstDate(T)).toBe("2026-10-07");
    expect(jstHHMM(T)).toBe("09:41");
    expect(jstHHMM(T + 28)).toBe("09:41"); // 09:41:59 仍然是 09:41
  });

  it("业务日以 05:00 分界：凌晨算前一天", () => {
    const at0430 = parseLocalDateTime("2026-10-08 04:30:00");
    const at0500 = parseLocalDateTime("2026-10-08 05:00:00");
    expect(businessDate(at0430)).toBe("2026-10-07");
    expect(businessDate(at0500)).toBe("2026-10-08");
  });

  it("业务日的时间窗口", () => {
    const w = businessDayWindow("2026-10-07");
    expect(w.start).toBe(parseLocalDateTime("2026-10-07 05:00:00"));
    expect(w.end).toBe(parseLocalDateTime("2026-10-08 05:00:00"));
  });

  it("星期与月份天数", () => {
    expect(weekdayOf("2026-09-01")).toBe(2); // 周二
    expect(weekdayOf("2026-10-04")).toBe(0); // 周日
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(datesOfMonth("2026-09").at(-1)).toBe("2026-09-30");
  });

  it("HH:MM 转分钟，格式不对时报错", () => {
    expect(hhmmToMinutes("18:33")).toBe(18 * 60 + 33);
    expect(() => hhmmToMinutes("9:30")).toThrow();
  });
});
