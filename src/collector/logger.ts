// 简单的文件日志，超过上限时轮换成 .1（只保留一份旧日志）。
// 不用 launchd 的标准输出重定向来写日志：那样轮换时 launchd 会继续写进被改名的旧文件。
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { JST_OFFSET_SEC } from "../lib/time";

export type LogLevel = "info" | "warn" | "error";
export type Logger = (level: LogLevel, message: string) => void;

const MAX_BYTES = 5 * 1024 * 1024;

/** 东京时间 YYYY-MM-DD HH:MM:SS */
function stamp(): string {
  return new Date(Date.now() + JST_OFFSET_SEC * 1000).toISOString().slice(0, 19).replace("T", " ");
}

export function createLogger(file: string, alsoConsole = false): Logger {
  mkdirSync(dirname(file), { recursive: true });
  return (level, message) => {
    const line = `${stamp()} [${level}] ${message}\n`;
    if (alsoConsole) process.stdout.write(line);
    try {
      const size = statSync(/* turbopackIgnore: true */ file, { throwIfNoEntry: false })?.size ?? 0;
      if (size > MAX_BYTES) {
        renameSync(file, `${file}.1`);
      }
      appendFileSync(file, line);
    } catch {
      // 日志写不进去不能影响采集
    }
  };
}
