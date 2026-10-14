"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="card"><h1>暂时无法加载数据</h1><p>请重试；仍无法恢复时，检查服务日志。</p><button className="button primary" onClick={reset}>重新加载</button></section>; }
