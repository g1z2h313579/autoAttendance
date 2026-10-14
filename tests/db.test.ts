import { describe, expect, it } from "vitest";
import { getSetting, migrate, openDb, schemaVersion, setSetting } from "@/lib/db";
import { migrations } from "@/lib/db/migrations";

describe("数据库与迁移", () => {
  it("空库迁移到最新版本，重复执行不报错", () => {
    const db = openDb(":memory:");
    const latest = migrations.at(-1)!.version;
    expect(schemaVersion(db)).toBe(latest);
    expect(() => migrate(db)).not.toThrow();
    expect(schemaVersion(db)).toBe(latest);
  });

  it("新安装没有预置其他使用者的公司网络", () => {
    const db = openDb(":memory:");
    expect(db.prepare("SELECT * FROM networks").all()).toEqual([]);
  });

  it("迁移出错时整体回滚", () => {
    const db = openDb(":memory:");
    const before = schemaVersion(db);
    const broken = [...migrations, { version: before + 1, name: "坏的", sql: "CREATE TABLE x (; " }];
    expect(() => migrate(db, broken)).toThrow();
    expect(schemaVersion(db)).toBe(before);
  });

  it("配置读写（JSON）", () => {
    const db = openDb(":memory:");
    expect(getSetting(db, "displaySleepMin")).toBeUndefined();
    setSetting(db, "displaySleepMin", 10);
    setSetting(db, "displaySleepMin", 15);
    expect(getSetting<number>(db, "displaySleepMin")).toBe(15);
  });
});
