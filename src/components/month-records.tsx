"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DayResult } from "@/lib/judge/types";
import { buildMailSummary, type MailProfile, type SummaryDay, type TemplateWorkRules } from "@/lib/mail-summary";
import { DayRow } from "./day-row";
import { startPageRefresh } from "@/lib/page-refresh";
const rowVersion = (day: DayResult) => JSON.stringify([day.category, day.clock_in, day.clock_out, day.status, day.note, day.confirmed_at, day.manual]);

export function MonthRecords({ days, locked, rules, profile }: { days: DayResult[]; locked: boolean; rules: TemplateWorkRules | null; profile: MailProfile }) {
  const [preview, setPreview] = useState<Record<string, { base: string; day: SummaryDay }>>({});
  const [copiedText, setCopiedText] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (locked) return;
    const canRefresh = () => {
      if (document.hidden || !table.current) return false;
      // 打开页面时只刷新派生结果，不新增采样；有编辑草稿时暂停，避免输入被覆盖。
      const dirty = days.some(day => {
        const form = table.current?.querySelector<HTMLFormElement>(`#day-${day.date}`);
        if (!form) return false;
        const data = new FormData(form);
        return (["category", "clock_in", "clock_out", "note"] as const).some(key => String(data.get(key) ?? "") !== (day[key] ?? ""));
      });
      return !dirty;
    };
    return startPageRefresh({ document, window, canRefresh, refresh: () => router.refresh() });
  }, [days, locked, router]);
  const summary = buildMailSummary(days.map(day => preview[day.date]?.base === rowVersion(day) ? preview[day.date].day : day), rules, profile);
  const updatePreview = useCallback((day: SummaryDay) => {
    const original = days.find(row => row.date === day.date);
    if (original) setPreview(previous => ({ ...previous, [day.date]: { base: rowVersion(original), day } }));
  }, [days]);
  async function copy() {
    try { await navigator.clipboard.writeText(summary.text); setCopiedText(summary.text); setCopyFailed(false); }
    catch { body.current?.focus(); body.current?.select(); setCopyFailed(true); }
  }
  return <>
    <div className="table-scroll" ref={table}><table className="attendance-table"><thead><tr>{["日期", "类别", "上班", "下班", "在岗", "区间 / 分钟", "来源", "标记", "备注", "操作"].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{days.map(day => <DayRow key={day.date} day={day} locked={locked} onPreviewChange={updatePreview}/>)}</tbody></table></div>
    <section className="mail-summary" aria-label="邮件摘要">
      <div className="mail-summary-header"><div><h2>邮件摘要</h2><p>随表格中的类别和时间实时更新；导出考勤表前请保存修改。交通费按本机配置每月填写 {profile.transportYen} 円。</p></div><button className="button secondary" type="button" onClick={copy} disabled={summary.totalMinutes === null}>复制邮件内容</button></div>
      <textarea ref={body} aria-label="邮件正文" readOnly value={summary.text} rows={8} spellCheck={false}/>
      <p className="mail-summary-note">工作日包含到岗、居家和休日出勤；休假包含带薪休假和补休。工时按当前 Excel 模板扣除休息时间。</p>
      {summary.issues.length > 0 && <div className="mail-summary-issues"><p>以下记录需要核对：</p><ul>{summary.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
      <p role="status" className="form-message">{copyFailed ? "已选中文本，请按 ⌘C 或 Ctrl+C 复制。" : copiedText === summary.text ? "邮件内容已复制。" : ""}</p>
    </section>
  </>;
}
