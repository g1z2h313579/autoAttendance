import { NextResponse } from "next/server";
import { parseYm } from "@/lib/time";
export function GET(request: Request) {
  const ym = new URL(request.url).searchParams.get("ym") ?? "";
  try { parseYm(ym); return NextResponse.redirect(new URL(`/month/${ym}`, request.url)); }
  catch { return Response.json({ error: "月份格式无效" }, { status: 400 }); }
}
