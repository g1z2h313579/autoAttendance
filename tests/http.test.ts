import { describe, expect, it } from "vitest";
import { sameOrigin } from "../src/lib/http";

describe("本机写请求来源", () => {
  it("接受 Next 内部地址与浏览器 Host 不同的同源请求", () => {
    expect(sameOrigin(new Request("http://localhost:3941/api/export/2026-10", { headers: { host: "127.0.0.1:3941", origin: "http://127.0.0.1:3941" } }))).toBe(true);
  });
  it("拒绝跨站来源、不同端口和非法来源", () => {
    for (const origin of ["https://example.com", "http://127.0.0.1:3939", "null", "bad url"]) {
      expect(sameOrigin(new Request("http://localhost:3941/", { headers: { host: "127.0.0.1:3941", origin } }))).toBe(false);
    }
    expect(sameOrigin(new Request("http://localhost:3941/", { headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
  });
  it("允许本机命令行省略来源，但拒绝指向外部 Host", () => {
    expect(sameOrigin(new Request("http://127.0.0.1:3941/"))).toBe(true);
    expect(sameOrigin(new Request("http://localhost:3941/", { headers: { host: "example.com", origin: "http://example.com" } }))).toBe(false);
  });
});
