import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { inspectTemplate, writeWorkbook } from "@/lib/export/xlsx";
import { exportChecks } from "@/lib/export/month";
import { datesOfMonth } from "@/lib/time";
import type { Category, DayResult } from "@/lib/judge/types";
const original = readFileSync("tests/fixtures/template-example.xlsx");
const categories: Record<string, Category> = {};
for (const day of [1,3]) categories[`2026-09-${String(day).padStart(2,"0")}`] = "出勤";
for (const day of [2]) categories[`2026-09-${String(day).padStart(2,"0")}`] = "在宅";
for (const day of [4]) categories[`2026-09-${String(day).padStart(2,"0")}`] = "有給休暇";
const days = datesOfMonth("2026-09").map(date => ({ date, category: categories[date] ?? null, clock_in: ["出勤","在宅"].includes(categories[date]) ? "09:30" : null, clock_out: ["出勤","在宅"].includes(categories[date]) ? "18:30" : null }));
describe("Excel 模板写入", () => {
  it("共享的默认模板没有个人考勤、编辑者信息或本机路径", async () => {
    const template = readFileSync("src/assets/default-template.xlsx");
    const zip = await JSZip.loadAsync(template);
    const doc = new DOMParser().parseFromString(await zip.file("xl/worksheets/sheet1.xml")!.async("string"), "text/xml");
    for (const cell of Array.from(doc.getElementsByTagName("c"))) {
      const match = /^(E|I|L|AK)(\d+)$/.exec(cell.getAttribute("r") ?? "");
      if (match && Number(match[2]) >= 13 && Number(match[2]) <= 43) {
        expect(cell.getElementsByTagName("v")).toHaveLength(0);
        expect(cell.getElementsByTagName("t")).toHaveLength(0);
      }
    }
    const core = new DOMParser().parseFromString(await zip.file("docProps/core.xml")!.async("string"), "text/xml");
    expect(core.documentElement?.textContent).toBe("");
    const workbook = new DOMParser().parseFromString(await zip.file("xl/workbook.xml")!.async("string"), "text/xml");
    expect(workbook.getElementsByTagNameNS("http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac", "absPath")).toHaveLength(0);
    expect((await inspectTemplate(template)).person).toBe("示例员工");
  });
  it("读取姓名和首个工作表，不写死工作表名称", async () => {
    expect(await inspectTemplate(original)).toMatchObject({ person: "示例员工", sheetPath: "xl/worksheets/sheet1.xml" });
  });
  it("模拟记录回归：只改变公式缓存与重算标志，其他部件保持原样", async () => {
    const result = await writeWorkbook(original, "2026-09", days);
    const source = await JSZip.loadAsync(original), output = await JSZip.loadAsync(result);
    for (const path of Object.keys(source.files).filter(p => !source.files[p].dir)) {
      const a = await source.file(path)!.async("string"), b = await output.file(path)!.async("string");
      if (path === "xl/workbook.xml") { expect(b).toContain('fullCalcOnLoad="1"'); continue; }
      if (path.startsWith("xl/worksheets/")) {
        const strip = (xml: string) => xml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, cell => cell.includes("<f") ? cell.replace(/<v\b[^>]*?(?:\/>|>[\s\S]*?<\/v>)/g, "") : cell);
        const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
        expect(hash(b),path).toBe(hash(strip(a)));
      } else expect(b).toBe(a);
    }
  });
  it("短月份清空多余行，时间写成数值，公式没有缓存", async () => {
    const zip = await JSZip.loadAsync(await writeWorkbook(original, "2026-02", [{ date:"2026-02-01", category:"在宅", clock_in:"09:41", clock_out:"18:33" }]));
    const doc = new DOMParser().parseFromString(await zip.file("xl/worksheets/sheet1.xml")!.async("string"), "text/xml");
    const cell = (id: string) => Array.from(doc.getElementsByTagName("c")).find(c=>c.getAttribute("r")===id)!;
    expect(Number(cell("I13").getElementsByTagName("v")[0].textContent)).toBeCloseTo(581/1440);
    expect(cell("E41").getElementsByTagName("v")).toHaveLength(0);
    expect(cell("I43").getElementsByTagName("v")).toHaveLength(0);
    expect(cell("A13").getElementsByTagName("f")).toHaveLength(1);
    expect(cell("A13").getElementsByTagName("v")).toHaveLength(0);
  });
  it("不兼容布局与伪造文件会被拒绝", async () => {
    await expect(inspectTemplate(Buffer.from("not xlsx"))).rejects.toThrow();
    const zip = await JSZip.loadAsync(original);
    zip.file("xl/worksheets/sheet1.xml", (await zip.file("xl/worksheets/sheet1.xml")!.async("string")).replace('r="E10"','r="E99"'));
    await expect(inspectTemplate(await zip.generateAsync({type:"nodebuffer"}))).rejects.toThrow("布局");
  });
  it("合法的单引号属性和命名空间前缀也能写入", async () => {
    for(const prefixed of [false,true]) {
      const zip=await JSZip.loadAsync(original);
      let xml=(await zip.file("xl/worksheets/sheet1.xml")!.async("string")).replace(/r="([^"]+)"/g,"r='$1'");
      if(prefixed)xml=xml.replace('<worksheet ', '<worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ').replace(/<(\/?)(c|v|f)(?=[\s/>])/g,"<$1x:$2");
      zip.file("xl/worksheets/sheet1.xml",xml);
      const input=await zip.generateAsync({type:"nodebuffer"});await inspectTemplate(input);
      const result=await JSZip.loadAsync(await writeWorkbook(input,"2026-10",[{date:"2026-10-01",category:"在宅",clock_in:"10:00",clock_out:"19:00"}]));
      const doc=new DOMParser().parseFromString(await result.file("xl/worksheets/sheet1.xml")!.async("string"),"text/xml");
      const ns="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
      const map=new Map(Array.from(doc.getElementsByTagNameNS(ns,"c")).map(c=>[c.getAttribute("r"),c]));
      expect(map.get("R1")!.getElementsByTagNameNS(ns,"v")[0].textContent).toBe("10");
      expect(Number(map.get("I13")!.getElementsByTagNameNS(ns,"v")[0].textContent)).toBeCloseTo(600/1440);
    }
  });
});
describe("导出前检查", () => {
  const day = {date:"2026-10-07",category:"出勤",clock_in:"09:30",clock_out:"18:30",flags:[],status:"past",is_rest_day:false} as unknown as DayResult;
  it("未确认有提示，已确认标记视为已处理", () => {
    expect(exportChecks([day]).warnings).toHaveLength(1);
    expect(exportChecks([{...day,flags:["含补录"],confirmed_at:1}]).warnings).toEqual([]);
  });
  it("跨零点不可强制导出", () => {
    expect(exportChecks([{...day,clock_out:"01:00"}]).errors[0]).toContain("跨零点");
  });
  it("类别或时间缺失不能生成看似完整的工作日", () => {
    expect(exportChecks([{...day,clock_out:null}]).errors[0]).toContain("时间");
    expect(exportChecks([{...day,category:null}]).warnings[0]).toContain("类别");
  });
});

it("缺少结束事件时，即使地点未选择也不能强制导出",()=>{
 expect(exportChecks([{date:"2026-10-10",category:null,clock_in:"09:30",clock_out:null,flags:["缺少结束事件"],status:"past"} as unknown as DayResult]).errors.join(" ")).toContain("结束");
});
