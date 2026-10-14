// 数据库迁移。写成 TS 字符串而不是 .sql 文件，
// 这样采集程序打包成单文件时不需要额外复制迁移文件。
// 规则：只能追加新版本，已发布的版本不要修改。

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "初始表结构",
    sql: `
-- 采样：采集程序每 60 秒写入一条，只追加
CREATE TABLE samples (
  ts           INTEGER PRIMARY KEY,  -- Unix 秒
  idle_sec     INTEGER,              -- 空闲秒数，读不到为 NULL
  locked       INTEGER,              -- 1 锁屏，0 未锁，NULL 未知
  display_hold TEXT,                 -- 阻止熄屏的进程名，逗号分隔；空串表示没有
  gateway_mac  TEXT,                 -- 小写、每段补足两位
  gateway_ip   TEXT,
  iface        TEXT
);

-- 电源日志事件，按 (时间, 类型) 去重
CREATE TABLE power_events (
  ts     INTEGER NOT NULL,
  kind   TEXT    NOT NULL,           -- display_on / display_off / sleep / wake / dark_wake
  reason TEXT,                       -- 例如 clamshell、idle
  raw    TEXT,                       -- 原始行，便于排查
  PRIMARY KEY (ts, kind)
);

-- 见过的网络（按默认网关 MAC 区分）
CREATE TABLE networks (
  gateway_mac TEXT PRIMARY KEY,
  label       TEXT,
  is_office   INTEGER NOT NULL DEFAULT 0,
  last_ip     TEXT,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

-- 每天的自动判定结果（可随时重算的缓存）
CREATE TABLE day_auto (
  date        TEXT PRIMARY KEY,      -- 业务日 YYYY-MM-DD
  category    TEXT,                  -- 考勤类别固定值之一，或 NULL
  clock_in    TEXT,                  -- HH:MM
  clock_out   TEXT,
  active_min  INTEGER NOT NULL DEFAULT 0,
  office_min  INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL,         -- samples / pmset / mixed / none
  flags       TEXT NOT NULL DEFAULT '[]',
  computed_at INTEGER NOT NULL
);

-- 人工修改：有记录时，类别、上班、下班三项都以这里为准
CREATE TABLE day_manual (
  date       TEXT PRIMARY KEY,
  category   TEXT,
  clock_in   TEXT,
  clock_out  TEXT,
  updated_at INTEGER NOT NULL
);

-- 备注与确认状态
CREATE TABLE day_meta (
  date         TEXT PRIMARY KEY,
  note         TEXT,
  confirmed_at INTEGER
);

-- 修改历史
CREATE TABLE edit_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT NOT NULL,
  field     TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  at        INTEGER NOT NULL
);
CREATE INDEX edit_logs_date ON edit_logs (date);

-- 月份锁定与导出记录
CREATE TABLE months (
  ym          TEXT PRIMARY KEY,      -- YYYY-MM
  locked_at   INTEGER,
  exported_at INTEGER,
  export_file TEXT
);

-- 模板
CREATE TABLE templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name   TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  sheet_name  TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 0
);

-- 配置：只存用户改过的项，值为 JSON；没有的项用代码里的默认值
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 新安装不预置公司网络，由使用者在设置页标记。
`,
  },
];
