import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { transaction, type Db } from "../db";
import { exportsDir } from "../paths";
import { computeMonth } from "../judge/month";
import type { DayResult } from "../judge/types";
import { hhmmToMinutes, nowSec } from "../time";
import { readSettings } from "../settings";
import { currentTemplate } from "./templates";
import { inspectTemplate, writeWorkbook } from "./xlsx";
import { monthRevision } from "../day-draft";
export function exportChecks(days: DayResult[], options: { draft?: boolean } = {}) {
  const warnings: string[]=[],errors:string[]=[];
  for(const day of days) {
    if(day.status === "future")continue;
    if(day.flags.includes("缺少结束事件")) errors.push(`${day.date}：缺少结束事件，请手动补齐下班时间`);
    if(day.clock_in && day.clock_out && hhmmToMinutes(day.clock_out)<hhmmToMinutes(day.clock_in)) errors.push(`${day.date}：跨零点，请手动处理`);
    else if(day.flags.includes("跨零点")) errors.push(`${day.date}：跨零点，请手动处理`);
    if(day.category && ["出勤","在宅","休日出勤"].includes(day.category) && (!day.clock_in || !day.clock_out)) errors.push(`${day.date}：上下班时间不完整`);
    if(!day.category && ((day.status === "past" && !day.is_rest_day) || day.clock_in || day.clock_out)) {
      const message = `${day.date}：请先补录并选择考勤类别`;
      if(options.draft) warnings.push(message); else errors.push(message);
    }
    if(day.status === "ongoing") warnings.push(`${day.date}：业务日进行中`);
    else if(!day.confirmed_at) warnings.push(`${day.date}：未确认${day.flags.length ? `（${day.flags.join("、")}）` : ""}`);
  }
  return {warnings,errors};
}
export class ExportBlocked extends Error {
  constructor(public warnings: string[], public errors: string[]) { super(errors.length ? errors.join("；") : "有未确认记录，请检查后再导出"); }
}
function writeAtomic(path: string, buffer: Buffer) {
  const temp=`${path}.${randomUUID()}.tmp`;writeFileSync(temp,buffer);renameSync(temp,path);
}
export async function exportMonth(db: Db, ym: string, options: { force?: boolean; lock?: boolean; draft?: boolean; now?: number } = {}) {
  const now=options.now ?? nowSec();
  const days=computeMonth(db,ym,now),checks=exportChecks(days,{draft:options.draft});
  if(checks.errors.length || (!options.force && checks.warnings.length))throw new ExportBlocked(checks.warnings,checks.errors);
  const template=await currentTemplate(db),input=readFileSync(/*turbopackIgnore: true*/ template.stored_path);
  const meta=await inspectTemplate(input);
  const person=meta.person.replace(/[\x00-\x1f<>:"/\\|?*]/g,"_").replace(/^\.+|\.+$/g,"_");
  const name=`勤務表_${person}_${ym.replace("-","")}${options.draft ? "_草稿" : ""}.xlsx`;
  const buffer=await writeWorkbook(input,ym,days);
  mkdirSync(exportsDir(),{recursive:true});
  const path=join(exportsDir(),name);writeAtomic(path,buffer);
  const directory=readSettings(db).exportDirectory;
  if(directory && !options.draft) { mkdirSync(directory,{recursive:true});writeAtomic(join(directory,name),buffer); }
  if(!options.draft) transaction(db,()=>{
    db.prepare(`INSERT INTO months (ym,exported_at,export_file,locked_at) VALUES (?,?,?,?) ON CONFLICT(ym) DO UPDATE SET exported_at=excluded.exported_at,export_file=excluded.export_file,locked_at=COALESCE(excluded.locked_at,months.locked_at)`)
      .run(ym,now,path,options.lock ? now : null);
  });
  return {path,name,warnings:checks.warnings,revision:monthRevision(days)};
}
