import type { DayResult } from "./judge/types";
import { hhmmToMinutes } from "./time";
export type SummaryDay = Pick<DayResult,"date"|"category"|"clock_in"|"clock_out"|"status">;
export const WORK_RULE_CELLS = ["AM2","AO2","AM3","AO3","AM6","AO6","AM7","AO7","AM8","AO8","AM9","AO9"] as const;
export type TemplateWorkRules = Record<typeof WORK_RULE_CELLS[number],number>;
export interface MailSummary { text: string; totalMinutes: number | null; issues: string[] }
export interface MailProfile { name: string; workplace: string; transportYen: number }
export const DEFAULT_MAIL_PROFILE: MailProfile = { name: "请填写姓名", workplace: "请填写工作地点", transportYen: 0 };
/** 与公司模板 U、X、AA 列公式一致，按规则区的分钟值汇总。 */
function templateMinutes(start: number, end: number, r: TemplateWorkRules): number {
  const overlap = (a: number, b: number) => Math.max(0, Math.min(end,b)-Math.max(start,a));
  const regular = overlap(r.AM2,r.AM3)+overlap(r.AO3,r.AO2);
  const early = start <= r.AO6
    ? start <= r.AM6
      ? end <= r.AM2 ? Math.max(0,end-r.AM6) : r.AO6-r.AM6
      : end <= r.AM2 ? end-start : r.AO6-start
    : 0;
  // 模板的晚间加班只比较下班时刻，此处保留原公式口径。
  const evening = (end >= r.AM7 ? Math.min(end,r.AO7)-r.AM7 : 0)
    + (end >= r.AM8 ? Math.min(end,r.AO8)-r.AM8 : 0);
  const night = start <= r.AO9 && end <= r.AO9 ? end-start
    : Math.max(0,r.AO9-start)+Math.max(0,end-r.AM9);
  return regular+early+evening+night;
}
export function buildMailSummary(days: SummaryDay[], rules: TemplateWorkRules | null, profile: MailProfile = DEFAULT_MAIL_PROFILE): MailSummary {
  const rows=days.filter(day=>day.status!=="future");
  const count=(category: SummaryDay["category"])=>rows.filter(day=>day.category===category).length;
  const office=count("出勤"),remote=count("在宅"),holiday=count("休日出勤");
  const issues:string[]=[];let totalMinutes:number|null=rules ? 0 : null;
  if(!rules)issues.push("无法读取当前模板工时规则，请检查模板。");
  for(const day of rows) {
    const working=day.category && ["出勤","在宅","休日出勤"].includes(day.category);
    if(!day.category && (day.clock_in || day.clock_out))issues.push(`${day.date}：考勤类别未选择。`);
    if(!day.clock_in || !day.clock_out){
      if(working || day.clock_in || day.clock_out)issues.push(`${day.date}：上下班时间不完整，暂不计入工时。`);
      continue;
    }
    try {
      const start=hhmmToMinutes(day.clock_in),end=hhmmToMinutes(day.clock_out);
      if(end<start){issues.push(`${day.date}：跨零点，请先处理时间。`);totalMinutes=null;}
      else if(rules && totalMinutes!==null)totalMinutes+=templateMinutes(start,end,rules);
    } catch {issues.push(`${day.date}：时间格式无效。`);totalMinutes=null;}
  }
  const hours=totalMinutes===null ? "—" : `${Math.floor(totalMinutes/60)}H${totalMinutes%60 ? `${String(totalMinutes%60).padStart(2,"0")}M` : ""}`;
  // 个人字段由服务端的本机配置传入，客户端代码只保留通用格式。
  const text=[`--氏名：${profile.name}`,`--現場：${profile.workplace}`,`--勤務日合計：${office+remote+holiday}日`,
    `--出勤:${office}日`,`--在宅:${remote}日`,`--休暇:${count("有給休暇")+count("代休")}日`,
    `--勤務時間:${hours}`,`--交通費:${profile.transportYen}円`].join("\n");
  return {text,totalMinutes,issues};
}
