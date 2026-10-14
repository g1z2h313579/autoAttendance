import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { withDb } from "@/lib/db/server";
import { dayInput, computeMonth } from "@/lib/judge/month";
import { judgeDay } from "@/lib/judge/day";
import { CATEGORY_LABELS } from "@/lib/judge/types";
import { businessDayWindow, jstDate, jstHHMM, parseDate } from "@/lib/time";
async function Day({ params }: { params: Promise<{ date: string }> }) {
  await connection(); const { date } = await params;
  try { parseDate(date); } catch { notFound(); }
  const { input, day, history, locked } = withDb(db => ({ input: dayInput(db, date), day: computeMonth(db, date.slice(0, 7)).find(d => d.date === date)!, history: db.prepare("SELECT * FROM edit_logs WHERE date=? ORDER BY at DESC, id DESC").all(date), locked: !!db.prepare("SELECT locked_at FROM months WHERE ym=?").get(date.slice(0, 7))?.locked_at }));
  const auto = judgeDay(input); const { start, end } = businessDayWindow(date, input.settings.dayBoundaryHour);
  const bars = auto.sessions.map(session => ({ start: session.start, end: session.end, kind: day.category === "出勤" ? "office" : day.category === "在宅" ? "remote" : "backfill" }));
  const fieldLabels: Record<string, string> = { category: "类别", clock_in: "上班", clock_out: "下班", note: "备注", restore_auto: "恢复自动", confirmed_at: "确认时间" };
  return <><Link className="back-link" href={`/month/${date.slice(0, 7)}`}>← 返回月度记录</Link><div className="page-heading"><div><p className="eyebrow">判定依据</p><h1>{date} <span>每日详情</span></h1></div></div>
    <section className="detail-summary"><div><span>类别</span><strong>{day.category ? CATEGORY_LABELS[day.category] : "待选择"}</strong></div><div><span>上下班</span><strong>{day.clock_in ?? "—"} — {day.clock_out ?? "—"}</strong></div><div><span>连续区间</span><strong>{day.active_min} 分钟</strong></div><div><span>状态</span><strong>{day.confirmed_at ? "已确认" : "待确认"}{locked ? " · 已锁定" : ""}</strong></div></section>
    {day.flags.length > 0 && <div className="detail-flags">{day.flags.map(f => <span key={f} className="badge warning">{f}</span>)}</div>}
    <section className="card"><h2>一天的时间线</h2><p>首次开盖／唤醒到末次合盖／睡眠连续计时，中间睡眠和空闲不扣除。下班时间为推算值，请核对。</p><div className="timeline" aria-label="连续工作区间">{bars.map((bar,i) => <span key={i} className={`timeline-bar ${bar.kind}`} style={{ left: `${Math.max(0, (bar.start-start)/864)}%`, width: `${Math.max(.12, (bar.end-bar.start)/864)}%` }} title={`${jstHHMM(bar.start)}–${jstHHMM(bar.end)}`}/>)}</div><div className="timeline-axis">{[0,6,12,18,24].map(h => <span key={h}>{String((input.settings.dayBoundaryHour+h)%24).padStart(2,"0")}:00</span>)}</div><div className="legend"><span><i className="office"/>到岗区间</span><span><i className="remote"/>居家区间</span><span><i className="backfill"/>地点待核实</span></div></section>
    <div className="detail-grid"><section className="card"><h2>工作区间与原始记录</h2>{locked && <p>月份已锁定。以下时间线按当前规则展示原始记录，不改变已锁定的考勤结果。</p>}<ul className="session-list">{auto.sessions.map((s,i) => <li key={i}><strong>{jstHHMM(s.start)} — {jstHHMM(s.end)}</strong><span>{Math.floor((s.end-s.start)/60)} 分钟 · {s.source === "samples" ? "历史采样首尾" : s.source === "pmset" ? "电源事件首尾" : "历史与电源事件"}</span></li>)}</ul>{!auto.sessions.length && <p>没有可用于判定的活动记录，需要人工补录或确认休假。</p>}<h3>当天出现的网络</h3>{input.networks.filter(n => input.samples.some(s => s.ts >= start && s.ts < end && s.gateway_mac === n.gateway_mac)).map(n => <p key={n.gateway_mac}>{n.label ?? "未命名网络"} · {n.is_office ? "公司" : "其他"}<br/><code>{n.gateway_mac}</code></p>)}{day.note && <p>备注：{day.note}</p>}</section>
    <section className="card"><h2>修改历史</h2>{!history.length && <p>尚无人工修改。</p>}<ol className="history-list">{history.map(row => <li key={Number(row.id)}><small>{jstDate(Number(row.at))} {jstHHMM(Number(row.at))}</small><strong>{fieldLabels[String(row.field)] ?? String(row.field)}</strong><span>{row.field === "confirmed_at" ? "已确认" : row.field === "restore_auto" ? "已恢复自动判定" : `${row.old_value ?? "空"} → ${row.new_value ?? "空"}`}</span></li>)}</ol></section></div></>;
}
export default function DayPage(props: { params: Promise<{ date: string }> }) { return <Suspense fallback={<p className="loading">正在加载每日详情…</p>}><Day {...props}/></Suspense>; }
