"use strict";
/* POST /api/admin/articles/[id]/hide — 記事の公開/非公開を切り替える（管理者のみ） */
const { sb, send, fail, requireAdmin, logAdmin, isUuid, getArticleByIdAnyStatus } = require("../../../_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method Not Allowed");
  if (!requireAdmin(req, res)) return;
  try {
    const id = (req.query || {}).id;
    if (!isUuid(id)) return fail(res, 400, "記事IDが不正です。");
    const article = await getArticleByIdAnyStatus(id);
    if (!article) return fail(res, 404, "記事が見つかりません。");
    const next = article.status === "public" ? "hidden" : "public";
    await sb("/articles?id=eq." + id, {
      method: "PATCH", prefer: "return=minimal", body: { status: next },
    });
    await logAdmin(next === "hidden" ? "article_hide" : "article_unhide", id, article.title);
    send(res, 200, { ok: true, status: next });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
