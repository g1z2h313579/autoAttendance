import { describe, expect, it } from "vitest";
import { mergeDayDraft, type DayDraft } from "@/lib/day-draft";
const before: DayDraft = { category: "出勤", clock_in: "09:40", clock_out: "10:00", note: "" };
describe("自动刷新响应与正在输入的草稿合并", () => {
  it("请求发出后输入的备注保留，未编辑的结束时间更新", () => {
    expect(mergeDayDraft(before, { ...before, clock_out: "10:01" }, { ...before, note: "会议中" }))
      .toEqual({ category: "出勤", clock_in: "09:40", clock_out: "10:01", note: "会议中" });
  });
  it("已编辑的上下班时间和类别不被自动结果覆盖", () => {
    expect(mergeDayDraft(before, { ...before, clock_out: "10:01" }, { ...before, category: "在宅", clock_in: "09:30", clock_out: "18:30" }))
      .toEqual({ category: "在宅", clock_in: "09:30", clock_out: "18:30", note: "" });
  });
  it("保存后服务器值与草稿一致，后续自动更新继续生效", () => {
    const saved = { ...before, note: "会议中" };
    expect(mergeDayDraft(saved, { ...saved, clock_out: "10:02" }, saved))
      .toEqual({ category: "出勤", clock_in: "09:40", clock_out: "10:02", note: "会议中" });
  });
});
