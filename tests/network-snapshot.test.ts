import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db";
import { recordNetworkSnapshot } from "@/collector/network-snapshot";
const empty = { gatewayMac: null, gatewayIp: null, iface: null };
const connected = { gatewayMac: "aa:bb:cc:dd:ee:ff", gatewayIp: "192.168.1.1", iface: "en0" };
afterEach(() => vi.useRealTimers());
describe("唤醒网络快照重试", () => {
  it("网络稍后就绪时补齐原事件快照，不制造新的采样", async () => {
    vi.useFakeTimers();
    const db = openDb(":memory:"); let attempts = 0;
    const pending = recordNetworkSnapshot(db, 100, { probe: async () => ++attempts === 1 ? empty : connected });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe(true);
    expect(db.prepare("SELECT ts,gateway_mac FROM samples").all()).toEqual([{ ts: 100, gateway_mac: "aa:bb:cc:dd:ee:ff" }]);
    expect(db.prepare("SELECT last_seen FROM networks WHERE gateway_mac=?").get(connected.gatewayMac)?.last_seen).toBe(100);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempts).toBe(2);
    db.close();
  });
  it("第一次成功后不再读取网络", async () => {
    vi.useFakeTimers(); const db = openDb(":memory:"); let attempts = 0;
    expect(await recordNetworkSnapshot(db, 100, { probe: async () => { attempts++; return connected; } })).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempts).toBe(1); db.close();
  });
  it("一直离线时结束有限重试并保留可用字段", async () => {
    vi.useFakeTimers(); const db = openDb(":memory:"); const warnings: string[] = []; let attempts = 0;
    const pending = recordNetworkSnapshot(db, 100, { probe: async () => { attempts++; return { ...empty, iface: "en0" }; }, warn: text => warnings.push(text) });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toBe(false);
    expect(attempts).toBeGreaterThan(1); expect(attempts).toBeLessThan(10);
    expect(db.prepare("SELECT count(*) AS n,iface FROM samples").get()).toEqual({ n: 1, iface: "en0" });
    expect(warnings.length).toBeGreaterThan(0); db.close();
  });
  it("停止或新唤醒取消旧重试，等待期间不再执行探针", async () => {
    vi.useFakeTimers(); const db = openDb(":memory:"); const controller = new AbortController(); let attempts = 0;
    const pending = recordNetworkSnapshot(db, 100, { signal: controller.signal, probe: async () => { attempts++; return empty; } });
    await vi.advanceTimersByTimeAsync(0); controller.abort();
    expect(await pending).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempts).toBe(1); db.close();
  });
  it("探针尚未结束时取消，不把迟到结果写进数据库", async () => {
    const db = openDb(":memory:"); const controller = new AbortController();
    let finish!: (value: typeof connected) => void;
    const pending = recordNetworkSnapshot(db, 100, { signal: controller.signal, probe: () => new Promise(resolve => { finish = resolve; }) });
    controller.abort(); finish(connected);
    expect(await pending).toBe(false);
    expect(db.prepare("SELECT count(*) AS n FROM samples").get()?.n).toBe(0); db.close();
  });
  it("读取异常后也可重试成功", async () => {
    vi.useFakeTimers(); const db = openDb(":memory:"); let attempts = 0;
    const pending = recordNetworkSnapshot(db, 100, { probe: async () => { if (++attempts === 1) throw new Error("网络尚未就绪"); return connected; } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe(true);
    expect(db.prepare("SELECT gateway_mac FROM samples WHERE ts=100").get()?.gateway_mac).toBe(connected.gatewayMac); db.close();
  });
});
