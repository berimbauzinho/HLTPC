const { configuration, createSession, cookie, json, safeEqual, normalizeUsername, verifyPassword } = require("./auth-utils");
const { findUser } = require("./user-store");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });
  const config = configuration();
  if (!config) return json(503, { error: "Cadastre HLTPC_OWNER_PASSWORD nas variáveis do Netlify para ativar o owner lanches." });
  let credentials;
  try { credentials = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Dados inválidos." }); }
  const username = normalizeUsername(credentials.username);
  let user;
  if (safeEqual(username, normalizeUsername(config.username)) && safeEqual(credentials.password || "", config.password)) {
    user = { username: config.username, role: "owner", mustChangePassword: false };
  } else {
    const stored = await findUser(username);
    if (!stored || !stored.active || !verifyPassword(credentials.password || "", stored)) return json(401, { error: "Usuário ou senha incorretos." });
    user = { username: stored.username, role: stored.role, mustChangePassword: stored.mustChangePassword };
  }
  const session = createSession(user.username, config.secret, user.role, user.mustChangePassword);
  return json(200, { user }, { "Set-Cookie": cookie(session) });
};
