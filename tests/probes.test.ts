// 探针解析测试使用人工构造的命令输出、示例网段和模拟网络标识。
import { describe, expect, it } from "vitest";
import {
  normalizeMac,
  parseDisplayHolds,
  parseIdleSec,
  parseLocked,
  parseScutilBlocks,
  parseScutilList,
  pickNetwork,
  routerMacOf,
} from "@/collector/probes";

describe("空闲秒数", () => {
  it("纳秒换算成秒并舍去小数", () => {
    expect(parseIdleSec(`    | |   "HIDIdleTime" = 112123456789\n`)).toBe(112);
  });
  it("没有该字段时返回 null", () => {
    expect(parseIdleSec("")).toBeNull();
  });
});

describe("锁屏", () => {
  const unlocked = `<dict><key>IOConsoleUsers</key><array><dict>
    <key>kCGSSessionOnConsoleKey</key><true/></dict></array></dict>`;
  const locked = `<dict><key>IOConsoleUsers</key><array><dict>
    <key>CGSSessionScreenIsLocked</key>
    <true/></dict></array></dict>`;

  it("未锁屏时键不存在", () => expect(parseLocked(unlocked)).toBe(0));
  it("锁屏时键为 true", () => expect(parseLocked(locked)).toBe(1));
  it("输出里连 IOConsoleUsers 都没有时无法判断", () => expect(parseLocked("<dict/>")).toBeNull());
});

describe("阻止熄屏的进程", () => {
  const out = `Assertion status system-wide:
   PreventUserIdleDisplaySleep    1
Listed by owning process:
   pid 100(ExampleApp): [0x0000000000000001] 00:02:14 NoIdleSleepAssertion named: "Electron"
   pid 549(powerd): [0x0001a7250001a2a0] 00:07:48 PreventUserIdleSystemSleep named: "Powerd - Prevent sleep while display is on"
   pid 1234(zoom.us): [0x0001a7250001a2a1] 00:31:02 PreventUserIdleDisplaySleep named: "Zoom meeting"
   pid 2345(Google Chrome): [0x0001a7250001a2a2] 00:01:00 PreventUserIdleDisplaySleep named: "Video Wake Lock"
   pid 1234(zoom.us): [0x0001a7250001a2a3] 00:31:02 NoDisplaySleepAssertion named: "Zoom legacy"
   pid 605(WindowServer): [0x0001a7250009a29f] 00:01:52 UserIsActive named: "com.apple.iohideventsystem.queue.tickle"`;

  it("只取阻止熄屏的声明，去重排序", () => {
    expect(parseDisplayHolds(out)).toBe("Google Chrome,zoom.us");
  });
  it("没有时返回空串", () => {
    expect(parseDisplayHolds("Listed by owning process:\n")).toBe("");
  });
});

describe("网络（scutil）", () => {
  const ID = "00000000-0000-4000-8000-000000000001";
  const first = `<dictionary> {
  PrimaryInterface : en0
  PrimaryService : ${ID}
  Router : 192.0.2.1
}
  subKey [0] = State:/Network/Service/${ID}/IPv4
`;
  const wifi = `<dictionary> {
  ARPResolvedHardwareAddress : 02:ab:cd:00:00:01
  ARPResolvedIPAddress : 192.0.2.1
  AdditionalRoutes : <array> {
    0 : <dictionary> {
      DestinationAddress : 192.0.2.54
      SubnetMask : 255.255.255.255
    }
  }
  Addresses : <array> {
    0 : 192.0.2.54
  }
  ConfirmedInterfaceName : en0
  InterfaceName : en0
  NetworkSignature : IPv4.Router=192.0.2.1;IPv4.RouterHardwareAddress=02:ab:cd:00:00:01
  Router : 192.0.2.1
}
`;

  it("解析顶层字典，忽略嵌套项", () => {
    const [g] = parseScutilBlocks(first);
    expect(g).toEqual({ PrimaryInterface: "en0", PrimaryService: ID, Router: "192.0.2.1" });
    const [s] = parseScutilBlocks(wifi);
    expect(s!.InterfaceName).toBe("en0");
    expect(s!.DestinationAddress).toBeUndefined();
  });

  it("键不存在时对应结果为 null，顺序保持一致", () => {
    expect(parseScutilBlocks(`  No such key\n${wifi}`).map((b) => b?.Router ?? null)).toEqual([
      null,
      "192.0.2.1",
    ]);
  });

  it("解析 list 输出", () => {
    expect(parseScutilList(first)).toEqual([`State:/Network/Service/${ID}/IPv4`]);
  });

  it("取路由器 MAC：优先 ARPResolvedHardwareAddress，其次 NetworkSignature", () => {
    expect(routerMacOf({ ARPResolvedHardwareAddress: "02:AB:CD:00:00:01" })).toBe("02:ab:cd:00:00:01");
    expect(
      routerMacOf({ NetworkSignature: "IPv4.Router=10.0.0.1;IPv4.RouterHardwareAddress=0:1a:b:3c:4d:5e" }),
    ).toBe("00:1a:0b:3c:4d:5e");
    expect(routerMacOf({})).toBeNull();
  });

  it("主服务是 VPN（没有路由器 MAC）时改用物理网卡", () => {
    const vpn = { id: "VPN", ipv4: { InterfaceName: "utun4", Router: "10.8.0.1" } };
    const en0 = { id: ID, ipv4: parseScutilBlocks(wifi)[0]! };
    expect(pickNetwork("VPN", [vpn, en0])).toEqual({
      iface: "en0",
      gatewayIp: "192.0.2.1",
      gatewayMac: "02:ab:cd:00:00:01",
    });
    expect(pickNetwork("VPN", [vpn])).toEqual({ iface: "utun4", gatewayIp: "10.8.0.1", gatewayMac: null });
  });

  it("MAC 规范化：小写并补足两位", () => {
    expect(normalizeMac("0:1A:b:3c:4d:5e")).toBe("00:1a:0b:3c:4d:5e");
  });
});
