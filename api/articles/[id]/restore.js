"use strict";
/* POST /api/articles/[id]/restore  body: { revision_id, nickname? }
   指定した過去版のスナップショットを現在の記事に戻し、
   revision kind=restore として記録する（頻度制限の対象）。
   ※スキーマ上、写真は版管理の対象外のため、復元されるのは
     タイトル・本文・カテゴリ・タグ・関連記事のみ。写真は現在のものが維持される。 */
const {
  sb, send, fail, readBody, requestIpHash, checkLimit, recordUse,
  isUuid, nicknameOf, verifyTurnstile, getPublicArticleById,
} = require("../../_lib");

module.exports = async function handler(req, res) {
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
};
