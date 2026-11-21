"use strict";
/* GET /api/admin/reports — 報告一覧（管理者のみ）。記事タイトルを結合して返す */
const { sb, send, fail, requireAdmin } = require("../_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return fail(res, 405, "Method Not Allowed");
  if (!requireAdmin(req, res)) return;
  try {
    const { data } = await sb(
      "/reports?select=id,article_id,reason,detail,status,ip_hash,created_at,articles(title)" +
      "&order=created_at.desc&limit=200"
    );
    const reports = (data || []).map((r) => ({
      id: r.id,
      article_id: r.article_id,
      article_title: r.articles ? r.articles.title : null,
      reason: r.reason, detail: r.detail, status: r.status,
      ip_hash: r.ip_hash, created_at: r.created_at,
    }));
    send(res, 200, { reports });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
