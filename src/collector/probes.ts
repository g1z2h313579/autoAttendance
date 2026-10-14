// 采集程序的探针：执行系统命令并解析输出。
// 解析函数是纯函数，单独导出以便测试；探针函数失败时返回 null，不让整次采样失败。
import { execFile } from "node:child_process";

const CMD = {
  ioreg: "/usr/sbin/ioreg",
  pmset: "/usr/bin/pmset",
  scutil: "/usr/sbin/scutil",
} as const;

/** 执行命令，超时或失败时返回 null。input 会写入标准输入 */
export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number; input?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 2000, maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout),
    );
    child.stdin?.end(opts.input ?? "");
  });
}

// ---------- 空闲秒数 ----------

/** 从 ioreg 输出中取 HIDIdleTime（纳秒）并换算成秒 */
export function parseIdleSec(out: string): number | null {
  const m = /"HIDIdleTime" = (\d+)/.exec(out);
  return m ? Math.floor(Number(m[1]) / 1e9) : null;
}

export async function probeIdleSec(): Promise<number | null> {
  const out = await run(CMD.ioreg, ["-c", "IOHIDSystem", "-r", "-k", "HIDIdleTime", "-d", "1"]);
  return out ? parseIdleSec(out) : null;
}

// ---------- 锁屏 ----------

/**
 * 从 `ioreg -n Root -d1 -a`（plist 格式）判断是否锁屏。
 * 锁屏时 IOConsoleUsers 里会出现 CGSSessionScreenIsLocked = true；未锁屏时这个键不存在。
 * 连 IOConsoleUsers 都没有时无法判断，返回 null。
 */
export function parseLocked(out: string): 0 | 1 | null {
  if (!out.includes("IOConsoleUsers")) return null;
  return /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(out) ? 1 : 0;
}

export async function probeLocked(): Promise<0 | 1 | null> {
  const out = await run(CMD.ioreg, ["-n", "Root", "-d1", "-a"]);
  return out ? parseLocked(out) : null;
}

// ---------- 阻止熄屏的进程 ----------

/**
 * 从 `pmset -g assertions` 中找出正在阻止熄屏的进程名，排序去重后用逗号连接。
 * 行的格式：pid 123(zoom.us): [0x...] 00:12:34 PreventUserIdleDisplaySleep named: "..."
 * NoDisplaySleepAssertion 是同一种声明的旧名称。
 */
export function parseDisplayHolds(out: string): string {
  const names = new Set<string>();
  const re = /pid \d+\((.+?)\): \[[^\]]*\] [\d:]+ (?:PreventUserIdleDisplaySleep|NoDisplaySleepAssertion)\b/g;
  for (const m of out.matchAll(re)) names.add(m[1]);
  return [...names].sort().join(",");
}

export async function probeDisplayHolds(): Promise<string | null> {
  const out = await run(CMD.pmset, ["-g", "assertions"]);
  return out === null ? null : parseDisplayHolds(out);
}

// ---------- 网络 ----------

export interface NetworkInfo {
  iface: string | null;
  gatewayIp: string | null;
  gatewayMac: string | null;
}

// 网关 MAC 从系统网络配置（configd，用 scutil 读取）里取，不用 arp：
// macOS 的"本地网络"隐私限制会让未授权的进程（例如 launchd 启动的 node）看到空的 ARP 表，
// 而 configd 在每个网络服务的 IPv4 状态里记录了路由器的 MAC（ARPResolvedHardwareAddress），读取不需要授权。

/** MAC 规范化：小写、每段补足两位 */
export function normalizeMac(mac: string): string {
  return mac
    .toLowerCase()
    .split(":")
    .map((p) => p.padStart(2, "0"))
    .join(":");
}

const MAC_RE = /^[0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5}$/;

/**
 * 把 scutil 的输出切成一个个顶层字典，只取顶层的 "键 : 值" 简单项（嵌套的数组、字典忽略）。
 * 每条 show 命令对应一个结果：字典，或者键不存在时的 null，顺序与命令一致。
 */
