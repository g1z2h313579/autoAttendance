import type { PowerEvent } from "../pmset/parse";
import type { Settings } from "../settings";
import type { Sample, Session } from "./types";

/** 找出没有采样覆盖的区间，区间结束不超过当前时刻。 */
export function collectionGaps(samples: Sample[], start: number, end: number, gapSec: number): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = [];
  let previous: number | null = null;
  const relevant = [...samples].filter(s => s.ts < end && s.ts >= start - gapSec).sort((a, b) => a.ts - b.ts);
  for (const s of relevant) {
    if (s.ts > start && (previous === null || s.ts - previous > gapSec)) gaps.push({ start: Math.max(start, previous ?? start), end: s.ts });
    previous = s.ts;
  }
  if (previous === null || end - previous > gapSec) gaps.push({ start: Math.max(start, previous ?? start), end });
  return gaps;
}

export function backfillSessions(samples: Sample[], events: PowerEvent[], start: number, end: number, settings: Settings): Session[] {
  const gaps = collectionGaps(samples, start, end, settings.backfillGapSec);
  const ordered = [...events].sort((a, b) => a.ts - b.ts);
  const display: { start: number; end: number }[] = [];
  let on: number | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    if (e.ts >= end && e.kind !== "display_off") break;
    if (e.kind === "display_on") {
      if (on === null) on = e.ts;
    } else if ((e.kind === "display_off" || (e.kind === "sleep" && e.reason === "clamshell")) && on !== null) {
      const clamshell = e.kind === "sleep" || ordered.slice(i + 1, i + 6).some(next => next.ts - e.ts <= 10 && next.kind === "sleep" && next.reason === "clamshell");
      if (e.ts - on >= settings.backfillMinDisplayMin * 60) {
        display.push({ start: on, end: Math.max(on, clamshell ? e.ts : e.ts - settings.displaySleepMin * 60) });
      }
      on = null;
    }
  }
  // 尚未灭屏的区间只到“现在”，不会把未来时间当作工作。
  if (on !== null && end - on >= settings.backfillMinDisplayMin * 60) display.push({ start: on, end });
  const sessions: Session[] = [];
  for (const d of display) for (const gap of gaps) {
    const left = Math.max(start, d.start, gap.start);
    const right = Math.min(end, d.end, gap.end);
    if (right > left) sessions.push({ start: left, end: right, source: "pmset" });
  }
  return sessions;
}
