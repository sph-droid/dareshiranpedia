"use strict";
/* POST /api/admin/ban  body: { ip_hash, until?, reason? }
   指定したIPハッシュからの投稿を制限する（管理者のみ）。
   until が null の場合は無期限。 */
const { sb, send, fail, readBody, requireAdmin, logAdmin, cleanStr, MAX_REASON } = require("../_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method Not Allowed");
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readBody(req);
    const ipHash = String(body.ip_hash || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(ipHash)) return fail(res, 400, "IPハッシュの形式が不正です（SHA-256の16進数64文字）。");
    let until = null;
    if (body.until) {
      const t = new Date(body.until);
      if (isNaN(t.getTime())) return fail(res, 400, "期限の形式が不正です。");
      until = t.toISOString();
    }
    const reason = cleanStr(body.reason, MAX_REASON);
    await sb("/bans?on_conflict=ip_hash", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: { ip_hash: ipHash, until, reason },
    });
    await logAdmin("ban", ipHash, (until ? "期限: " + until + " " : "無期限 ") + reason);
    send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