export function parseScutilBlocks(out: string): (Record<string, string> | null)[] {
  const blocks: (Record<string, string> | null)[] = [];
  let current: Record<string, string> | null = null;
  for (const line of out.split("\n")) {
    if (line === "<dictionary> {") {
      current = {};
    } else if (line === "}" && current) {
      blocks.push(current);
      current = null;
    } else if (current) {
      const m = /^ {2}(\S+) : (?!<)(.+)$/.exec(line);
      if (m) current[m[1]] = m[2].trim();
    } else if (line.trim() === "No such key") {
      blocks.push(null);
    }
  }
  return blocks;
}

/** 解析 scutil 的 list 输出，返回键名列表 */
export function parseScutilList(out: string): string[] {
  return [...out.matchAll(/subKey \[\d+\] = (\S+)/g)].map((m) => m[1]);
}

/** 从网络服务的 IPv4 状态中取路由器 MAC */
export function routerMacOf(service: Record<string, string>): string | null {
  const direct = service.ARPResolvedHardwareAddress;
  if (direct && MAC_RE.test(direct)) return normalizeMac(direct);
  const sig = /IPv4\.RouterHardwareAddress=([0-9a-fA-F:]+)/.exec(service.NetworkSignature ?? "");
  return sig && MAC_RE.test(sig[1]) ? normalizeMac(sig[1]) : null;
}

/**
 * 选出当前所在的网络：优先用主服务；主服务没有路由器 MAC（例如 VPN）时，
 * 改用第一个有路由器 MAC 的服务（物理网卡）。
 */
export function pickNetwork(
  primaryServiceId: string | null,
  services: { id: string; ipv4: Record<string, string> }[],
): NetworkInfo {
  const toInfo = (s: { ipv4: Record<string, string> }): NetworkInfo => ({
    iface: s.ipv4.InterfaceName ?? null,
    gatewayIp: s.ipv4.Router ?? null,
    gatewayMac: routerMacOf(s.ipv4),
  });
  const primary = services.find((s) => s.id === primaryServiceId);
  if (primary && routerMacOf(primary.ipv4)) return toInfo(primary);
  const physical = services.find((s) => routerMacOf(s.ipv4));
  if (physical) return toInfo(physical);
  return primary ? toInfo(primary) : { iface: null, gatewayIp: null, gatewayMac: null };
}

export async function probeNetwork(): Promise<NetworkInfo> {
  const empty: NetworkInfo = { iface: null, gatewayIp: null, gatewayMac: null };
  const first = await run(CMD.scutil, [], {
    input: "show State:/Network/Global/IPv4\nlist State:/Network/Service/[^/]+/IPv4\n",
  });
  if (!first) return empty;
  const global = parseScutilBlocks(first)[0] ?? null;
  const keys = parseScutilList(first);
  if (keys.length === 0) return empty;

  const second = await run(CMD.scutil, [], { input: keys.map((k) => `show ${k}\n`).join("") });
  if (!second) return empty;
  const blocks = parseScutilBlocks(second);
  const services = keys.flatMap((key, i) => {
    const ipv4 = blocks[i];
    const id = /^State:\/Network\/Service\/([^/]+)\/IPv4$/.exec(key)?.[1];
    return ipv4 && id ? [{ id, ipv4 }] : [];
  });
  return pickNetwork(global?.PrimaryService ?? null, services);
}

// ---------- 电源日志与设置 ----------

/** 读取完整的电源日志（几 MB），用于导入 power_events */
export function readPmsetLog(): Promise<string | null> {
  return run(CMD.pmset, ["-g", "log"], { timeoutMs: 60_000, maxBuffer: 128 * 1024 * 1024 });
}

/** 读取 `pmset -g`（当前电源设置） */
export function readPmsetSettings(): Promise<string | null> {
  return run(CMD.pmset, ["-g"]);
}
