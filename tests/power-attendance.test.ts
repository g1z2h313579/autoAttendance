import { describe, expect, it } from "vitest";
import { judgeDay } from "@/lib/judge/day";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { parseLocalDateTime as ts } from "@/lib/time";
import type { PowerEvent } from "@/lib/pmset/parse";
import type { Sample } from "@/lib/judge/types";
const event=(time:string,kind:PowerEvent["kind"],reason:string|null=null):PowerEvent=>({ts:ts(`2026-10-07 ${time}`),kind,reason,raw:""});
const network="02:ab:cd:00:00:01";
const snapshot=(time:string,mac:string|null=network):Sample=>({ts:ts(`2026-10-07 ${time}`),idle_sec:null,locked:null,display_hold:null,gateway_mac:mac});
const judge=(events:PowerEvent[],samples:Sample[]=[],now=ts("2026-10-09 12:00:00"))=>judgeDay({date:"2026-10-07",events,samples,networks:[{gateway_mac:network,label:"公司",is_office:1},{gateway_mac:"aa:bb:cc:dd:ee:ff",label:"家",is_office:0}],settings:DEFAULT_SETTINGS,now});
const normal=[event("09:30:00","wake","user"),event("12:00:00","sleep","clamshell"),event("13:00:00","wake","user"),event("18:30:00","sleep","clamshell")];
describe("电源事件首尾考勤",()=>{
 it("首尾之间午休睡眠仍算连续工作，不扣除空闲等待",()=>{
  expect(judge(normal,[snapshot("09:30:00")])).toMatchObject({clock_in:"09:30",clock_out:"18:30",active_min:540,category:"出勤"});
  expect(judge(normal).sessions).toHaveLength(1);
 });
 it("不采样也能从首次开盖到最终睡眠推算，地点保持待核实",()=>{
  expect(judge(normal)).toMatchObject({clock_in:"09:30",clock_out:"18:30",source:"pmset",category:null});
  expect(judge(normal).flags).toContain("地点未知");
 });
 it("当天睡眠后先显示暂定结束，再次唤醒后延长到当前时间",()=>{
  expect(judge(normal,[],ts("2026-10-07 12:30:00"))).toMatchObject({clock_out:"12:00",active_min:150});
  expect(judge(normal,[],ts("2026-10-07 14:00:00"))).toMatchObject({clock_out:"14:00",active_min:270});
 });
 it("当晚再次唤醒和睡眠会顺延下班，后台维护不会顺延",()=>{
  const events=[...normal,event("20:00:00","wake","user"),event("21:00:00","sleep","software"),event("23:00:00","dark_wake"),event("23:10:00","sleep","maintenance")];
  expect(judge(events).clock_out).toBe("21:00");
 });
 it("通知唤醒连同亮屏和再次睡眠不制造夜间工作",()=>{
  const events=[...normal,event("23:00:00","wake","notification"),event("23:00:00","display_on"),event("23:00:10","sleep","clamshell")];
  expect(judge(events).clock_out).toBe("18:30");
  expect(judge(events.slice(4)).clock_in).toBeNull();
 });
 it("单次公司网络记录即可到岗，已知其他网络为居家，无网络不猜测",()=>{
  expect(judge(normal,[snapshot("09:30:00")]).category).toBe("出勤");
  expect(judge(normal,[snapshot("09:30:00","aa:bb:cc:dd:ee:ff")]).category).toBe("在宅");
  expect(judge(normal,[snapshot("09:30:00",null)]).category).toBeNull();
 });
 it("屏幕自动熄灭不结束工作，真实睡眠才暂记结束",()=>{
  const events=[event("09:30:00","display_on"),event("10:10:00","display_off"),event("18:30:00","sleep","idle")];
  expect(judge(events).clock_out).toBe("18:30");
  expect(judge(events.slice(0,2),[],ts("2026-10-07 14:00:00")).clock_out).toBe("14:00");
 });
 it("已结束业务日没有末次睡眠时不补到凌晨，提示核对结束",()=>{
  const result=judge([event("09:30:00","wake","user")]);
  expect(result.clock_out).toBeNull();
  expect(result.flags).toContain("缺少结束事件");
 });
 it("历史只有采样时保留起止，但中间空白也算工作区间",()=>{
  const samples=[snapshot("09:30:00"),snapshot("12:00:00"),snapshot("13:00:00"),snapshot("18:30:00")].map(s=>({...s,idle_sec:0,locked:0}));
  expect(judge([],samples)).toMatchObject({clock_in:"09:30",clock_out:"18:30",active_min:540});
 });
});

it("睡眠后的后台再次入睡不能推迟下班；没有用户唤醒的八秒亮屏噪声忽略",()=>{
 const events=[...normal,event("23:00:00","dark_wake"),event("23:01:00","sleep","clamshell"),event("23:10:00","display_on"),event("23:10:08","display_off"),event("23:10:12","sleep","clamshell")];
 expect(judge(events).clock_out).toBe("18:30");
});
it("有明确用户唤醒时，即使只使用几秒也保留起止",()=>{
 expect(judge([event("09:30:00","wake","user"),event("09:30:00","display_on"),event("09:30:08","display_off"),event("09:30:10","sleep","clamshell")])).toMatchObject({clock_in:"09:30",clock_out:"09:30"});
});

it("休息日缺少结束事件时保留开始和警告，不作为干净空白日",()=>{
 const result=judgeDay({date:"2026-10-10",events:[{...event("09:30:00","wake","user"),ts:ts("2026-10-10 09:30:00")}],samples:[],networks:[],settings:DEFAULT_SETTINGS,now:ts("2026-10-12 12:00:00")});
 expect(result.clock_in).toBe("09:30");expect(result.clock_out).toBeNull();expect(result.flags).toContain("缺少结束事件");
});
