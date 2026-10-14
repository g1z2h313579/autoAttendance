import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { withDbAsync } from "@/lib/db/server";
import { collectorHealth } from "@/lib/db/attendance";
import { computeMonth } from "@/lib/judge/month";
import { CATEGORY_LABELS } from "@/lib/judge/types";
import { parseYm, jstDate, jstHHMM } from "@/lib/time";
import { MonthRecords } from "@/components/month-records";
import { readFileSync } from "node:fs";
import { currentTemplate } from "@/lib/export/templates";
import { readTemplateWorkRules } from "@/lib/export/xlsx";
import type { TemplateWorkRules } from "@/lib/mail-summary";
import { readMailProfile } from "@/lib/mail-profile";
import { ActionForm } from "@/components/action-form";
import { monthOperationAction } from "@/app/actions";
async function Month({ params }: { params: Promise<{ ym: string }> }) {
  await connection(); const { ym } = await params;
  const profile = readMailProfile();
  let year: number, month: number;
  try { [year, month] = parseYm(ym); } catch { notFound(); }
  const { days, health, locked, rules } = await withDbAsync(async db => {
    let rules: TemplateWorkRules | null = null;
    try {
      const template = await currentTemplate(db);
      rules = await readTemplateWorkRules(readFileSync(/*turbopackIgnore: true*/ template.stored_path));
    } catch { /* 邮件区提示模板规则不可用，月度记录仍可查看和编辑。 */ }
    return { days: computeMonth(db, ym), health: collectorHealth(db), locked: !!db.prepare("SELECT locked_at FROM months WHERE ym=?").get(ym)?.locked_at, rules };
  });
  const move = (delta: number) => { const d = new Date(Date.UTC(year, month - 1 + delta, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const counts = Object.entries(CATEGORY_LABELS).map(([category, label]) => ({ label, count: days.filter(d => d.category === category).length }));
  const pending = days.filter(d => d.status === "past" && !d.confirmed_at).length;
  const marked = days.filter(d => d.status !== "future" && d.flags.length && !d.confirmed_at).length;
  return <><div className="page-heading"><div><p className="eyebrow">每一天都有依据</p><h1>{year} 年 {month} 月 <span>考勤记录</span></h1></div><div className="month-nav"><Link className="button secondary" href={`/month/${move(-1)}`} aria-label="上个月">←</Link><form action="/month" method="get"><label className="sr-only" htmlFor="month-picker">选择月份</label><input id="month-picker" type="month" name="ym" defaultValue={ym}/><button className="button secondary">前往</button></form><Link className="button secondary" href={`/month/${move(1)}`} aria-label="下个月">→</Link></div></div>
    <section className="stats-grid" aria-label="月度统计">{counts.filter(c => c.count > 0 || ["到岗", "居家", "带薪休假"].includes(c.label)).map(c => <div className="stat-card" key={c.label}><span>{c.label}</span><strong>{c.count}<small>天</small></strong></div>)}<div className="stat-card attention"><span>待确认</span><strong>{pending}<small>天</small></strong></div></section>
    <div className={`health-strip ${health.healthy ? "healthy" : "unhealthy"}`}><span className="status-dot"/><strong>{health.healthy ? "电源事件监听正常" : "电源事件监听未运行"}</strong><span>{health.last_sample ? `最近事件：${jstDate(health.last_sample)} ${jstHHMM(health.last_sample)}` : "尚无电源事件"}</span>{!health.healthy && <span>请检查后台事件监听服务。</span>}</div>
    <p className="attendance-rule">首次开盖／唤醒记上班，末次合盖／睡眠暂记下班；中间睡眠、锁屏和空闲连续计入区间。正在使用时统计到当前时间，下班请核对。</p>
    <MonthRecords key={ym} ym={ym} days={days} locked={locked} rules={rules} profile={profile}><div className="panel-toolbar"><div><h2>每日记录 {locked && <span className="badge neutral">已锁定</span>}</h2><p>{marked ? `${marked} 天有待处理标记，点日期可查看依据。` : "点日期查看详情，在表格中修改后点击保存。"}</p></div><div className="toolbar-actions"><ActionForm action={monthOperationAction}><input type="hidden" name="ym" value={ym}/><input type="hidden" name="operation" value="confirm"/><button className="button secondary" disabled={locked}>确认无标记日期</button></ActionForm><ActionForm action={monthOperationAction}><input type="hidden" name="ym" value={ym}/><input type="hidden" name="operation" value={locked ? "unlock" : "lock"}/><button className="button secondary">{locked ? "解锁月份" : "锁定月份"}</button></ActionForm></div></div></MonthRecords></>;
}
export default function MonthPage(props: { params: Promise<{ ym: string }> }) { return <Suspense fallback={<p className="loading">正在计算月度记录…</p>}><Month {...props}/></Suspense>; }
