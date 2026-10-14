"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DayResult } from "@/lib/judge/types";
import { buildMailSummary, type MailProfile, type TemplateWorkRules } from "@/lib/mail-summary";
import { DayRow } from "./day-row";
import { startPageRefresh } from "@/lib/page-refresh";
import { dayDraft, hasDayDraftChanges, mergeDayDraft, monthRevision, type DayDraft } from "@/lib/day-draft";
import { ExportPanel } from "./export-panel";
import { FormPendingContext } from "./action-form";

export function MonthRecords({ ym, days, locked, rules, profile, children }: {
  ym: string; days: DayResult[]; locked: boolean; rules: TemplateWorkRules | null; profile: MailProfile; children: ReactNode;
}) {
  const [draft, setDraft] = useState(() => ({ base: days, fields: Object.fromEntries(days.map(day => [day.date, dayDraft(day)])) }));
  // 与每行共用一份草稿；刷新按字段合并，保留响应发出后才输入的内容。
  if (draft.base !== days) setDraft({ base: days, fields: Object.fromEntries(days.map(day => {
    const before = draft.base.find(row => row.date === day.date);
    return [day.date, before && draft.fields[day.date] ? mergeDayDraft(dayDraft(before), dayDraft(day), draft.fields[day.date]) : dayDraft(day)];
  })) });
  const [savingDates, setSavingDates] = useState<Set<string>>(() => new Set());
  const [pendingForms, setPendingForms] = useState<Set<string>>(() => new Set());
  const formPendingChange = useCallback((id: string, pending: boolean) => {
    setPendingForms(previous => {
      if (previous.has(id) === pending) return previous;
      const next = new Set(previous); if (pending) next.add(id); else next.delete(id); return next;
    });
  }, []);
  const [exporting, setExporting] = useState(false);
  const [copiedText, setCopiedText] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const dirtyDates = days.filter(day => hasDayDraftChanges(dayDraft(day), draft.fields[day.date]));
  const blocked = dirtyDates.length > 0 || savingDates.size > 0 || pendingForms.size > 0;
  const blockMessage = pendingForms.size > 0 ? "正在更新考勤记录，请等待操作完成后再复制邮件或导出 Excel。"
    : savingDates.size > 0 ? "正在保存修改，请等待保存完成后再复制邮件或导出 Excel。"
    : dirtyDates.length > 0 ? `有 ${dirtyDates.length} 天的修改未保存，请先点击对应日期的“保存”，再复制邮件或导出 Excel。` : "";
  const revision = monthRevision(days);
  useEffect(() => {
    if (locked) return;
    const canRefresh = () => !document.hidden && !blocked && !exporting;
    return startPageRefresh({ document, window, canRefresh, refresh: () => router.refresh() });
  }, [blocked, exporting, locked, router]);
  const summary = buildMailSummary(days.map(day => ({ ...day, ...draft.fields[day.date] })), rules, profile);
  function edit(date: string, fields: DayDraft) {
    setDraft(previous => ({ ...previous, fields: { ...previous.fields, [date]: fields } }));
    setCopiedText(""); setCopyFailed(false);
  }
  const saving = useCallback((date: string, pending: boolean) => {
    setSavingDates(previous => {
      if (previous.has(date) === pending) return previous;
      const next = new Set(previous); if (pending) next.add(date); else next.delete(date); return next;
    });
  }, []);
  async function copy() {
    if (blocked || exporting || summary.totalMinutes === null) return;
    try { await navigator.clipboard.writeText(summary.text); setCopiedText(summary.text); setCopyFailed(false); }
    catch { body.current?.focus(); body.current?.select(); setCopyFailed(true); }
  }
  return <FormPendingContext.Provider value={formPendingChange}>
    <section className="records-panel">
    <fieldset disabled={blocked || exporting}>{children}</fieldset>
    {blockMessage && <p className="draft-warning" role="status">{blockMessage}</p>}
    <div className="table-scroll"><table className="attendance-table"><thead><tr>{["日期", "类别", "上班", "下班", "在岗", "区间 / 分钟", "来源", "标记", "备注", "操作"].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{days.map(day => <DayRow key={day.date} day={day} locked={locked} fields={draft.fields[day.date]} exporting={exporting} mutating={pendingForms.size > 0} onEdit={fields => edit(day.date, fields)} onSavingChange={saving}/>)}</tbody></table></div>
    <section className="mail-summary" aria-label="邮件摘要">
      <div className="mail-summary-header"><div><h2>邮件摘要</h2><p>随表格实时预览；复制邮件和导出 Excel 前须保存全部修改。交通费按本机配置每月填写 {profile.transportYen} 円。</p></div><button className="button secondary" type="button" onClick={copy} disabled={blocked || exporting || summary.totalMinutes === null}>复制邮件内容</button></div>
      {blockMessage && <p className="mail-summary-issues">{blockMessage}</p>}
      <textarea ref={body} aria-label="邮件正文" readOnly value={summary.text} rows={8} spellCheck={false}/>
      <p className="mail-summary-note">工作日包含到岗、居家和休日出勤；休假包含带薪休假和补休。工时按当前 Excel 模板扣除休息时间。</p>
      {summary.issues.length > 0 && <div className="mail-summary-issues"><p>以下记录需要核对：</p><ul>{summary.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
      <p role="status" className="form-message">{blocked ? "" : copyFailed ? "已选中文本，请按 ⌘C 或 Ctrl+C 复制。" : copiedText === summary.text ? "邮件内容已复制。" : ""}</p>
    </section>
    </section>
    <ExportPanel ym={ym} locked={locked} blocked={blocked} blockMessage={blockMessage} revision={revision} onBusyChange={setExporting}/>
  </FormPendingContext.Provider>;
}
