import type { Settings } from "../settings";
import type { Sample, Session } from "./types";

/** 未知锁屏状态不推测会议仍在进行；真实操作时刻始终保留。 */
export function meetingActive(sample: Sample, settings: Settings): boolean {
  return sample.locked === 0 && (sample.display_hold ?? "").split(",").some(name => settings.meetingApps.includes(name.trim()));
}

export function sampleSessions(samples: Sample[], start: number, end: number, settings: Settings): Session[] {
  const points = new Set<number>();
  for (const s of samples) {
    // 实测睡眠会暂停 HID 空闲计时；锁屏后台唤醒的 ts-idle 并非真实操作时刻。
    if (s.locked !== 1 && s.idle_sec !== null && s.idle_sec >= 0) {
      const last = s.ts - s.idle_sec;
      if (last >= start && last < end) points.add(last);
    }
    if (s.ts >= start && s.ts < end && meetingActive(s, settings)) points.add(s.ts);
  }
  const sessions: Session[] = [];
  for (const point of [...points].sort((a, b) => a - b)) {
    const last = sessions.at(-1);
    if (last && point - last.end <= settings.sessionGapMin * 60) last.end = point;
    else sessions.push({ start: point, end: point, source: "samples" });
  }
  return sessions;
}

/** 取区间并集，采集与补录重叠时不重复累计；只合并相接或重叠的区间。 */
export function unionSessions(input: Session[]): Session[] {
  const result: Session[] = [];
  for (const s of [...input].sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      if (last.source !== s.source) last.source = "mixed";
    } else result.push({ ...s });
  }
  return result;
}
