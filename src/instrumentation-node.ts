// Node 专用任务入口，Edge 构建不会导入此文件。
export async function startTasks() {
  if(process.env.KAOQIN_ENABLE_TASKS !== "1")return;
  const { openDb }=await import("./lib/db");
  const { runMaintenance }=await import("./lib/tasks");
  const { createLogger }=await import("./collector/logger");
  const { logsDir }=await import("./lib/paths");
  const { join }=await import("node:path");
  const log=createLogger(join(logsDir(),"web.log"),false);
  let running=false;
  async function tick(){
    if(running)return;running=true;const db=openDb();
    try{await runMaintenance(db);}
    catch(error){log("error",`定时任务失败：${String(error)}`);}
    finally{db.close();running=false;}
  }
  // 服务启动不等待模板处理和系统通知。
  const first=setTimeout(()=>void tick(),5000);first.unref();
  const timer=setInterval(()=>void tick(),10*60*1000);timer.unref();
  log("info","Web 定时任务已启动，每十分钟检查一次");
}
