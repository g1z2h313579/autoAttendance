import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { templatesDir } from "../paths";
import { nowSec } from "../time";
import { transaction, type Db } from "../db";
import { inspectTemplate } from "./xlsx";
export interface Template { id: number; file_name: string; stored_path: string; sheet_name: string }
export async function installTemplate(db: Db, buffer: Buffer, fileName: string): Promise<Template> {
  const meta = await inspectTemplate(buffer);
  const name=basename(fileName);
  if (!name.toLowerCase().endsWith(".xlsx")) throw new Error("模板须为 xlsx 文件");
  mkdirSync(templatesDir(),{recursive:true});
  const path=join(templatesDir(),`${randomUUID()}.xlsx`),temp=`${path}.tmp`;
  writeFileSync(temp,buffer);renameSync(temp,path);
  return transaction(db,()=>{
    db.prepare("UPDATE templates SET active=0").run();
    const result=db.prepare("INSERT INTO templates (file_name,stored_path,sheet_name,uploaded_at,active) VALUES (?,?,?,?,1)").run(name,path,meta.sheetName,nowSec());
    return { id:Number(result.lastInsertRowid),file_name:name,stored_path:path,sheet_name:meta.sheetName };
  });
}
export async function currentTemplate(db: Db): Promise<Template> {
  const active=db.prepare("SELECT * FROM templates WHERE active=1 ORDER BY id DESC LIMIT 1").get() as unknown as Template | undefined;
  if(active)return active;
  // 部署脚本把默认模板复制到数据目录，开发时从项目资产读取。
  const buffer=process.env.KAOQIN_DEFAULT_TEMPLATE ? readFileSync(/*turbopackIgnore: true*/ process.env.KAOQIN_DEFAULT_TEMPLATE) : readFileSync(join(process.cwd(),"src/assets/default-template.xlsx"));
  return installTemplate(db,buffer,"default-template.xlsx");
}
