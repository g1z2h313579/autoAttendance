"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function ExportPanel({ ym, locked, blocked, blockMessage, revision, onBusyChange }: {
  ym: string; locked: boolean; blocked: boolean; blockMessage: string; revision: string; onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ revision: string; message: string; warnings: string[]; url?: string } | null>(null);
  // 保存新内容后，旧文件和旧警告不再代表当前记录，必须重新生成。
  const current = !blocked && result?.revision === revision ? result : null;
  const [lock, setLock] = useState(false); const router = useRouter();
  async function generate(force = false) {
    if (blocked || busy) return;
    setBusy(true); onBusyChange(true); setResult(null);
    try {
      const response = await fetch(`/api/export/${ym}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force, lock: lock && !locked }) });
      const payload = await response.json();
      setResult({ revision: response.ok ? payload.revision : revision, message: response.ok ? "考勤表已生成，用 Excel 打开后会自动重算合计。" : payload.error ?? "导出失败", warnings: payload.warnings ?? [], url: response.ok ? payload.url : undefined });
      if (response.ok) router.refresh();
    } catch { setResult({ revision, message: "导出失败，请检查连接后重试", warnings: [] }); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="export-panel"><div><p className="eyebrow">按公司模板生成</p><h2>导出本月考勤表</h2><p>保留模板的公式、样式和下拉选项。</p></div><div className="export-controls"><label className="checkbox-label"><input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} disabled={locked || busy || blocked}/>导出后锁定月份</label><button className="button primary" onClick={() => generate()} disabled={busy || blocked}>{busy ? "正在生成…" : "生成 Excel"}</button>{current?.url && <a className="button secondary" href={current.url}>下载考勤表 ↓</a>}</div>{blockMessage && <p role="status" className="export-message">{blockMessage}</p>}{current?.message && <p role="status" className="export-message">{current.message}</p>}{!!current?.warnings.length && <div className="export-warnings"><strong>以下记录尚需检查</strong><ul>{current.warnings.map(w => <li key={w}>{w}</li>)}</ul><button className="button secondary" disabled={busy || blocked} onClick={() => generate(true)}>已了解，仍然导出</button></div>}</section>;
}
