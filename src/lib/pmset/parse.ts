// 解析 `pmset -g log` 的输出。
// 每行格式：
//   2000-01-04 09:00:00 +0900 Notification        <TAB>Display is turned on   <TAB> ...
//   日期 时间 时区 域名（补空格到固定宽度）<TAB>消息<TAB>...
// 只提取补录需要的几类事件：亮屏、灭屏、睡眠、唤醒、DarkWake。
import { parseLocalDateTime } from "../time";

export type PowerEventKind = "display_on" | "display_off" | "sleep" | "wake" | "dark_wake";

export interface PowerEvent {
  ts: number;
  kind: PowerEventKind;
  /** 睡眠：clamshell / idle / software / maintenance / service / notification …；唤醒：user / notification / other */
  reason: string | null;
  raw: string;
}

const LINE_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([+-]\d{4}) ([^\t]*?)\s*\t([^\t]*)/;

/** 睡眠原因的规范化名称 */
const SLEEP_REASONS: Record<string, string> = {
  "Clamshell Sleep": "clamshell",
  "Idle Sleep": "idle",
  "Software Sleep": "software",
  "Maintenance Sleep": "maintenance",
  "Sleep Service Back to Sleep": "service",
  "Notification Wake Back to Sleep": "notification",
};

function sleepReason(msg: string): string | null {
  const m = /due to '([^']+)'/.exec(msg);
  if (!m) return null;
  return SLEEP_REASONS[m[1]] ?? m[1];
}

function wakeReason(msg: string): string {
  if (/UserActivity/.test(msg)) return "user";
  if (/due to Notification/.test(msg)) return "notification";
  return "other";
}

/** 解析一行，不是需要的事件时返回 null */
export function parsePmsetLine(line: string): PowerEvent | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const [, dateTime, tz, domain, msgRaw] = m;
  const msg = msgRaw.trim();
  const raw = line.trimEnd();
  const base = () => ({ ts: parseLocalDateTime(dateTime, tz), raw });

  switch (domain) {
    case "Notification":
      if (msg === "Display is turned on") return { ...base(), kind: "display_on", reason: null };
      if (msg === "Display is turned off") return { ...base(), kind: "display_off", reason: null };
      return null;
    case "Sleep":
      // "Entering Sleep state" 和 "Entering DarkWake state"（从完全唤醒退回后台唤醒）对使用者来说都是睡眠
      return { ...base(), kind: "sleep", reason: sleepReason(msg) };
    case "Wake":
      return { ...base(), kind: "wake", reason: wakeReason(msg) };
    case "DarkWake":
      return { ...base(), kind: "dark_wake", reason: null };
    default:
      return null;
  }
}

/** 解析整段日志。sinceTs 之前的事件跳过（用于增量导入） */
export function parsePmsetLog(text: string, sinceTs = 0): PowerEvent[] {
  const events: PowerEvent[] = [];
  for (const line of text.split("\n")) {
    const ev = parsePmsetLine(line);
    if (ev && ev.ts >= sinceTs) events.push(ev);
  }
  return events;
}

/** 从 `pmset -g` 的输出中读取熄屏等待时间（分钟），读不到时返回 null */
export function parseDisplaySleepMin(text: string): number | null {
  const m = /^\s*displaysleep\s+(\d+)/m.exec(text);
  return m ? Number(m[1]) : null;
}
