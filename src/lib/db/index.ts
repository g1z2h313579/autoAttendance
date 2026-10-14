// 数据库连接与迁移。
// 使用 Node 内置的 node:sqlite（同步 API），不需要编译原生模块。
// 数据库访问都集中在 src/lib/db 下，以后如果要换成 better-sqlite3，只改这里。
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "../paths";
import { migrations, type Migration } from "./migrations";

export type Db = DatabaseSync;

/** 打开数据库并执行迁移。采集程序和 Web 服务都会调用 */
export function openDb(file: string = dbPath()): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(/* turbopackIgnore: true */ file);
  // 采集程序和 Web 服务会同时读写同一个文件，用 WAL 模式并设置等锁时间
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
  migrate(db);
  return db;
}

/** 当前数据库版本 */
export function schemaVersion(db: Db): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

/**
 * 按版本号依次执行未执行过的迁移。
 * 两个进程可能同时启动，所以先用 BEGIN IMMEDIATE 拿到写锁，再在事务里重新检查版本。
 */
export function migrate(db: Db, list: Migration[] = migrations): void {
  const sorted = [...list].sort((a, b) => a.version - b.version);
  const latest = sorted.at(-1)?.version ?? 0;
  if (schemaVersion(db) >= latest) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    const current = schemaVersion(db);
    for (const m of sorted) {
      if (m.version <= current) continue;
      db.exec(m.sql);
      // PRAGMA 不支持参数绑定，版本号是代码里的整数，直接拼接是安全的
      db.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** 在事务里执行一段同步逻辑，出错时回滚 */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** 读取一个配置项（JSON），没有时返回 undefined */
export function getSetting<T>(db: Db, key: string): T | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

/** 写入一个配置项（JSON） */
export function setSetting(db: Db, key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}
