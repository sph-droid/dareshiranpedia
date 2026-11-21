"use strict";
/* ============================================================
   誰もしらんペディア API 共通ライブラリ（Vercel サーバーレス関数用）
   このファイルはルートではありません（先頭が _ のため）。
   環境変数:
     SUPABASE_URL            例: https://xxxx.supabase.co
     SUPABASE_SERVICE_KEY    サービスロールキー（秘密。フロントには出さない）
     IP_HASH_SALT            IPハッシュ化用のソルト（ランダムな文字列）
     ADMIN_USER_ID           管理者の Supabase Auth ユーザーID
     ADMIN_SESSION_SECRET    管理セッションCookie署名用の秘密文字列
     TURNSTILE_SECRET        任意。設定時のみ Turnstile 検証を行う
   ============================================================ */
const crypto = require("crypto");

/* ---------- 頻度制限の暫定値（オーナー確認待ちの仮設定） ----------
   設計書の「決めてほしいこと」に対する推奨案Bを暫定採用している。
   値を変える場合はここだけを変更すればよい。 */
const RATE_WRITE_PER_DAY = 10;      // 作成・編集・復元（書き込み系）: 1日10回まで
const RATE_WRITE_INTERVAL_SEC = 60; // 書き込みの最小間隔: 60秒
const RATE_REPORT_PER_DAY = 5;      // 報告: 1日5回まで
const RATE_UPLOAD_PER_DAY = 60;     // 画像アップロード: 1日60回まで

/* ---------- 入力上限 ---------- */
const MAX_TITLE = 200;
const MAX_BODY = 20000;
const MAX_NICKNAME = 50;
const MAX_CATEGORY = 100;
const MAX_TAG = 50;
const MAX_TAGS = 20;
const MAX_RELATED = 50;
const MAX_CAPTION = 500;
const MAX_REASON = 200;
const MAX_DETAIL = 2000;
const MAX_IMAGES_PER_ARTICLE = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

const BUCKET = "article-images";

/* ---------- 環境変数 ---------- */
function env(name) {
  const v = process.env[name];
  if (!v) throw new Error("環境変数 " + name + " が設定されていません");
  return v;
}
function supabaseUrl() { return env("SUPABASE_URL").replace(/\/+$/, ""); }
function serviceKey() { return env("SUPABASE_SERVICE_KEY"); }

/* ---------- レスポンス ---------- */
function send(res, status, obj) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(obj);
}
function fail(res, status, message) { send(res, status, { error: message }); }

/* ---------- リクエストボディ（JSON） ---------- */
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object") return req.body;
    if (typeof req.body === "string" && req.body.length) {
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
    if (typeof req.body === "string") return {};
  }
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 12 * 1024 * 1024) { resolve({}); try { req.destroy(); } catch (e) {} }
    });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

