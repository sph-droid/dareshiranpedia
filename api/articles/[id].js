"use strict";
/* /api/articles/[id]
   GET : 記事詳細（本文・写真・編集履歴メタ）。?title= があればタイトルで引く。
         存在しないタイトルは 404 { exists:false, title } を返し、
         フロント側が「未作成記事」ページ（赤リンク先）を表示する。
   PUT : 記事編集（頻度制限あり。revision kind=edit を追加）
   POST ?op=restore : 過去版への復元。POST /api/articles/:id/restore は
         vercel.json の rewrite でこちらに届く（Hobbyプランの関数数上限
         12個に収めるため restore.js を統合した）。 */
const {
  sb, send, fail, readBody, requestIpHash, checkLimit, recordUse,
  cleanStr, isUuid, validateBody, cleanStringArray, nicknameOf, validateImages,
  verifyTurnstile, imageRow, storageDelete,
  MAX_BODY, MAX_CATEGORY, MAX_TAG, MAX_TAGS, MAX_RELATED, MAX_TITLE,
  getPublicArticleById,
} = require("../_lib");

async function fullArticle(res, article) {
  const [imgR, revR, createR] = await Promise.all([
    sb("/article_images?article_id=eq." + article.id + "&select=*&order=sort.asc,created_at.asc"),
    sb("/revisions?article_id=eq." + article.id + "&select=id,nickname,kind,created_at&order=created_at.desc&limit=200"),
    sb("/revisions?article_id=eq." + article.id + "&kind=eq.create&select=nickname&order=created_at.asc&limit=1"),
  ]);
  send(res, 200, {
    article: {
      id: article.id, title: article.title, body: article.body, category: article.category,
      tags: article.tags || [], related: article.related || [], status: article.status,
      created_at: article.created_at, updated_at: article.updated_at,
    },
    images: (imgR.data || []).map(imageRow),
    revisions: revR.data || [],
    created_by: createR.data && createR.data[0] ? createR.data[0].nickname : "匿名",
    revision_count: (revR.data || []).length,
  });
}

async function handleGet(req, res) {
  const q = req.query || {};
  if (q.title) {
    const title = cleanStr(q.title, MAX_TITLE);
    const { data } = await sb("/articles?title=eq." + encodeURIComponent(title) + "&status=eq.public&select=*");
    if (!data || !data.length) return send(res, 404, { exists: false, title });
    return fullArticle(res, data[0]);
  }
  const id = q.id;
  if (!isUuid(id)) return fail(res, 400, "記事IDが不正です。");
  const article = await getPublicArticleById(id);
  if (!article) return fail(res, 404, "記事が見つかりません。");
  return fullArticle(res, article);
}

async function handlePut(req, res) {
  const id = (req.query || {}).id;
  if (!isUuid(id)) return fail(res, 400, "記事IDが不正です。");
  const article = await getPublicArticleById(id);
  if (!article) return fail(res, 404, "記事が見つかりません。");

  const body = await readBody(req);
  const ipHash = requestIpHash(req);
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const category = cleanStr(body.category, MAX_CATEGORY) || "未分類";
  const tags = cleanStringArray(body.tags, MAX_TAG, MAX_TAGS);
  const related = cleanStringArray(body.related, MAX_TITLE, MAX_RELATED);
  const nickname = nicknameOf(body.nickname);
  const images = validateImages(body.images);

  const err = validateBody(text);
  if (err) return fail(res, 400, err);
  if (images === null) return fail(res, 400, "写真の指定が不正です。");

  if (!(await verifyTurnstile(req, body.turnstile_token))) {
    return fail(res, 400, "認証（Turnstile）に失敗しました。もう一度お試しください。");
  }
  const limit = await checkLimit(ipHash, "write");
  if (limit) return fail(res, limit.status, limit.message);

  await sb("/articles?id=eq." + id, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { body: text, category, tags, related, updated_at: new Date().toISOString() },
  });

  /* 写真は入れ替え（行を作り直し、外れたファイルはストレージからも消す） */
  const { data: oldImages } = await sb("/article_images?article_id=eq." + id + "&select=storage_path");
  await sb("/article_images?article_id=eq." + id, { method: "DELETE", prefer: "return=minimal" });
  if (images.length) {
    await sb("/article_images", {
      method: "POST",
      prefer: "return=minimal",
      body: images.map((im, i) => ({ article_id: id, storage_path: im.storage_path, caption: im.caption, sort: i })),
    });
  }
  const kept = {};
  images.forEach((im) => { kept[im.storage_path] = 1; });
  for (const old of oldImages || []) {
    if (!kept[old.storage_path]) await storageDelete(old.storage_path);
  }

  const { data: rev } = await sb("/revisions", {
    method: "POST",
    prefer: "return=representation",
    body: {
      article_id: id, title: article.title, body: text, category, tags, related,
      nickname, kind: "edit", ip_hash: ipHash,
    },
  });
  await recordUse(ipHash, "write");
  send(res, 200, { id, title: article.title, edit_id: rev && rev[0] ? rev[0].id : null });
}

/* POST /api/articles/[id]/restore  body: { revision_id, nickname? }
   指定した過去版のスナップショットを現在の記事に戻し、
   revision kind=restore として記録する（頻度制限の対象）。
   ※スキーマ上、写真は版管理の対象外のため、復元されるのは
     タイトル・本文・カテゴリ・タグ・関連記事のみ。写真は現在のものが維持される。
   （旧 restore.js の処理をそのまま移設） */
async function handleRestore(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method Not Allowed");
  try {
    const id = (req.query || {}).id;
    if (!isUuid(id)) return fail(res, 400, "記事IDが不正です。");
    const article = await getPublicArticleById(id);
    if (!article) return fail(res, 404, "記事が見つかりません。");

    const body = await readBody(req);
    const revisionId = body.revision_id;
    if (!isUuid(revisionId)) return fail(res, 400, "版の指定が不正です。");
    const nickname = nicknameOf(body.nickname);
    const ipHash = requestIpHash(req);

    const { data: revs } = await sb(
      "/revisions?id=eq." + revisionId + "&article_id=eq." + id +
      "&select=id,title,body,category,tags,related"
    );
    if (!revs || !revs.length) return fail(res, 404, "指定された版が見つかりません。");
    const snap = revs[0];

    if (!(await verifyTurnstile(req, body.turnstile_token))) {
      return fail(res, 400, "認証（Turnstile）に失敗しました。もう一度お試しください。");
    }
    const limit = await checkLimit(ipHash, "write");
    if (limit) return fail(res, limit.status, limit.message);

    await sb("/articles?id=eq." + id, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        body: snap.body, category: snap.category, tags: snap.tags || [], related: snap.related || [],
        updated_at: new Date().toISOString(),
      },
    });
    const { data: rev } = await sb("/revisions", {
      method: "POST",
      prefer: "return=representation",
      body: {
        article_id: id, title: article.title, body: snap.body, category: snap.category,
        tags: snap.tags || [], related: snap.related || [],
        nickname, kind: "restore", ip_hash: ipHash,
      },
    });
    await recordUse(ipHash, "write");
    send(res, 200, { id, title: article.title, edit_id: rev && rev[0] ? rev[0].id : null });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
}

module.exports = async function handler(req, res) {
  /* rewrite 経由の復元リクエスト（?op=restore）は元の restore ハンドラへ */
  if ((req.query || {}).op === "restore") return handleRestore(req, res);
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "PUT") return await handlePut(req, res);
    return fail(res, 405, "Method Not Allowed");
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
