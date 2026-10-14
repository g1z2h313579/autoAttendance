import Link from "next/link";
export default function NotFound() { return <section className="card"><h1>找不到这个页面</h1><p>请检查日期或月份是否有效。</p><Link className="button primary" href="/">返回本月</Link></section>; }
