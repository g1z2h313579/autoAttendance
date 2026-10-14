import type { DayResult } from "./judge/types";
export type DayDraft = Pick<DayResult, "category" | "clock_in" | "clock_out"> & { note: string };
export function dayDraft(day: Pick<DayResult, "category" | "clock_in" | "clock_out" | "note">): DayDraft {
  return { category: day.category, clock_in: day.clock_in, clock_out: day.clock_out, note: day.note ?? "" };
}
export function mergeDayDraft(before: DayDraft, incoming: DayDraft, draft: DayDraft): DayDraft {
  return {
    category: draft.category !== before.category ? draft.category : incoming.category,
    clock_in: draft.clock_in !== before.clock_in ? draft.clock_in : incoming.clock_in,
    clock_out: draft.clock_out !== before.clock_out ? draft.clock_out : incoming.clock_out,
    note: draft.note !== before.note ? draft.note : incoming.note,
  };
}
