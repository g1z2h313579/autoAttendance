// 使用 SQLite 在线备份，不直接复制 WAL 数据库。
import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const source = join(homedir(), "Library", "Application Support", "kaoqin", "kaoqin.db");
const target = resolve("data/dev/kaoqin.db");
mkdirSync(resolve("data/dev"), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, target); console.log(`正式数据库已备份至开发库：${target}`); }
finally { db.close(); }