/* ---------- Supabase REST ---------- */
async function sb(path, opts) {
  opts = opts || {};
  const headers = {
    apikey: serviceKey(),
    Authorization: "Bearer " + serviceKey(),
    "Content-Type": "application/json",
  };
  if (opts.count) headers["Prefer"] = "count=exact";
  if (opts.prefer) headers["Prefer"] = (headers["Prefer"] ? headers["Prefer"] + "," : "") + opts.prefer;
  const res = await fetch(supabaseUrl() + "/rest/v1" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  let count = null;
  const cr = res.headers.get("content-range");
  if (cr && cr.indexOf("/") >= 0) {
    const n = parseInt(cr.split("/")[1], 10);
    if (!isNaN(n)) count = n;
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || ("Supabase error " + res.status);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { status: res.status, data, count };
}

function storagePublicUrl(storagePath) {
  return supabaseUrl() + "/storage/v1/object/public/" + BUCKET + "/" + storagePath;
}

async function storageUpload(storagePath, buffer, contentType) {
  const res = await fetch(supabaseUrl() + "/storage/v1/object/" + BUCKET + "/" + storagePath, {
    method: "POST",
    headers: {
      apikey: serviceKey(),
      Authorization: "Bearer " + serviceKey(),
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: buffer,
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error("Storage upload failed: " + res.status + " " + t.slice(0, 200));
    err.status = res.status;
    throw err;
  }
  return true;
}

async function storageDelete(storagePath) {
  try {
    await fetch(supabaseUrl() + "/storage/v1/object/" + BUCKET + "/" + storagePath, {
      method: "DELETE",
      headers: { apikey: serviceKey(), Authorization: "Bearer " + serviceKey() },
    });
  } catch (e) { /* 削除失敗は致命的でないため握りつぶす */ }
}

/* ---------- IP とハッシュ化 ---------- */
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  if (req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]);
  return "unknown";
}
function ipHashOf(ip) {
  const salt = process.env.IP_HASH_SALT || "";
  return crypto.createHash("sha256").update(salt + ":" + ip).digest("hex");
}
function requestIpHash(req) { return ipHashOf(clientIp(req)); }

/* 日本時間の当日 (YYYY-MM-DD) */
function jstDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/* ---------- BAN・頻度制限 ---------- */
async function isBanned(ipHash) {
  const { data } = await sb("/bans?ip_hash=eq." + encodeURIComponent(ipHash) + "&select=ip_hash,until");
  if (!data || !data.length) return false;
  const until = data[0].until;
  if (!until) return true;
  return new Date(until).getTime() > Date.now();
}

/* 書き込み系チェック（読むだけ）。問題なければ null、あれば {status, message} を返す */
async function checkLimit(ipHash, action) {
  if (await isBanned(ipHash)) {
    return { status: 403, message: "この接続元からの投稿は制限されています。" };
  }
  const perDay = action === "write" ? RATE_WRITE_PER_DAY
    : action === "report" ? RATE_REPORT_PER_DAY
    : RATE_UPLOAD_PER_DAY;
  const day = jstDay();
  const { data } = await sb(
    "/rate_limits?ip_hash=eq." + encodeURIComponent(ipHash) +
    "&action=eq." + encodeURIComponent(action) +
    "&day=eq." + day + "&select=count,last_at"
  );
  const row = data && data[0];
  if (row) {
    if (row.count >= perDay) {
      return {
        status: 429,
        message: action === "report"
          ? "本日の報告回数の上限（" + perDay + "回）に達しました。明日またお試しください。"
          : "本日の投稿・編集回数の上限（" + perDay + "回）に達しました。明日またお試しください。",
      };
    }
    if (action === "write" && row.last_at) {
      const elapsed = (Date.now() - new Date(row.last_at).getTime()) / 1000;
      if (elapsed < RATE_WRITE_INTERVAL_SEC) {
        return { status: 429, message: "連続投稿を制限しています。1分ほど待ってからお試しください。" };
      }
    }
  }
  return null;
}

/* 利用を1回分記録する（成功した書き込みの後に呼ぶ） */
async function recordUse(ipHash, action) {
  const day = jstDay();
  const { data } = await sb(
    "/rate_limits?ip_hash=eq." + encodeURIComponent(ipHash) +
    "&action=eq." + encodeURIComponent(action) +
    "&day=eq." + day + "&select=count"
  );
  const next = ((data && data[0] && data[0].count) || 0) + 1;
  await sb("/rate_limits?on_conflict=ip_hash,action,day", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: { ip_hash: ipHash, action, day, count: next, last_at: new Date().toISOString() },
  });
}

/* ---------- 入力検証 ---------- */
function cleanStr(v, max) {
  if (v === null || v === undefined) return "";
  let s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}
function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
}
/* 検証NGならエラーメッセージ文字列、OKなら null */
function validateTitle(title) {
  if (!title) return "記事タイトルを入力してください。";
  if (/[<>]/.test(title)) return "タイトルに < や > は使えません。";
  return null;
}
function validateBody(body) {
  if (!body) return "本文を入力してください。";
  if (body.length > MAX_BODY) return "本文が長すぎます（" + MAX_BODY + "文字まで）。";
  if (/<\/?[a-zA-Z][^>]*>/.test(body)) return "本文にHTMLタグは使えません。Wiki記法を使ってください。";
  return null;
}
function cleanStringArray(v, itemMax, countMax) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    const s = cleanStr(item, itemMax);
    if (s && out.indexOf(s) < 0) out.push(s);
    if (out.length >= countMax) break;
  }
  return out;
}
function nicknameOf(v) {
  const n = cleanStr(v, MAX_NICKNAME);
  return n || "匿名";
}
/* 画像リストの検証。OKなら整形済み配列、NGなら null */
function validateImages(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  if (v.length > MAX_IMAGES_PER_ARTICLE) return null;
  const out = [];
  for (const im of v) {
    if (!im || typeof im.storage_path !== "string") return null;
    const p = im.storage_path;
    if (p.length > 300 || p.indexOf("..") >= 0 || !/^[\w\-./]+\.(jpg|jpeg|png|webp|gif)$/i.test(p)) return null;
    out.push({ storage_path: p, caption: cleanStr(im.caption, MAX_CAPTION) });
  }
  return out;
}

