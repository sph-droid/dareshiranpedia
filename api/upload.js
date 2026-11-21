"use strict";
/* POST /api/upload — 画像アップロード
   body: { data: "<base64>", turnstile_token? }
   フロント側で canvas により長辺1600px以下へリサイズ＋再エンコード
   （EXIFは落とされる）した画像を受け取り、サーバー側で
   マジックバイトと容量（5MBまで）を再検証して Supabase Storage に保存する。
   戻り値: { path, url }
   ※Vercel の関数ボディ上限（約4.5MB）のため、実効上限は base64 で
     約3MB強になる。フロントの圧縮で通常は数百KBに収まる。 */
const crypto = require("crypto");
const {
  send, fail, readBody, requestIpHash, checkLimit, recordUse,
  storageUpload, storagePublicUrl, verifyTurnstile, MAX_IMAGE_BYTES,
} = require("./_lib");

function detectType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", type: "image/jpeg" };
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { ext: "png", type: "image/png" };
  }
  if (buf.length >= 6) {
    const head = buf.slice(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return { ext: "gif", type: "image/gif" };
  }
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF" &&
      buf.slice(8, 12).toString("ascii") === "WEBP") {
    return { ext: "webp", type: "image/webp" };
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method Not Allowed");
  try {
    const body = await readBody(req);
    const ipHash = requestIpHash(req);

    if (!(await verifyTurnstile(req, body.turnstile_token))) {
      return fail(res, 400, "認証（Turnstile）に失敗しました。もう一度お試しください。");
    }
    const limit = await checkLimit(ipHash, "upload");
    if (limit) return fail(res, limit.status, limit.message);

    let b64 = typeof body.data === "string" ? body.data : "";
    const comma = b64.indexOf(",");
    if (b64.startsWith("data:") && comma >= 0) b64 = b64.slice(comma + 1);
    if (!b64) return fail(res, 400, "画像データがありません。");
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return fail(res, 400, "画像データが不正です。");
    if (buf.length > MAX_IMAGE_BYTES) return fail(res, 400, "画像が大きすぎます（5MBまで）。");

    const kind = detectType(buf);
    if (!kind) return fail(res, 400, "対応していない画像形式です（JPEG / PNG / WebP / GIF のみ）。");

    const now = new Date();
    const ym = now.getUTCFullYear() + "/" + String(now.getUTCMonth() + 1).padStart(2, "0");
    const path = ym + "/" + crypto.randomUUID() + "." + kind.ext;
    await storageUpload(path, buf, kind.type);
    await recordUse(ipHash, "upload");
    send(res, 201, { path, url: storagePublicUrl(path) });
  } catch (e) {
    console.error(e);
    fail(res, 500, "アップロードに失敗しました。");
  }
};
