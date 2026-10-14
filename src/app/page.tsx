import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { businessDate, nowSec } from "@/lib/time";
import { withDb } from "@/lib/db/server";
import { readSettings } from "@/lib/settings";
async function CurrentMonth() {
  await connection();
  const hour = withDb(db => readSettings(db).dayBoundaryHour);
  redirect(`/month/${businessDate(nowSec(), hour).slice(0, 7)}`);
  return null;
}
export default function Home() { return <Suspense fallback={<p className="loading">正在打开本月考勤…</p>}><CurrentMonth/></Suspense>; }
