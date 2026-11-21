"use strict";
/* GET /api/home
   トップページ用: 最近更新・新着・カテゴリ別件数・統計・ランダム記事タイトル */
const { sb, send, fail, articleSummary } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return fail(res, 405, "Method Not Allowed");
  try {
    const [recentR, newestR, allR, imgCountR, revCountR] = await Promise.all([
      sb("/articles?status=eq.public&select=id,title,category,tags,created_at,updated_at&order=updated_at.desc&limit=7"),
      sb("/articles?status=eq.public&select=id,title,category,tags,created_at,updated_at&order=created_at.desc&limit=7"),
      sb("/articles?status=eq.public&select=id,title,category", { count: true }),
      sb("/article_images?select=id", { count: true }),
      sb("/revisions?select=id", { count: true }),
    ]);
    const all = allR.data || [];
    const catMap = {};
    all.forEach((a) => { catMap[a.category] = (catMap[a.category] || 0) + 1; });
    const categories = Object.keys(catMap).sort().map((name) => ({ name, count: catMap[name] }));
    let random = null;
    if (all.length) {
      const pick = all[Math.floor(Math.random() * all.length)];
      random = { id: pick.id, title: pick.title };
    }
    send(res, 200, {
      recent: (recentR.data || []).map(articleSummary),
      newest: (newestR.data || []).map(articleSummary),
      categories,
      stats: {
        articles: allR.count !== null ? allR.count : all.length,
        images: imgCountR.count || 0,
        revisions: revCountR.count || 0,
        categories: categories.length,
      },
      random,
    });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
