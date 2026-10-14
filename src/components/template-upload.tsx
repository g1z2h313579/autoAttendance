"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function TemplateUpload() {
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false); const router = useRouter();
  return <form onSubmit={async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);
    try { const response = await fetch("/api/template", { method: "POST", body: form }); const result = await response.json(); setMessage(result.message ?? result.error); if (response.ok) router.refresh(); }
    catch { setMessage("上传失败，请重试"); } finally { setBusy(false); }
  }}><label>上传新模板（xlsx，最多 10 MB）<input type="file" name="template" accept=".xlsx" required disabled={busy}/></label><button className="button secondary" disabled={busy}>{busy ? "正在检查…" : "检查并使用模板"}</button>{message && <p role="status">{message}</p>}</form>;
}
