"use strict";
/* DELETE /api/admin/articles/[id] — 記事を削除する（管理者のみ）。
   記事行の削除で article_images / revisions は cascade、
   reports.article_id は set null される。画像ファイル本体も消す。 */
const { sb, send, fail, requireAdmin, logAdmin, isUuid, storageDelete, getArticleByIdAnyStatus } = require("../../_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "DELETE") return fail(res, 405, "Method Not Allowed");
  if (!requireAdmin(req, res)) return;
  try {
    const id = (req.query || {}).id;
    if (!isUuid(id)) return fail(res, 400, "記事IDが不正です。");
    const article = await getArticleByIdAnyStatus(id);
    if (!article) return fail(res, 404, "記事が見つかりません。");
    const { data: images } = await sb("/article_images?article_id=eq." + id + "&select=storage_path");
    await sb("/articles?id=eq." + id, { method: "DELETE", prefer: "return=minimal" });
    for (const im of images || []) await storageDelete(im.storage_path);
    await logAdmin("article_delete", id, article.title);
    send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
