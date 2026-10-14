import { openDb } from "../src/lib/db";
import { computeMonth } from "../src/lib/judge/month";
import { CATEGORY_LABELS } from "../src/lib/judge/types";
import { businessDate, nowSec } from "../src/lib/time";
const db = openDb();
try {
  console.table(computeMonth(db, process.argv[2] ?? businessDate(nowSec()).slice(0, 7)).map(d => ({
    日期: d.date, 类别: d.category ? CATEGORY_LABELS[d.category] : "", 上班: d.clock_in ?? "", 下班: d.clock_out ?? "",
    区间分钟: d.active_min, 来源: d.source, 标记: d.flags.join("、"),
  })));
} finally { db.close(); }
