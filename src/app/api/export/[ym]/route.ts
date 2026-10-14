import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { connection } from "next/server";
import { withDb, withDbAsync } from "@/lib/db/server";
import { exportMonth, ExportBlocked } from "@/lib/export/month";
import { parseYm } from "@/lib/time";
import { exportsDir } from "@/lib/paths";
import { sameOrigin } from "@/lib/http";
export async function POST(request: Request, context: { params: Promise<{ ym: string }> }) {
  if(!sameOrigin(request))return Response.json({error:"请求来源无效"},{status:403});
  try {
    const {ym}=await context.params;parseYm(ym);
    const body=await request.json();
    const result=await withDbAsync(db=>exportMonth(db,ym,{force:body.force===true,lock:body.lock===true}));
    return Response.json({url:`/api/export/${ym}`,name:result.name,warnings:[]});
  } catch(error) {
    if(error instanceof ExportBlocked)return Response.json({error:error.message,warnings:error.errors.length ? [] : error.warnings},{status:409});
    return Response.json({error:error instanceof Error ? error.message : "生成失败"},{status:400});
  }
}
export async function GET(_request: Request, context: { params: Promise<{ ym: string }> }) {
  await connection();
  try {
    const {ym}=await context.params;parseYm(ym);
    const path=withDb(db=>db.prepare("SELECT export_file FROM months WHERE ym=?").get(ym)?.export_file);
    if(typeof path!=="string" || !resolve(path).startsWith(`${resolve(exportsDir())}/`))return Response.json({error:"请先生成考勤表"},{status:404});
    return new Response(readFileSync(/*turbopackIgnore: true*/ path),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="attendance-${ym}.xlsx"; filename*=UTF-8''${encodeURIComponent(basename(path))}`,"Cache-Control":"no-store"}});
  } catch { return Response.json({error:"文件暂时无法下载，请重新生成"},{status:404}); }
}