/* ---------- Turnstile（TURNSTILE_SECRET 設定時のみ） ---------- */
async function verifyTurnstile(req, token) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    form.set("remoteip", clientIp(req));
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    return !!(data && data.success);
  } catch (e) {
    return false;
  }
}

/* ---------- 管理者セッション（署名付きCookie） ---------- */
const ADMIN_COOKIE = "dareshi_admin";
function signSession(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 7 * 24 * 3600 * 1000 }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", env("ADMIN_SESSION_SECRET")).update(payload).digest("base64url");
  return payload + "." + sig;
}
function verifySession(req) {
  try {
    const secret = process.env.ADMIN_SESSION_SECRET;
    const adminId = process.env.ADMIN_USER_ID;
    if (!secret || !adminId) return null;
    const cookie = req.headers.cookie || "";
    let value = null;
    cookie.split(";").forEach((part) => {
      const kv = part.trim().split("=");
      if (kv[0] === ADMIN_COOKIE) value = kv.slice(1).join("=");
    });
    if (!value) return null;
    const dot = value.lastIndexOf(".");
    if (dot < 0) return null;
    const payload = value.slice(0, dot);
    const sig = value.slice(dot + 1);
    const expect = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!obj || obj.exp < Date.now()) return null;
    if (obj.uid !== adminId) return null;
    return obj.uid;
  } catch (e) {
    return null;
  }
}
function sessionCookieHeader(req, value, maxAge) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "";
  const secure = proto === "https" && host.indexOf("localhost") < 0 ? "; Secure" : "";
  return ADMIN_COOKIE + "=" + value + "; HttpOnly; Path=/; SameSite=Lax; Max-Age=" + maxAge + secure;
}
/* 管理者でなければ 401 を送って null、管理者なら uid を返す */
function requireAdmin(req, res) {
  const uid = verifySession(req);
  if (!uid) { fail(res, 401, "管理者ログインが必要です。"); return null; }
  return uid;
}
async function logAdmin(action, target, detail) {
  try {
    await sb("/admin_actions", {
      method: "POST",
      prefer: "return=minimal",
      body: { action, target: String(target || ""), detail: String(detail || "") },
    });
  } catch (e) { console.error("logAdmin failed", e); }
}

/* ---------- 記事の整形 ---------- */
function articleSummary(a) {
  return {
    id: a.id, title: a.title, category: a.category,
    tags: a.tags || [], created_at: a.created_at, updated_at: a.updated_at,
  };
}
function imageRow(im) {
  return {
    id: im.id, storage_path: im.storage_path, url: storagePublicUrl(im.storage_path),
    caption: im.caption || "", sort: im.sort || 0,
  };
}
async function getPublicArticleById(id) {
  const { data } = await sb("/articles?id=eq." + encodeURIComponent(id) + "&status=eq.public&select=*");
  return data && data[0] ? data[0] : null;
}
async function getArticleByIdAnyStatus(id) {
  const { data } = await sb("/articles?id=eq." + encodeURIComponent(id) + "&select=*");
  return data && data[0] ? data[0] : null;
}

module.exports = {
  RATE_WRITE_PER_DAY, RATE_WRITE_INTERVAL_SEC, RATE_REPORT_PER_DAY, RATE_UPLOAD_PER_DAY,
  MAX_TITLE, MAX_BODY, MAX_NICKNAME, MAX_CATEGORY, MAX_TAG, MAX_TAGS, MAX_RELATED,
  MAX_CAPTION, MAX_REASON, MAX_DETAIL, MAX_IMAGES_PER_ARTICLE, MAX_IMAGE_BYTES, BUCKET,
  env, supabaseUrl, serviceKey, send, fail, readBody, sb,
  storagePublicUrl, storageUpload, storageDelete,
  clientIp, ipHashOf, requestIpHash, jstDay,
  isBanned, checkLimit, recordUse,
  cleanStr, isUuid, validateTitle, validateBody, cleanStringArray, nicknameOf, validateImages,
  verifyTurnstile, signSession, verifySession, sessionCookieHeader, requireAdmin, logAdmin,
  articleSummary, imageRow, getPublicArticleById, getArticleByIdAnyStatus,
};
