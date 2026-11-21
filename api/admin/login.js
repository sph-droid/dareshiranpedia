"use strict";
/* POST /api/admin/login  body: { email, password }
   Supabase Auth で本人確認し、ユーザーIDが ADMIN_USER_ID と一致する場合のみ
   署名付き httpOnly セッションCookie を発行する。一般向けの登録・ログインは無い。 */
const {
  env, supabaseUrl, serviceKey, send, fail, readBody, sessionCookieHeader, signSession, logAdmin,
} = require("../_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method Not Allowed");
  try {
    const body = await readBody(req);
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (!email || !password) return fail(res, 400, "メールアドレスとパスワードを入力してください。");

    const authRes = await fetch(supabaseUrl() + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {
        apikey: serviceKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    const authData = await authRes.json().catch(() => null);
    if (!authRes.ok || !authData || !authData.user) {
      return fail(res, 401, "メールアドレスまたはパスワードが違います。");
    }
    if (authData.user.id !== env("ADMIN_USER_ID")) {
      return fail(res, 403, "このアカウントには管理者権限がありません。");
    }
    res.setHeader("Set-Cookie", sessionCookieHeader(req, signSession(authData.user.id), 7 * 24 * 3600));
    await logAdmin("login", authData.user.id, "");
    send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    fail(res, 500, "サーバーエラーが発生しました。");
  }
};
