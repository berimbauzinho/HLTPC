const crypto = require("node:crypto");

const COOKIE_NAME = "hltpc_session";
const MAX_AGE = 60 * 60 * 8;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function configuration() {
  const username = process.env.HLTPC_OWNER_USERNAME || "lanches";
  const password = process.env.HLTPC_OWNER_PASSWORD;
  const secret = process.env.HLTPC_SESSION_SECRET || (password ? crypto.createHash("sha256").update(`hltpc-session:${password}`).digest("hex") : null);
  return password && secret ? { username, password, secret } : null;
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSession(username, secret, role = "owner", mustChangePassword = false) {
  const payload = Buffer.from(JSON.stringify({ sub: username, role, mustChangePassword, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString("hex") };
}

function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  return safeEqual(hashPassword(password, record.salt).hash, record.hash);
}

function readSession(cookieHeader, secret) {
  const raw = String(cookieHeader || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.exp > Date.now() ? session : null;
  } catch (_) {
    return null;
  }
}

function cookie(value, maxAge = MAX_AGE) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function json(statusCode, body, headers = {}) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }, body: JSON.stringify(body) };
}

module.exports = { configuration, createSession, readSession, cookie, json, safeEqual, normalizeUsername, hashPassword, verifyPassword };
