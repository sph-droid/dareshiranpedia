"use strict";
/* GET /api/articles/[id]/revisions/[rid] — 過去の版の内容（閲覧用スナップショット） */
const { sb, send, fail, isUuid, getPublicArticleById } = require("../../../_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return fail(res, 405, "Method Not Allowed");
  try {
    const q = req.query || {};
    if (!isUuid(q.id) || !isUuid(q.rid)) return fail(res, 400, "指定が不正です。");
    const article = await getPublicArticleById(q.id);
    if (!article) return fail(res, 404, "記事が見つかりません。");
    const { data } = await sb(
      "/revisions?id=eq." + q.rid + "&article_id=eq." + q.id +
      "&select=id,article_id,title,body,category,tags,related,nickname,kind,created_at"
    );
    if (!data || !data.length) return fail(res, 404, "指定された版が見つかりません。");
    send(res, 200, { article_title: article.title, revision: data[0] });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
