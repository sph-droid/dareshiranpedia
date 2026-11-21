"use strict";
/* GET /api/articles/[id]/revisions — 編集履歴の一覧（メタ情報のみ。
   ip_hash など管理用情報は公開しない） */
const { sb, send, fail, isUuid, getPublicArticleById } = require("../../../_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return fail(res, 405, "Method Not Allowed");
  try {
    const id = (req.query || {}).id;
    if (!isUuid(id)) return fail(res, 400, "記事IDが不正です。");
    const article = await getPublicArticleById(id);
    if (!article) return fail(res, 404, "記事が見つかりません。");
    const { data } = await sb(
      "/revisions?article_id=eq." + id +
      "&select=id,nickname,kind,created_at&order=created_at.desc&limit=500"
    );
    send(res, 200, { article_id: id, title: article.title, revisions: data || [] });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
