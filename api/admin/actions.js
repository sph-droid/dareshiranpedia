"use strict";
/* GET /api/admin/actions — 管理操作の履歴（管理者のみ） */
const { sb, send, fail, requireAdmin } = require("../_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return fail(res, 405, "Method Not Allowed");
  if (!requireAdmin(req, res)) return;
  try {
    const { data } = await sb("/admin_actions?select=*&order=created_at.desc&limit=100");
    send(res, 200, { actions: data || [] });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
