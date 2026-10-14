"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function ExportPanel({ ym, locked }: { ym: string; locked: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]), [url, setUrl] = useState("");
  const [lock, setLock] = useState(false); const router = useRouter();
  async function generate(force = false) {
    setBusy(true); setMessage(""); setUrl("");
    try {
      const response = await fetch(`/api/export/${ym}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force, lock: lock && !locked }) });
      const result = await response.json(); setWarnings(result.warnings ?? []);
      if (!response.ok) setMessage(result.error ?? "导出失败");
      else { setUrl(result.url); setMessage("考勤表已生成，用 Excel 打开后会自动重算合计。"); router.refresh(); }
    } catch { setMessage("导出失败，请检查连接后重试"); } finally { setBusy(false); }
  }
  return <section className="export-panel"><div><p className="eyebrow">按公司模板生成</p><h2>导出本月考勤表</h2><p>保留模板的公式、样式和下拉选项。</p></div><div className="export-controls"><label className="checkbox-label"><input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} disabled={locked || busy}/>导出后锁定月份</label><button className="button primary" onClick={() => generate()} disabled={busy}>{busy ? "正在生成…" : "生成 Excel"}</button>{url && <a className="button secondary" href={url}>下载考勤表 ↓</a>}</div>{message && <p role="status" className="export-message">{message}</p>}{warnings.length > 0 && <div className="export-warnings"><strong>以下记录尚需检查</strong><ul>{warnings.map(w => <li key={w}>{w}</li>)}</ul><button className="button secondary" disabled={busy} onClick={() => generate(true)}>已了解，仍然导出</button></div>}</section>;
}
