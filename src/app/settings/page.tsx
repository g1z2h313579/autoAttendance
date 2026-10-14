import { Suspense } from "react";
import { connection } from "next/server";
import { withDb } from "@/lib/db/server";
import { collectorHealth } from "@/lib/db/attendance";
import { readSettings, NUMBER_SETTINGS } from "@/lib/settings";
import { jstDate, jstHHMM } from "@/lib/time";
import type { Network } from "@/lib/judge/types";
import { ActionForm } from "@/components/action-form";
import { saveNetworkAction, saveSettingsAction } from "@/app/actions";
import { TemplateUpload } from "@/components/template-upload";
async function Settings() {
  await connection();
  const { settings, networks, health, template } = withDb(db => ({ settings: readSettings(db), networks: db.prepare("SELECT * FROM networks ORDER BY is_office DESC, last_seen DESC").all() as unknown as Network[], health: collectorHealth(db), template: db.prepare("SELECT file_name, uploaded_at FROM templates WHERE active=1 ORDER BY id DESC LIMIT 1").get() }));
  return <><div className="page-heading"><div><p className="eyebrow">让规则适合你的工作方式</p><h1>设置</h1></div></div><section className="card"><h2>采集状态</h2><p>{health.healthy ? "电源事件监听正常" : "电源事件监听未运行"} · {health.last_sample ? `最近事件 ${jstDate(health.last_sample)} ${jstHHMM(health.last_sample)}` : "尚无电源事件"}</p><p>只在唤醒、睡眠等事件时记录，不再每分钟采样。第一次开盖／唤醒记上班，末次合盖／睡眠暂记下班，中间连续算工作；下班时间请核对。</p></section>
    <section className="card"><h2>网络与工作地点</h2><p>事件时记录到公司网络即判为到岗，已知其他网络按居家处理；缺少网络时需人工指定。给新网络命名后，相关提示会消失。</p><div className="network-grid">{networks.map(n => <ActionForm action={saveNetworkAction} className="network-card" key={`${n.gateway_mac}:${n.label}:${n.is_office}`}><input type="hidden" name="mac" value={n.gateway_mac}/><label>网络名称<input name="label" defaultValue={n.label ?? ""} placeholder="例如：家里" required maxLength={80}/></label><code>{n.gateway_mac}</code><small>网关 {n.last_ip ?? "未知"}<br/>首次：{n.first_seen ? jstDate(n.first_seen) : "未知"} · 最近：{n.last_seen ? `${jstDate(n.last_seen)} ${jstHHMM(n.last_seen)}` : "未知"}</small><label className="checkbox-label"><input type="checkbox" name="office" defaultChecked={!!n.is_office}/>这是公司网络</label><button className="button secondary">保存网络</button></ActionForm>)}</div></section>
    <section className="card"><h2>判定规则</h2><p>规则改变后，未锁定月份会重新计算，人工修改保留；确认状态会清除。</p><ActionForm action={saveSettingsAction}><div className="settings-grid">{NUMBER_SETTINGS.map(({ key, label, min, max }) => <label key={key}>{label}<input name={key} type="number" min={min} max={max} required defaultValue={Number(settings[key])}/></label>)}<label className="wide">公司休息日（每行一个 YYYY-MM-DD）<textarea name="companyHolidays" rows={4} placeholder="2026-12-29" defaultValue={settings.companyHolidays.join("\n")}/></label><label className="full">额外导出目录（可选，绝对路径）<input name="exportDirectory" placeholder="例如：/Users/你的用户名/Documents/考勤" defaultValue={settings.exportDirectory}/></label></div><button className="button primary">保存设置</button></ActionForm></section>
    <section className="card"><h2>公司 Excel 模板</h2><p>{template ? `当前模板：${template.file_name}` : "首次导出时自动导入匿名示例模板；请上传填写自己姓名的模板。"}</p><TemplateUpload/><p>每年 12 月请检查并更新节假日数据依赖。</p></section></>;
}
export default function SettingsPage() { return <Suspense fallback={<p className="loading">正在加载设置…</p>}><Settings/></Suspense>; }
