// 运行时路径集中管理。
// 程序和数据都放在 ~/Library/Application Support/kaoqin，不放桌面：
// 桌面目录受 macOS 隐私保护（TCC），launchd 启动的后台进程访问会被拒绝。
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** 数据目录。开发时用环境变量 KAOQIN_DATA_DIR 指向 ./data/dev，避免弄坏正式数据 */
export function dataDir(): string {
  const fromEnv = process.env.KAOQIN_DATA_DIR;
  if (fromEnv) return resolve(fromEnv);
  return join(homedir(), "Library", "Application Support", "kaoqin");
}

export const dbPath = () => join(dataDir(), "kaoqin.db");
export const templatesDir = () => join(dataDir(), "templates");
export const exportsDir = () => join(dataDir(), "exports");
export const backupsDir = () => join(dataDir(), "backups");

/** 日志目录。开发时放在数据目录下，正式环境放在 ~/Library/Logs/kaoqin */
export function logsDir(): string {
  if (process.env.KAOQIN_DATA_DIR) return join(dataDir(), "logs");
  return join(homedir(), "Library", "Logs", "kaoqin");
}
