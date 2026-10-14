import "server-only";
import { openDb, type Db } from "./index";
export function withDb<T>(fn: (db: Db) => T): T {
  const db = openDb(); try { return fn(db); } finally { db.close(); }
}
export async function withDbAsync<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = openDb(); try { return await fn(db); } finally { db.close(); }
}
