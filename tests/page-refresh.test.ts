import { afterEach, describe, expect, it, vi } from "vitest";
import { startPageRefresh } from "@/lib/page-refresh";

afterEach(() => vi.useRealTimers());
describe("月页恢复后自动读取最新结果", () => {
  for (const event of ["visibilitychange", "pageshow", "focus", "online"]) {
    it(`${event} 恢复时读取今天的上班时间`, () => {
      const document = new EventTarget(), window = new EventTarget();
      let displayed = "未开始";
      const stop = startPageRefresh({ document, window, canRefresh: () => true, refresh: () => { displayed = "09:40"; } });
      (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event));
      expect(displayed).toBe("09:40");
      stop();
    });
  }
  it("没有进行中记录时也定时检查，切换日期后能发现上班", async () => {
    vi.useFakeTimers();
    let displayed = "未开始";
    const stop = startPageRefresh({ document: new EventTarget(), window: new EventTarget(), canRefresh: () => true, refresh: () => { displayed = "09:40"; } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(displayed).toBe("09:40");
    stop();
  });
  it("隐藏或有草稿时不刷新，恢复可刷新状态后更新", async () => {
    vi.useFakeTimers();
    const document = new EventTarget(), window = new EventTarget();
    let dirty = true, hidden = false, displayed = "草稿";
    const stop = startPageRefresh({ document, window, canRefresh: () => !dirty && !hidden, refresh: () => { displayed = "新结果"; } });
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(displayed).toBe("草稿");
    dirty = false; hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(displayed).toBe("草稿");
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(displayed).toBe("新结果");
    stop();
  });
  it("离开页面时移除所有监听和定时器", async () => {
    vi.useFakeTimers();
    const document = new EventTarget(), window = new EventTarget();
    let displayed = "旧结果";
    const stop = startPageRefresh({ document, window, canRefresh: () => true, refresh: () => { displayed = "新结果"; } });
    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    for (const event of ["pageshow", "focus", "online"]) window.dispatchEvent(new Event(event));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(displayed).toBe("旧结果");
  });
});
