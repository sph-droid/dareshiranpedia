"use strict";
/* DELETE /api/admin/articles/[id] — 記事を削除する（管理者のみ）。
   記事行の削除で article_images / revisions は cascade、
   reports.article_id は set null される。画像ファイル本体も消す。
   POST ?op=hide : 記事の公開/非公開の切り替え。POST
   /api/admin/articles/:id/hide は vercel.json の rewrite でこちらに届く
   （Hobbyプランの関数数上限12個に収めるため hide.js を統合した）。 */
const { sb, send, fail, requireAdmin, logAdmin, isUuid, storageDelete, getArticleByIdAnyStatus } = require("../../_lib");

/* POST /api/admin/articles/[id]/hide — 記事の公開/非公開を切り替える（管理者のみ）
   （旧 hide.js の処理をそのまま移設） */
async function handleHide(req, res) {
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
}

module.exports = async function handler(req, res) {
  /* rewrite 経由の公開切替（?op=hide）は元の hide ハンドラへ */
  if ((req.query || {}).op === "hide") return handleHide(req, res);
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
