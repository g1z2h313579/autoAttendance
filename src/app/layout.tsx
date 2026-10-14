import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = { title: "个人考勤", description: "记录每天的工作，按公司模板生成考勤表" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body><header className="site-header"><Link href="/" className="brand"><span className="brand-mark">勤</span>个人考勤</Link><nav aria-label="主导航"><Link href="/">月度记录</Link><Link href="/settings">设置</Link></nav><span className="local-label">本机 · 东京时间</span></header><main className="page-shell">{children}</main><footer>数据保存在这台 Mac 上 · 时间精确到分钟</footer></body></html>;
}
