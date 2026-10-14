import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { PowerEvent } from "../lib/pmset/parse";

export function parsePowerMessage(text: string): PowerEvent | { kind: "ready" } | null {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return null;
    if (data.kind === "ready") return { kind: "ready" };
    if (!["wake", "sleep", "display_on", "display_off"].includes(data.kind) || !Number.isSafeInteger(data.ts) || data.ts <= 0) return null;
    return { ts: data.ts, kind: data.kind, reason: typeof data.reason === "string" ? data.reason : null, raw: `NSWorkspace ${text}` };
  } catch { return null; }
}

/** 原生通知替代轮询。监听子进程失效时由调用者退出，让 launchd 恢复。 */
export function listenPowerEvents(path: string, callbacks: {
  ready: (pid: number) => void;
  event: (event: PowerEvent) => void;
  failure: (message: string) => void;
}) {
  const child = spawn(path, [], { stdio: ["ignore", "pipe", "pipe"] });
  let stopped = false, ready = false;
  const lines = createInterface({ input: child.stdout });
  const timeout = setTimeout(() => callbacks.failure("电源事件监听器启动超时"), 15_000);
  lines.on("line", line => {
    const message = parsePowerMessage(line);
    if (!message) return;
    if (message.kind === "ready") {
      if (!ready && child.pid) { ready = true; clearTimeout(timeout); callbacks.ready(child.pid); }
    } else callbacks.event(message);
  });
  child.stderr.on("data", data => process.stderr.write(data));
  child.on("error", error => { clearTimeout(timeout); if (!stopped) callbacks.failure(String(error)); });
  child.on("exit", (code, signal) => { clearTimeout(timeout); if (!stopped) callbacks.failure(`电源事件监听器退出：${code ?? signal}`); });
  return { stop: () => { stopped = true; clearTimeout(timeout); lines.close(); child.kill("SIGTERM"); } };
}
