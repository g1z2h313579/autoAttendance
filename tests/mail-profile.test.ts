import { afterEach, expect, it, vi } from "vitest";
import { readMailProfile } from "@/lib/mail-profile";

afterEach(() => vi.unstubAllEnvs());

it("读取当前本机配置，去掉外围空白", () => {
  vi.stubEnv("KAOQIN_MAIL_NAME", " 示例员工 ");
  vi.stubEnv("KAOQIN_MAIL_WORKPLACE", " 示例现场 ");
  vi.stubEnv("KAOQIN_MAIL_TRANSPORT_YEN", "12000");
  expect(readMailProfile()).toEqual({ name: "示例员工", workplace: "示例现场", transportYen: 12000 });
});

it("未配置时只显示占位信息和零交通费", () => {
  vi.stubEnv("KAOQIN_MAIL_NAME", undefined);
  vi.stubEnv("KAOQIN_MAIL_WORKPLACE", undefined);
  vi.stubEnv("KAOQIN_MAIL_TRANSPORT_YEN", undefined);
  expect(readMailProfile()).toEqual({ name: "请填写姓名", workplace: "请填写工作地点", transportYen: 0 });
});

it.each(["-1", "1.5", "abc", "Infinity", "9007199254740992"])("拒绝无效交通费 %s", amount => {
  vi.stubEnv("KAOQIN_MAIL_TRANSPORT_YEN", amount);
  expect(() => readMailProfile()).toThrow("非负整数");
});
