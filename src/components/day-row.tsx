"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "./action-form";
import { saveDayAction, dayOperationAction } from "@/app/actions";
import { CATEGORIES, CATEGORY_LABELS, type DayResult } from "@/lib/judge/types";
import { hhmmToMinutes, weekdayOf } from "@/lib/time";
import { dayDraft, hasDayDraftChanges, type DayDraft } from "@/lib/day-draft";
const sources = { samples: "历史采样", pmset: "电源事件", mixed: "历史 + 电源", none: "无记录", manual: "人工" };
export function DayRow({ day, locked, fields, exporting, mutating, onEdit, onSavingChange }: {
  day: DayResult; locked: boolean; fields: DayDraft; exporting: boolean; mutating: boolean;
  onEdit: (fields: DayDraft) => void; onSavingChange: (date: string, saving: boolean) => void;
}) {
  const [message, setMessage] = useState(""); const [pending, start] = useTransition(); const router = useRouter();
  useEffect(() => { onSavingChange(day.date, pending); }, [day.date, pending, onSavingChange]);
  const duration = fields.clock_in && fields.clock_out ? (hhmmToMinutes(fields.clock_out) - hhmmToMinutes(fields.clock_in) + 1440) % 1440 : null;
  const unavailable = locked || day.status === "future" || pending || exporting || mutating;
  const dirty = hasDayDraftChanges(dayDraft(day), fields);
  const formId = `day-${day.date}`;
  const edit = <K extends keyof DayDraft>(key: K, value: DayDraft[K]) => onEdit({ ...fields, [key]: value });
  return <tr className={`${day.is_rest_day ? "rest-day" : ""} ${day.status === "future" ? "future-day" : ""}`}>
    <td><Link className="day-link" href={`/day/${day.date}`}>{day.date.slice(5)}<small>周{"日一二三四五六"[weekdayOf(day.date)]}</small></Link></td>
    <td><select aria-label={`${day.date}类别`} name="category" form={formId} value={fields.category ?? ""} disabled={unavailable} onChange={event => edit("category", (event.currentTarget.value || null) as DayDraft["category"])}><option value="">{day.flags.includes("待补录") ? "待补录" : "待选择"}</option>{CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></td>
    <td><input aria-label={`${day.date}上班`} type="time" name="clock_in" form={formId} value={fields.clock_in ?? ""} disabled={unavailable} onInput={event => edit("clock_in", event.currentTarget.value || null)} onChange={event => edit("clock_in", event.currentTarget.value || null)}/></td>
    <td><input aria-label={`${day.date}下班`} type="time" name="clock_out" form={formId} value={fields.clock_out ?? ""} disabled={unavailable} onInput={event => edit("clock_out", event.currentTarget.value || null)} onChange={event => edit("clock_out", event.currentTarget.value || null)}/></td>
    <td className="numeric">{duration === null ? "—" : `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`}</td>
    <td className="numeric">{duration === null ? "—" : duration}</td>
    <td><span className={`source source-${day.source}`}>{sources[day.source]}</span></td>
    <td className="flags">{day.status !== "past" && <span className="badge neutral">{day.status === "ongoing" ? "进行中" : "未开始"}</span>}{day.flags.map(flag => <span className={`badge ${day.confirmed_at ? "neutral" : "warning"}`} key={flag}>{flag}</span>)}</td>
    <td><input aria-label={`${day.date}备注`} name="note" form={formId} value={fields.note} placeholder="添加备注" maxLength={1000} disabled={unavailable} onChange={event => edit("note", event.currentTarget.value)}/></td>
    <td className="row-actions"><form id={formId} onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      if (unavailable) return;
      onSavingChange(day.date, true);
      start(async () => {
        try { const result = await saveDayAction(data); setMessage(result.message); if (result.ok) router.refresh(); }
        catch { setMessage("连接失败，请重试"); }
      });
    }}><input type="hidden" name="date" value={day.date}/><input type="hidden" name="original_category" value={day.category ?? ""}/><input type="hidden" name="original_clock_in" value={day.clock_in ?? ""}/><input type="hidden" name="original_clock_out" value={day.clock_out ?? ""}/><button className="text-button" disabled={unavailable}>{pending ? "保存中" : "保存"}</button>{message && <small role="status">{message}</small>}</form>
      {dirty && <small className="error">未保存</small>}
      <ActionForm action={dayOperationAction}><input type="hidden" name="date" value={day.date}/><input type="hidden" name="operation" value="confirm"/><button className="text-button" disabled={unavailable || dirty || day.status !== "past" || !!day.confirmed_at}>{day.confirmed_at ? "已确认" : "确认"}</button></ActionForm>
      {day.manual && <ActionForm action={dayOperationAction}><input type="hidden" name="date" value={day.date}/><input type="hidden" name="operation" value="restore"/><button className="text-button" disabled={unavailable || dirty}>恢复自动</button></ActionForm>}
    </td></tr>;
}
