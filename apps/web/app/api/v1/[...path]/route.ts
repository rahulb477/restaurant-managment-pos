import { errorResponse, json } from "@/lib/server/http";
import { handleApi } from "@/lib/server/handle-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function run(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await ctx.params;
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const contentType = req.headers.get("content-type") ?? "";
    let body: unknown = undefined;
    let form: FormData | undefined;
    if (method !== "GET" && method !== "HEAD") {
      if (contentType.includes("multipart/form-data")) {
        form = await req.formData();
      } else if (contentType.includes("application/json")) {
        body = await req.json().catch(() => undefined);
      }
    }
    const data = await handleApi({ method, parts: path ?? [], url, body, form });
    return json(data ?? { ok: true }, 200, { "Cache-Control": "private, no-store" });
  } catch (err) {
    const response = errorResponse(err);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export const GET = run;
export const POST = run;
export const PATCH = run;
export const PUT = run;
export const DELETE = run;
