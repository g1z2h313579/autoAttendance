// 按官方文档在明确的运行时分支中导入 Node 专用代码。
export async function register() {
  if(process.env.NEXT_RUNTIME === "nodejs") {
    const { startTasks }=await import("./instrumentation-node");
    await startTasks();
  }
}
