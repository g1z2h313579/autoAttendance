import { describe, expect, it } from "vitest";
import { parsePowerMessage } from "@/collector/power-listener";
describe("原生电源事件消息",()=>{
 it("解析准备就绪以及带时间的唤醒和睡眠",()=>{
  expect(parsePowerMessage('{"kind":"ready"}')).toEqual({kind:"ready"});
  expect(parsePowerMessage('{"kind":"sleep","ts":100,"reason":"workspace"}')).toMatchObject({ts:100,kind:"sleep",reason:"workspace"});
  expect(parsePowerMessage('{"kind":"wake","ts":200,"reason":"user"}')).toMatchObject({ts:200,kind:"wake",reason:"user"});
 });
 it("拒绝破损消息、未知种类和无效时间",()=>{
  for(const text of ['bad','null','{}','{"kind":"sleep","ts":-1}','{"kind":"sleep","ts":1.5}','{"kind":"sample","ts":100}']) expect(parsePowerMessage(text)).toBeNull();
 });
});
