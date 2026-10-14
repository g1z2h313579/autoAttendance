// 默认检查开发环境；正式服务的定时任务由 instrumentation 自动执行。
import { openDb } from "../src/lib/db";
import { runMaintenance } from "../src/lib/tasks";
if(!process.env.KAOQIN_DATA_DIR)process.env.KAOQIN_DATA_DIR="./data/dev";
const db=openDb();
try {await runMaintenance(db,undefined,{notify:async(message)=>{console.log(`通知：${message}`);}});console.log("定时任务检查完成");}
finally {db.close();}
