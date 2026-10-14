"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
export type FormAction = (form: FormData) => Promise<{ ok: boolean; message: string }>;
export function ActionForm({ action, children, className = "" }: { action: FormAction; children: ReactNode; className?: string }) {
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition(); const router = useRouter();
  return <form className={className} onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try { const result = await action(form); setState(result); if (result.ok) router.refresh(); }
      catch { setState({ ok: false, message: "连接失败，请重试" }); }
    });
  }}><fieldset disabled={pending}>{children}</fieldset>
    {pending && <span className="form-message" role="status">正在保存…</span>}
    {state && <p className={`form-message ${state.ok ? "success" : "error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>}
  </form>;
}
