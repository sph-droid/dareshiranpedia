"use strict";
/* GET /api/articles/[id]/revisions — 編集履歴の一覧（メタ情報のみ。
   ip_hash など管理用情報は公開しない）
   ?rid=<版ID> があれば過去の版の内容（閲覧用スナップショット）を返す。
   GET /api/articles/:id/revisions/:rid は vercel.json の rewrite で
   こちらに届く（Hobbyプランの関数数上限12個に収めるため [rid].js を統合した）。 */
const { sb, send, fail, isUuid, getPublicArticleById } = require("../../../_lib");

/* 旧 [rid].js の処理をそのまま移設 */
async function handleSingle(req, res) {
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
}

async function handleList(req, res) {
  const id = (req.query || {}).id;
  if (!isUuid(id)) return fail(res, 400, "記事IDが不正です。");
  const article = await getPublicArticleById(id);
  if (!article) return fail(res, 404, "記事が見つかりません。");
  const { data } = await sb(
    "/revisions?article_id=eq." + id +
    "&select=id,nickname,kind,created_at&order=created_at.desc&limit=500"
  );
  send(res, 200, { article_id: id, title: article.title, revisions: data || [] });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return fail(res, 405, "Method Not Allowed");
  try {
    if ((req.query || {}).rid) return await handleSingle(req, res);
    return await handleList(req, res);
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
