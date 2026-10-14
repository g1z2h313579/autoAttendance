// 只修改考勤输入单元格与公式缓存，其他 XML 部件原样保留。
import JSZip from "jszip";
import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from "@xmldom/xmldom";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { daysInMonth, parseYm, hhmmToMinutes } from "../time";
import { CATEGORIES, type Category } from "../judge/types";
import { WORK_RULE_CELLS, type TemplateWorkRules } from "../mail-summary";
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const MAX_SIZE = 10 * 1024 * 1024;
const HEADER_HASHES = { E10: "284cdaf4055c9710d65cbd7272c4e403baeb25c8e7551772b563f603ce6a18f0", I11: "a6b5433a25128905f14fcf99e0e68403adb98ec1ca322d54a3b1d078bc76c092", L11: "3331aa8ccc1864c5669b3fb8406cb92990661720850764388dfc33766728a9a6" };
export function parseXml(text: string): XmlDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("模板 XML 不支持外部实体");
  return new DOMParser({ onError: () => { throw new Error("模板 XML 格式错误"); } }).parseFromString(text, "text/xml");
}
export function cells(doc: XmlDocument): Map<string, XmlElement> {
  return new Map(Array.from(doc.getElementsByTagNameNS(NS,"c")).map(c=>[c.getAttribute("r") ?? "",c]));
}
function strings(doc: XmlDocument | null): string[] {
  return doc ? Array.from(doc.getElementsByTagNameNS(NS,"si")).map(si=> Array.from(si.getElementsByTagNameNS(NS,"t")).map(t=>t.textContent ?? "").join("")) : [];
}
function value(cell: XmlElement | undefined, shared: string[]): string {
  if (!cell) return "";
  if (cell.getAttribute("t") === "inlineStr") return Array.from(cell.getElementsByTagNameNS(NS,"t")).map(t=>t.textContent).join("");
  const text = cell.getElementsByTagNameNS(NS,"v")[0]?.textContent ?? "";
  return cell.getAttribute("t") === "s" ? shared[Number(text)] ?? "" : text;
}
async function readXml(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name); if (!file) throw new Error(`模板缺少必要部件：${name}`);
  const text = await file.async("string"); if (Buffer.byteLength(text) > 30*1024*1024) throw new Error("模板解压后过大"); return text;
}
export async function loadTemplate(buffer: Buffer) {
  if (buffer.length > MAX_SIZE) throw new Error("模板不能超过 10 MB");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer, { checkCRC32: false }); } catch { throw new Error("文件不是有效的 xlsx 模板"); }
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    expanded += size;
    if (size > 30*1024*1024 || expanded > 60*1024*1024) throw new Error("模板解压后过大");
  }
  if (zip.file("xl/vbaProject.bin")) throw new Error("不支持含宏的模板，请使用 xlsx");
  const workbook = await readXml(zip,"xl/workbook.xml"), rels = await readXml(zip,"xl/_rels/workbook.xml.rels");
  const wbDoc = parseXml(workbook), relDoc = parseXml(rels);
  const sheet = wbDoc.getElementsByTagNameNS(NS,"sheet")[0];
  if (!sheet) throw new Error("模板没有工作表");
  const id = sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id");
  const rel = Array.from(relDoc.getElementsByTagName("Relationship")).find(r=>r.getAttribute("Id")===id);
  if (!rel || rel.getAttribute("TargetMode") === "External") throw new Error("模板工作表关系无效");
  const target = rel.getAttribute("Target") ?? "";
  const sheetPath = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join("xl",target));
  if (!sheetPath.startsWith("xl/worksheets/") || !sheetPath.endsWith(".xml")) throw new Error("模板工作表路径无效");
  const sheetXml = await readXml(zip,sheetPath), sheetDoc = parseXml(sheetXml);
  const shared = strings(zip.file("xl/sharedStrings.xml") ? parseXml(await readXml(zip,"xl/sharedStrings.xml")) : null);
  const map = cells(sheetDoc);
  const person = value(map.get("V3"),shared).trim();
  if (!person || person.length > 80) throw new Error("模板姓名单元格 V3 为空或过长");
  for (const cell of ["O1","R1"]) if (!value(map.get(cell),shared) || !Number.isFinite(Number(value(map.get(cell),shared)))) throw new Error(`模板布局不兼容：${cell} 应为数字`);
  for (const [cell, hash] of Object.entries(HEADER_HASHES)) if (createHash("sha256").update(value(map.get(cell),shared)).digest("hex") !== hash) throw new Error(`模板布局不兼容：${cell} 表头不匹配`);
  if (!map.get("A13")?.getElementsByTagNameNS(NS,"f").length) throw new Error("模板布局不兼容：A13 应为日期公式");
  for (let row=13;row<=43;row++) for (const col of ["E","I","L"]) if (!map.has(`${col}${row}`)) throw new Error(`模板布局不兼容：缺少 ${col}${row}`);
  return { zip, workbook, wbDoc, sheetXml, sheetDoc, shared, map, sheetPath, sheetName: sheet.getAttribute("name") ?? "", person };
}
export async function inspectTemplate(buffer: Buffer) {
  const { sheetPath, sheetName, person } = await loadTemplate(buffer); return { sheetPath, sheetName, person };
}
/** 邮件摘要从当前模板规则区读取时间，避免更换模板后工时口径不同。 */
export async function readTemplateWorkRules(buffer: Buffer): Promise<TemplateWorkRules> {
  const { map, shared } = await loadTemplate(buffer);
  return Object.fromEntries(WORK_RULE_CELLS.map(id => {
    const text = value(map.get(id), shared), fraction = Number(text);
    if (!text || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error(`模板工时规则 ${id} 无效`);
    return [id, Math.round(fraction * 1440)];
  })) as TemplateWorkRules;
}
export interface WorkbookDay { date: string; category: Category | null; clock_in: string | null; clock_out: string | null }
export async function writeWorkbook(buffer: Buffer, ym: string, days: WorkbookDay[]): Promise<Buffer> {
  const [year,month] = parseYm(ym); const count = daysInMonth(ym);
  const t = await loadTemplate(buffer); let xml = t.sheetXml;
  const replacements = new Map<string,string>();
  const cellPattern=/<(?:[A-Za-z_][\w.-]*:)?c\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?c>)/g;
  const serializer = new XMLSerializer();
  function set(id: string, next: string | number | null) {
    const original = t.map.get(id)!;
    const existing = value(original,t.shared);
    const same = next === null ? existing === "" : typeof next === "number" ? existing !== "" && Math.abs(Number(existing)-next)<1e-14 : existing === next;
    if (same) return;
    const cell = original.cloneNode(false) as XmlElement;
    cell.removeAttribute("t");
    if (next !== null) {
      if (typeof next === "string") {
        // 复用模板里的类别字符串，避免改动 sharedStrings.xml。
        const index = t.shared.indexOf(next);
        if (index >= 0) { cell.setAttribute("t","s"); const v=t.sheetDoc.createElementNS(NS,"v"); v.appendChild(t.sheetDoc.createTextNode(String(index)));cell.appendChild(v); }
        else { cell.setAttribute("t","inlineStr");const is=t.sheetDoc.createElementNS(NS,"is"),text=t.sheetDoc.createElementNS(NS,"t");text.appendChild(t.sheetDoc.createTextNode(next));is.appendChild(text);cell.appendChild(is); }
      } else { const v=t.sheetDoc.createElementNS(NS,"v");v.appendChild(t.sheetDoc.createTextNode(String(next)));cell.appendChild(v); }
    }
    // 单元格继承工作表的命名空间，避免插入冗余 xmlns。
    replacements.set(id,serializer.serializeToString(cell).replace(` xmlns="${NS}"`,""));
  }
  set("O1",year);set("R1",month);
  const byDate = new Map(days.map(d=>[d.date,d]));
  for (let day=1;day<=31;day++) {
    const date = `${ym}-${String(day).padStart(2,"0")}`, entry = day<=count ? byDate.get(date) : undefined;
    if (entry?.category && !CATEGORIES.includes(entry.category)) throw new Error("考勤类别无效");
    set(`E${day+12}`,entry?.category ?? null);
    set(`I${day+12}`,entry?.clock_in ? hhmmToMinutes(entry.clock_in)/1440 : null);
    set(`L${day+12}`,entry?.clock_out ? hhmmToMinutes(entry.clock_out)/1440 : null);
  }
  xml = xml.replace(cellPattern,cell=>replacements.get(/\br=(["'])([^"']+)\1/.exec(cell)?.[2] ?? "") ?? cell);
  function clearFormulaCaches(text: string) { return text.replace(cellPattern,cell=>/<(?:[A-Za-z_][\w.-]*:)?f(?:\s|>|\/)/.test(cell) ? cell.replace(/<(?:[A-Za-z_][\w.-]*:)?v\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?v>)/g,"") : cell); }
  t.zip.file(t.sheetPath,clearFormulaCaches(xml));
  for (const path of Object.keys(t.zip.files).filter(p=>/^xl\/worksheets\/[^/]+\.xml$/.test(p) && p!==t.sheetPath)) {
    const before=await readXml(t.zip,path),after=clearFormulaCaches(before);if(after!==before)t.zip.file(path,after);
  }
  const calc = t.wbDoc.getElementsByTagNameNS(NS,"calcPr")[0] ?? t.wbDoc.createElementNS(NS,"calcPr");
  calc.setAttribute("fullCalcOnLoad","1");calc.setAttribute("forceFullCalc","1");calc.setAttribute("calcMode","auto");
  const calcXml=serializer.serializeToString(calc).replace(` xmlns="${NS}"`,"");
  const workbook=/<calcPr\b/.test(t.workbook) ? t.workbook.replace(/<calcPr\b[^>]*(?:\/>|>[\s\S]*?<\/calcPr>)/,calcXml) : t.workbook.replace("</workbook>",`${calcXml}</workbook>`);
  t.zip.file("xl/workbook.xml",workbook);
  return t.zip.generateAsync({ type:"nodebuffer", compression:"DEFLATE", compressionOptions:{level:6} });
}
