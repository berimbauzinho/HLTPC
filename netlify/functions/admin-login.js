const { configuration, createSession, cookie, json, safeEqual } = require("./auth-utils");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });
  const config = configuration();
  if (!config) return json(503, { error: "O acesso do owner ainda não foi configurado no Netlify." });
  let credentials;
  try { credentials = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Dados inválidos." }); }
  if (!safeEqual(credentials.username || "", config.username) || !safeEqual(credentials.password || "", config.password)) return json(401, { error: "Usuário ou senha incorretos." });
  const session = createSession(config.username, config.secret);
  return json(200, { user: { username: config.username, role: "owner" } }, { "Set-Cookie": cookie(session) });
};
