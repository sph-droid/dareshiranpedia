"use strict";
/* POST /api/admin/reports/[id]/done — 報告を対応済みにする（管理者のみ） */
const { sb, send, fail, requireAdmin, logAdmin, isUuid } = require("../../../_lib");

module.exports = async function handler(req, res) {
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
};
