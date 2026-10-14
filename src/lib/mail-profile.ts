// 仅从服务端调用；个人配置在请求时读取，不写入客户端构建产物。
import { DEFAULT_MAIL_PROFILE, type MailProfile } from "./mail-summary";

export function readMailProfile(): MailProfile {
  const amount = process.env.KAOQIN_MAIL_TRANSPORT_YEN?.trim();
  const transportYen = amount ? Number(amount) : DEFAULT_MAIL_PROFILE.transportYen;
  if (!Number.isSafeInteger(transportYen) || transportYen < 0) {
    throw new Error("KAOQIN_MAIL_TRANSPORT_YEN 须为非负整数");
  }
  return {
    name: process.env.KAOQIN_MAIL_NAME?.trim() || DEFAULT_MAIL_PROFILE.name,
    workplace: process.env.KAOQIN_MAIL_WORKPLACE?.trim() || DEFAULT_MAIL_PROFILE.workplace,
    transportYen,
  };
}
