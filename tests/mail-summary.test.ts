import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { buildMailSummary, type SummaryDay } from "@/lib/mail-summary";
import { readTemplateWorkRules } from "@/lib/export/xlsx";
const template = readFileSync("tests/fixtures/template-example.xlsx");
const day = (category: SummaryDay["category"], clock_in: string | null = "09:30", clock_out: string | null = "18:30", status: SummaryDay["status"] = "past"): SummaryDay => ({date:"2026-09-01",category,clock_in,clock_out,status});

describe("月度邮件摘要", () => {
  it("邮件使用传入的个人配置，不混入其他使用者的信息", async () => {
    const summary = buildMailSummary([day("出勤")], await readTemplateWorkRules(template), {
      name: "示例员工", workplace: "示例现场", transportYen: 12000,
    });
    expect(summary.text).toContain("--氏名：示例员工");
    expect(summary.text).toContain("--現場：示例现场");
    expect(summary.text).toContain("--交通費:12000円");
  });
  it("模拟记录汇总工作日、类别和工时", async () => {
    const rows = [...Array.from({length:8},()=>day("出勤")), ...Array.from({length:4},()=>day("在宅")), ...Array.from({length:2},()=>day("有給休暇",null,null))];
    const summary=buildMailSummary(rows,await readTemplateWorkRules(template));
    expect(summary.text).toBe(["--氏名：请填写姓名","--現場：请填写工作地点","--勤務日合計：12日","--出勤:8日","--在宅:4日","--休暇:2日","--勤務時間:96H","--交通費:0円"].join("\n"));
    expect(summary.issues).toEqual([]);
  });
  it("分钟不取整，扣除午休及晚间休息后和模板一致", async () => {
    const rules=await readTemplateWorkRules(template);
    expect(buildMailSummary([day("出勤","09:41","18:33")],rules).text).toContain("--勤務時間:7H52M");
    expect(buildMailSummary([day("出勤","09:30","22:30")],rules).text).toContain("--勤務時間:11H");
  });
  it("修改模板休息时间时，摘要也使用当前模板的规则", async () => {
    const zip=await JSZip.loadAsync(template);
    const xml=await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    zip.file("xl/worksheets/sheet1.xml",xml.replace(/(<c\b[^>]*r="AM3"[^>]*>[\s\S]*?<v>)[^<]+/,"$1"+String(690/1440)));
    expect(buildMailSummary([day("在宅")],await readTemplateWorkRules(await zip.generateAsync({type:"nodebuffer"}))).text).toContain("--勤務時間:7H30M");
  });
  it("排除未来记录，包含进行中的记录；调休算休假、缺勤不算", async () => {
    const summary=buildMailSummary([day("出勤"),day("在宅","09:30","12:00","ongoing"),day("出勤","09:30","18:30","future"),day("代休",null,null),day("欠勤",null,null)],await readTemplateWorkRules(template));
    expect(summary.text).toContain("--勤務日合計：2日");
    expect(summary.text).toContain("--休暇:1日");
    expect(summary.text).toContain("--勤務時間:10H30M");
  });
  it("休息日上班纳入工作日合计，不改写到岗与居家的固定类别", async () => {
    const summary=buildMailSummary([day("休日出勤")],await readTemplateWorkRules(template));
    expect(summary.text).toContain("--勤務日合計：1日");
    expect(summary.text).toContain("--出勤:0日");
    expect(summary.text).toContain("--勤務時間:8H");
  });
  it("类别未知但时间完整仍按 Excel 累计，并提示核实", async () => {
    const summary=buildMailSummary([day(null)],await readTemplateWorkRules(template));
    expect(summary.text).toContain("--勤務時間:8H");
    expect(summary.issues.join(" ")).toContain("类别");
  });
  it("时间缺失不凭空补满一天，跨零点不输出误导性的工时", async () => {
    const rules=await readTemplateWorkRules(template);
    const missing=buildMailSummary([day("出勤","09:30",null)],rules);
    expect(missing.text).toContain("--勤務時間:0H");
    expect(missing.issues.join(" ")).toContain("时间");
    const cross=buildMailSummary([day("出勤","22:00","02:00")],rules);
    expect(cross.text).toContain("--勤務時間:—");
    expect(cross.totalMinutes).toBeNull();
    expect(cross.issues.join(" ")).toContain("跨零点");
  });
});
