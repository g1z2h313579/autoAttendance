import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "@/lib/db";
import { runMaintenance } from "@/lib/tasks";
import { parseLocalDateTime as ts } from "@/lib/time";
describe("定时任务", () => {
  it("已有最终版时不生成草稿，也不会在后续检查误发通知", async () => {
    const dir=mkdtempSync(join(tmpdir(),"kaoqin-tasks-")),db=openDb(":memory:");let drafts=0,notifications=0;
    try {
      db.prepare("INSERT INTO months (ym,export_file) VALUES (?,?)").run("2026-09","final.xlsx");
      const options={backupDirectory:dir,makeDraft:async()=>{drafts++;},notify:async()=>{notifications++;}};
      await runMaintenance(db,ts("2026-10-09 12:00:00"),options);await runMaintenance(db,ts("2026-10-09 12:10:00"),options);
      expect(drafts).toBe(0);expect(notifications).toBe(0);
    }finally{db.close();rmSync(dir,{recursive:true,force:true});}
  });
  it("同一天备份、月度草稿和通知各只执行一次，备份可读取", async () => {
    const dir=mkdtempSync(join(tmpdir(),"kaoqin-tasks-")),db=openDb(":memory:");
    let drafts=0;const messages:string[]=[];
    const options={backupDirectory:dir,makeDraft:async()=>{drafts++;},notify:async(message:string)=>{messages.push(message);}};
    try {
      await runMaintenance(db,ts("2026-10-09 12:00:00"),options);
      await runMaintenance(db,ts("2026-10-09 12:10:00"),options);
      expect(drafts).toBe(1);expect(messages).toHaveLength(1);expect(readdirSync(dir)).toHaveLength(1);
      const saved=new DatabaseSync(join(dir,readdirSync(dir)[0]),{readOnly:true});
      try {expect(saved.prepare("PRAGMA integrity_check").get()).toMatchObject({integrity_check:"ok"});}finally{saved.close();}
    } finally {db.close();rmSync(dir,{recursive:true,force:true});}
  });
  it("保留最近三十份备份，十二月提醒每年只发一次", async () => {
    const dir=mkdtempSync(join(tmpdir(),"kaoqin-tasks-")),db=openDb(":memory:");const messages:string[]=[];
    const options={backupDirectory:dir,makeDraft:async()=>{},notify:async(message:string)=>{messages.push(message);}};
    try {
      const first=ts("2026-11-20 12:00:00");
      for(let i=0;i<35;i++)await runMaintenance(db,first+i*86400,options);
      expect(readdirSync(dir)).toHaveLength(30);
      expect(messages.filter(m=>m.includes("节假日"))).toHaveLength(1);
    } finally {db.close();rmSync(dir,{recursive:true,force:true});}
  });
  it("草稿生成失败后下次重试，成功前不发送完成通知", async () => {
    const dir=mkdtempSync(join(tmpdir(),"kaoqin-tasks-")),db=openDb(":memory:");let attempt=0;const messages:string[]=[];
    try {
      const options={backupDirectory:dir,makeDraft:async()=>{if(++attempt===1)throw new Error("失败");},notify:async(message:string)=>{messages.push(message);}};
      await expect(runMaintenance(db,ts("2026-10-09 12:00:00"),options)).rejects.toThrow("失败");
      expect(messages).toHaveLength(0);
      await runMaintenance(db,ts("2026-10-09 12:10:00"),options);expect(attempt).toBe(2);expect(messages).toHaveLength(1);
    } finally {db.close();rmSync(dir,{recursive:true,force:true});}
  });
});
