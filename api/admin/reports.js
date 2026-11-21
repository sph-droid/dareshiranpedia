"use strict";
/* GET /api/admin/reports — 報告一覧（管理者のみ）。記事タイトルを結合して返す
   POST ?op=done&id=<報告ID> : 報告を対応済みにする。POST
   /api/admin/reports/:id/done は vercel.json の rewrite でこちらに届く
   （Hobbyプランの関数数上限12個に収めるため done.js を統合した）。 */
const { sb, send, fail, requireAdmin, logAdmin, isUuid } = require("../_lib");

/* 旧 reports/[id]/done.js の処理をそのまま移設 */
async function handleDone(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method Not Allowed");
  if (!requireAdmin(req, res)) return;
  try {
    const id = (req.query || {}).id;
    if (!isUuid(id)) return fail(res, 400, "報告IDが不正です。");
    const { data } = await sb("/reports?id=eq." + id + "&select=id");
    if (!data || !data.length) return fail(res, 404, "報告が見つかりません。");
    await sb("/reports?id=eq." + id, {
      method: "PATCH", prefer: "return=minimal", body: { status: "done" },
    });
    await logAdmin("report_done", id, "");
    send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
}

module.exports = async function handler(req, res) {
  /* rewrite 経由の対応済み化（?op=done）は元の done ハンドラへ */
  if ((req.query || {}).op === "done") return handleDone(req, res);
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
