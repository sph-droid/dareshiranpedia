"use strict";
/* /api/articles
   GET  : 検索・一覧（公開記事のみ）
          ?q= 検索語 / ?category= / ?tag= / ?titles=1 タイトル索引 / ?recent=N 最近の編集
   POST : 新規記事作成（頻度制限あり。最初の revision kind=create を作り、そのIDが編集ID） */
const {
  sb, send, fail, readBody, requestIpHash, checkLimit, recordUse,
  cleanStr, validateTitle, validateBody, cleanStringArray, nicknameOf, validateImages,
  verifyTurnstile, articleSummary, MAX_TITLE, MAX_BODY, MAX_CATEGORY, MAX_TAG, MAX_TAGS, MAX_RELATED,
} = require("../_lib");

const SUMMARY_COLS = "id,title,category,tags,created_at,updated_at";

function sanitizeForQuery(q) {
  // PostgREST の or() や cs.{} を壊す文字を取り除く
  return q.replace(/[*%,(){}"\\]/g, " ").replace(/\s+/g, " ").trim();
}

async function handleGet(req, res) {
  const q = req.query || {};

  /* タイトル索引（Wikiリンクの赤/青判定用）＋カテゴリ集計 */
  if (q.titles) {
    const { data } = await sb("/articles?status=eq.public&select=id,title,category&order=title.asc&limit=2000");
    const rows = data || [];
    const catMap = {};
    rows.forEach((a) => { catMap[a.category] = (catMap[a.category] || 0) + 1; });
    return send(res, 200, {
      titles: rows.map((a) => ({ id: a.id, title: a.title })),
      categories: Object.keys(catMap).sort().map((name) => ({ name, count: catMap[name] })),
    });
  }

  /* 最近の編集（全記事横断） */
  if (q.recent) {
    const limit = Math.min(parseInt(q.recent, 10) || 30, 100);
    const { data: revs } = await sb(
      "/revisions?select=id,article_id,nickname,kind,created_at&order=created_at.desc&limit=" + limit * 2
    );
    const list = revs || [];
    if (!list.length) return send(res, 200, { recent: [] });
    const ids = Array.from(new Set(list.map((r) => r.article_id)));
    const { data: arts } = await sb(
      "/articles?status=eq.public&select=id,title&id=in.(" + ids.join(",") + ")"
    );
    const titleOf = {};
    (arts || []).forEach((a) => { titleOf[a.id] = a.title; });
    const recent = list
      .filter((r) => titleOf[r.article_id])
      .slice(0, limit)
      .map((r) => ({
        revision_id: r.id, article_id: r.article_id, article_title: titleOf[r.article_id],
        nickname: r.nickname, kind: r.kind, created_at: r.created_at,
      }));
    return send(res, 200, { recent });
  }

  /* カテゴリ絞り込み */
  if (q.category) {
    const cat = cleanStr(q.category, MAX_CATEGORY);
    const { data } = await sb(
      "/articles?status=eq.public&category=eq." + encodeURIComponent(cat) +
      "&select=" + SUMMARY_COLS + "&order=title.asc&limit=500"
    );
    return send(res, 200, { articles: (data || []).map(articleSummary) });
  }

  /* タグ絞り込み */
  if (q.tag) {
    const tag = sanitizeForQuery(cleanStr(q.tag, MAX_TAG));
    const { data } = await sb(
      "/articles?status=eq.public&tags=cs.{" + encodeURIComponent(tag) + "}" +
      "&select=" + SUMMARY_COLS + "&order=updated_at.desc&limit=200"
    );
    return send(res, 200, { articles: (data || []).map(articleSummary) });
  }

  /* キーワード検索（タイトル・本文・カテゴリを ilike、タグは完全一致で別途マージ） */
  if (q.q !== undefined && String(q.q).trim() !== "") {
    const term = sanitizeForQuery(String(q.q));
    if (!term) return send(res, 200, { articles: [] });
    const enc = encodeURIComponent(term);
    const orQuery = "(title.ilike.*" + enc + "*,body.ilike.*" + enc + "*,category.ilike.*" + enc + "*)";
    const [byText, byTag] = await Promise.all([
      sb("/articles?status=eq.public&or=" + orQuery + "&select=" + SUMMARY_COLS + ",body&order=updated_at.desc&limit=100"),
      sb("/articles?status=eq.public&tags=cs.{" + enc + "}&select=" + SUMMARY_COLS + ",body&order=updated_at.desc&limit=100"),
    ]);
    const seen = {};
    const out = [];
    [].concat(byText.data || [], byTag.data || []).forEach((a) => {
      if (seen[a.id]) return;
      seen[a.id] = 1;
      const s = articleSummary(a);
      s.excerpt = String(a.body || "").slice(0, 300);
      out.push(s);
    });
    return send(res, 200, { articles: out });
  }

  /* 全件一覧 */
  const { data } = await sb(
    "/articles?status=eq.public&select=" + SUMMARY_COLS + "&order=updated_at.desc&limit=500"
  );
  return send(res, 200, { articles: (data || []).map(articleSummary) });
}

async function handlePost(req, res) {
  const body = await readBody(req);
  const ipHash = requestIpHash(req);

  const title = cleanStr(body.title, MAX_TITLE);
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const category = cleanStr(body.category, MAX_CATEGORY) || "未分類";
  const tags = cleanStringArray(body.tags, MAX_TAG, MAX_TAGS);
  const related = cleanStringArray(body.related, MAX_TITLE, MAX_RELATED);
  const nickname = nicknameOf(body.nickname);
  const images = validateImages(body.images);

  let err = validateTitle(title);
  if (err) return fail(res, 400, err);
  err = validateBody(text);
  if (err) return fail(res, 400, err);
  if (images === null) return fail(res, 400, "写真の指定が不正です。");

  if (!(await verifyTurnstile(req, body.turnstile_token))) {
    return fail(res, 400, "認証（Turnstile）に失敗しました。もう一度お試しください。");
  }
  const limit = await checkLimit(ipHash, "write");
  if (limit) return fail(res, limit.status, limit.message);

  /* 同名記事の重複チェック（非公開含む） */
  const { data: dup } = await sb("/articles?title=eq." + encodeURIComponent(title) + "&select=id");
  if (dup && dup.length) return fail(res, 409, "「" + title + "」という記事は既に存在します。その記事を編集してください。");

  const { data: created } = await sb("/articles", {
    method: "POST",
    prefer: "return=representation",
    body: { title, body: text, category, tags, related },
  });
  const article = created && created[0];
  if (!article) return fail(res, 500, "記事の作成に失敗しました。");

  if (images.length) {
    await sb("/article_images", {
      method: "POST",
      prefer: "return=minimal",
      body: images.map((im, i) => ({ article_id: article.id, storage_path: im.storage_path, caption: im.caption, sort: i })),
    });
  }
  const { data: rev } = await sb("/revisions", {
    method: "POST",
    prefer: "return=representation",
    body: {
      article_id: article.id, title, body: text, category, tags, related,
      nickname, kind: "create", ip_hash: ipHash,
    },
  });
  await recordUse(ipHash, "write");
  send(res, 201, { id: article.id, title: article.title, edit_id: rev && rev[0] ? rev[0].id : null });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);
    return fail(res, 405, "Method Not Allowed");
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
