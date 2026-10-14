import type { Settings } from "../settings";
import type { PowerEvent } from "../pmset/parse";

export const CATEGORIES = ["出勤", "在宅", "有給休暇", "欠勤", "代休", "休日出勤"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  出勤: "到岗", 在宅: "居家", 有給休暇: "带薪休假", 欠勤: "缺勤", 代休: "调休", 休日出勤: "休息日上班",
};
export interface Sample {
  ts: number; idle_sec: number | null; locked: number | null; display_hold: string | null;
  gateway_mac: string | null;
}
export interface Network {
  gateway_mac: string; label: string | null; is_office: number;
  last_ip?: string | null; first_seen?: number; last_seen?: number;
}
export interface Session { start: number; end: number; source: "samples" | "pmset" | "mixed" }
export interface JudgeInput {
  date: string; samples: Sample[]; events: PowerEvent[]; networks: Network[]; settings: Settings; now: number;
}
export interface DayResult {
  date: string; category: Category | null; clock_in: string | null; clock_out: string | null;
  active_min: number; office_min: number; source: "samples" | "pmset" | "mixed" | "none" | "manual";
  flags: string[]; status: "past" | "ongoing" | "future"; is_rest_day: boolean; sessions: Session[];
  note?: string | null; confirmed_at?: number | null; manual?: boolean;
}
