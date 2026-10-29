import { HttpError } from "./http";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX = 5 * 1024 * 1024;

function validSignature(buf: Buffer) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  if (buf[0] === 0x52 && buf[8] === 0x57 && buf[9] === 0x45) return true;
  return false;
}

export async function uploadToImgbb(file: File, meta: Record<string, unknown>) {
  const key = process.env.IMGBB_API_KEY;
  if (!key) {
    throw new HttpError(
      503,
      "IMGBB_API_KEY is not set. Public image uploads require ImgBB. See docs/IMGBB_SETUP.md",
    );
  }
  if (file.size > MAX) throw new HttpError(400, "Image too large (max 5MB)");
  if (!ALLOWED.has(file.type) && !file.type.startsWith("image/")) {
    throw new HttpError(400, "Only image files (jpg, png, webp, gif) are allowed");
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (!validSignature(buf)) {
    throw new HttpError(400, "File content does not match a supported image format");
  }
  const form = new FormData();
  form.set("key", key);
  form.set("image", buf.toString("base64"));
  const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: form });
  const json = (await res.json()) as {
    success?: boolean;
    data?: { url?: string; display_url?: string; delete_url?: string; width?: number; height?: number };
    error?: { message?: string };
  };
  if (!res.ok || !json.success || !json.data?.url) {
    throw new HttpError(400, json.error?.message ?? "ImgBB upload failed");
  }
  return {
    url: json.data.display_url ?? json.data.url,
    deleteUrl: json.data.delete_url,
    width: json.data.width,
    height: json.data.height,
    ...meta,
  };
}
