// 月初草稿、在线备份和年度提醒。数据库租约避免多个服务实例重复执行。
import { backup } from "node:sqlite";
import { mkdirSync, readdirSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSetting, setSetting, type Db } from "./db";
import { backupsDir } from "./paths";
import { jstDate, parseYm, nowSec } from "./time";
import { exportMonth } from "./export/month";
const execFileAsync=promisify(execFile);
interface MaintenanceState { backupDate?: string; draftYm?: string; notifiedYm?: string; holidayYear?: number }
interface TaskOptions {
  backupDirectory?: string; makeDraft?: (ym: string) => Promise<unknown>; notify?: (message: string) => Promise<void>;
}
async function notify(message: string): Promise<void> {
  // 通过 argv 传递文案，不把文件名或内容拼进 AppleScript 代码。
  await execFileAsync("/usr/bin/osascript",["-e",'on run argv\n display notification (item 1 of argv) with title "个人考勤"\nend run',message],{timeout:10000});
}
export async function runMaintenance(db: Db, now=nowSec(), options: TaskOptions = {}): Promise<void> {
  const owner=randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    const lease=getSetting<{owner:string;until:number}>(db,"maintenanceLease");
    if(lease && lease.until>now){db.exec("COMMIT");return;}
    setSetting(db,"maintenanceLease",{owner,until:now+300});db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
  try {
    const state=getSetting<MaintenanceState>(db,"maintenanceState") ?? {};
    const today=jstDate(now),[year,month]=parseYm(today.slice(0,7));
    if(state.backupDate!==today){
      const directory=options.backupDirectory ?? backupsDir();mkdirSync(directory,{recursive:true});
      const target=join(directory,`kaoqin-${today}.db`),temporary=`${target}.${owner}.tmp`;
      try {await backup(db,temporary);renameSync(temporary,target);}catch(error){try{unlinkSync(temporary);}catch{}throw error;}
      const files=readdirSync(/*turbopackIgnore: true*/ directory).filter(name=>/^kaoqin-\d{4}-\d{2}-\d{2}\.db$/.test(name)).sort().reverse();
      for(const name of files.slice(30))unlinkSync(join(/*turbopackIgnore: true*/ directory,name));
      state.backupDate=today;setSetting(db,"maintenanceState",state);
    }
    const previous=new Date(Date.UTC(year,month-2,1));
    const ym=`${previous.getUTCFullYear()}-${String(previous.getUTCMonth()+1).padStart(2,"0")}`;
    if(state.draftYm!==ym){
      // 已导出最终版的月份不再创建草稿。
      const final=db.prepare("SELECT export_file FROM months WHERE ym=?").get(ym)?.export_file;
      if(!final) await (options.makeDraft ? options.makeDraft(ym) : exportMonth(db,ym,{draft:true,force:true,now}));
      state.draftYm=ym;
      if(final)state.notifiedYm=ym;
      setSetting(db,"maintenanceState",state);
    }
    const send=options.notify ?? notify;
    if(state.notifiedYm!==ym){await send(`${ym} 的考勤草稿已生成，请打开个人考勤检查并导出。`);state.notifiedYm=ym;setSetting(db,"maintenanceState",state);}
    if(month===12 && state.holidayYear!==year){await send("请检查并更新明年的节假日数据依赖。");state.holidayYear=year;setSetting(db,"maintenanceState",state);}
  }finally {
    if(getSetting<{owner:string}>(db,"maintenanceLease")?.owner===owner)setSetting(db,"maintenanceLease",{owner,until:0});
  }
}
