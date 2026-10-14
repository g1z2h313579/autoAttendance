"use client";
import { createContext, useContext, useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
export type FormAction = (form: FormData) => Promise<{ ok: boolean; message: string }>;
export const FormPendingContext = createContext<((id: string, pending: boolean) => void) | null>(null);
export function ActionForm({ action, children, className = "" }: { action: FormAction; children: ReactNode; className?: string }) {
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition(); const router = useRouter();
  const id = useId(), onPendingChange = useContext(FormPendingContext);
  // 持续到 Server Action 的页面更新完成，避免恢复自动时提交旧摘要。
  useEffect(() => { onPendingChange?.(id, pending); }, [id, pending, onPendingChange]);
  useEffect(() => () => { onPendingChange?.(id, false); }, [id, onPendingChange]);
  return <form className={className} onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (pending) return;
    onPendingChange?.(id, true);
    startTransition(async () => {
      try { const result = await action(form); setState(result); if (result.ok) router.refresh(); }
      catch { setState({ ok: false, message: "连接失败，请重试" }); }
    });
  }}><fieldset disabled={pending}>{children}</fieldset>
    {pending && <span className="form-message" role="status">正在保存…</span>}
    {state && <p className={`form-message ${state.ok ? "success" : "error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>}
  </form>;
}
