// 本机服务的写请求也核对来源，避免其他网页跨站触发导出或上传。
export function sameOrigin(request: Request): boolean {
  // Next 的内部 URL 可能使用 localhost；浏览器来源应与收到的 Host 对比。
  const url = new URL(request.url);
  const authority = request.headers.get("host") ?? url.host;
  let local: URL;
  try { local = new URL(`${url.protocol}//${authority}`); } catch { return false; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(local.hostname)) return false;
  const origin=request.headers.get("origin");
  if(!origin)return request.headers.get("sec-fetch-site") !== "cross-site";
  return origin === local.origin;
}
