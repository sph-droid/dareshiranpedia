"use strict";
/* GET /api/random — ランダムな公開記事の id とタイトルを返す */
const { sb, send, fail } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return fail(res, 405, "Method Not Allowed");
  try {
    const { data } = await sb("/articles?status=eq.public&select=id,title&limit=1000");
    if (!data || !data.length) return fail(res, 404, "記事がまだありません。");
    const pick = data[Math.floor(Math.random() * data.length)];
    send(res, 200, { id: pick.id, title: pick.title });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
