"use strict";
/* POST /api/admin/logout — 管理セッションCookieを消す */
const { send, fail, sessionCookieHeader } = require("../_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method Not Allowed");
  res.setHeader("Set-Cookie", sessionCookieHeader(req, "", 0));
  send(res, 200, { ok: true });
};
