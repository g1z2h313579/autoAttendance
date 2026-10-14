import type { Db } from "../lib/db";
import { probeNetwork, type NetworkInfo } from "./probes";
type Options = { probe?: () => Promise<NetworkInfo>; signal?: AbortSignal; warn?: (message: string) => void };

function saveSnapshot(db: Db, ts: number, net: NetworkInfo) {
  db.prepare(`INSERT INTO samples(ts,gateway_mac,gateway_ip,iface) VALUES(?,?,?,?)
    ON CONFLICT(ts) DO UPDATE SET gateway_mac=COALESCE(excluded.gateway_mac,samples.gateway_mac),
    gateway_ip=COALESCE(excluded.gateway_ip,samples.gateway_ip),iface=COALESCE(excluded.iface,samples.iface)`)
    .run(ts, net.gatewayMac, net.gatewayIp, net.iface);
  if (net.gatewayMac) db.prepare(`INSERT INTO networks(gateway_mac,last_ip,first_seen,last_seen) VALUES(?,?,?,?)
    ON CONFLICT(gateway_mac) DO UPDATE SET last_ip=excluded.last_ip,last_seen=MAX(networks.last_seen,excluded.last_seen)`)
    .run(net.gatewayMac, net.gatewayIp, ts, ts);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    if (signal?.aborted) done();
  });
}

/** 网络恢复可能晚于唤醒通知；有限退避重试合并到同一个事件快照。 */
export async function recordNetworkSnapshot(db: Db, ts: number, options: Options = {}): Promise<boolean> {
  for (const delay of [0, 2000, 5000, 10_000, 20_000, 30_000]) {
    if (options.signal?.aborted) return false;
    if (delay) await wait(delay, options.signal);
    if (options.signal?.aborted) return false;
    try {
      const net = await (options.probe ?? probeNetwork)();
      if (options.signal?.aborted) return false;
      saveSnapshot(db, ts, net);
      if (net.gatewayMac) return true;
    } catch (error) { options.warn?.(`事件网络记录失败：${String(error)}`); }
  }
  options.warn?.("唤醒网络快照重试结束，仍未取得网关；地点暂待核实");
  return false;
}
