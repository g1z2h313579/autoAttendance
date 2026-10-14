import { withDbAsync } from "@/lib/db/server";
import { installTemplate } from "@/lib/export/templates";
import { sameOrigin } from "@/lib/http";
export async function POST(request: Request) {
  if(!sameOrigin(request))return Response.json({error:"请求来源无效"},{status:403});
  try {
    if(Number(request.headers.get("content-length"))>11*1024*1024)throw new Error("模板不能超过 10 MB");
    const form=await request.formData(),file=form.get("template");
    if(!(file instanceof File) || file.size>10*1024*1024)throw new Error("请选择不超过 10 MB 的 xlsx 文件");
    const buffer=Buffer.from(await file.arrayBuffer());
    await withDbAsync(db=>installTemplate(db,buffer,file.name));
    return Response.json({message:"新模板已保存并启用"});
  } catch(error) { return Response.json({error:error instanceof Error ? error.message : "上传失败"},{status:400}); }
}
