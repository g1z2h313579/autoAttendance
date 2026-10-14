type RefreshEnvironment = { document: EventTarget; window: EventTarget; canRefresh: () => boolean; refresh: () => void };

/** 页面恢复时立即检查；周期检查不依赖旧结果中的“进行中”状态。 */
export function startPageRefresh({ document, window, canRefresh, refresh }: RefreshEnvironment): () => void {
  const check = () => { if (canRefresh()) refresh(); };
  const timer = setInterval(check, 60_000);
  document.addEventListener("visibilitychange", check);
  const events = ["focus", "pageshow", "online"];
  for (const event of events) window.addEventListener(event, check);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", check);
    for (const event of events) window.removeEventListener(event, check);
  };
}
