"use strict";
/* POST /api/reports — 違反報告（ログイン不要。軽い頻度制限あり）
   body: { article_id?, reason, detail?, turnstile_token? } */
const {
  sb, send, fail, readBody, requestIpHash, checkLimit, recordUse,
  cleanStr, isUuid, verifyTurnstile, MAX_REASON, MAX_DETAIL,
} = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method Not Allowed");
  try {
    const body = await readBody(req);
    const ipHash = requestIpHash(req);
    const reason = cleanStr(body.reason, MAX_REASON);
    const detail = cleanStr(body.detail, MAX_DETAIL);
    if (!reason) return fail(res, 400, "報告の理由を選んでください。");

    let articleId = null;
    if (body.article_id) {
      if (!isUuid(body.article_id)) return fail(res, 400, "記事の指定が不正です。");
      const { data } = await sb("/articles?id=eq." + body.article_id + "&select=id");
      if (data && data.length) articleId = body.article_id;
    }

    if (!(await verifyTurnstile(req, body.turnstile_token))) {
      return fail(res, 400, "認証（Turnstile）に失敗しました。もう一度お試しください。");
    }
    const limit = await checkLimit(ipHash, "report");
    if (limit) return fail(res, limit.status, limit.message);

    await sb("/reports", {
      method: "POST",
      prefer: "return=minimal",
      body: { article_id: articleId, reason, detail, ip_hash: ipHash },
    });
    await recordUse(ipHash, "report");
    send(res, 201, { ok: true });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
