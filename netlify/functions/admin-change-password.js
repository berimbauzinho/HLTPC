const { configuration, readSession, createSession, cookie, json, hashPassword } = require("./auth-utils");
const { listUsers, saveUsers } = require("./user-store");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });
  const config = configuration();
  const session = config && readSession(event.headers.cookie, config.secret);
  if (!session || session.role !== "admin") return json(401, { error: "Sessão inválida." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Dados inválidos." }); }
  if (String(body.password || "").length < 8) return json(400, { error: "A nova senha precisa ter pelo menos 8 caracteres." });
  if (body.password === "mudar1234") return json(400, { error: "Escolha uma senha diferente da temporária." });
  const users = await listUsers(event);
  const index = users.findIndex((user) => user.username === session.sub);
  if (index < 0 || !users[index].active) return json(401, { error: "Usuário não autorizado." });
  users[index] = { ...users[index], ...hashPassword(body.password), mustChangePassword: false };
  await saveUsers(event, users);
  const nextSession = createSession(session.sub, config.secret, "admin", false);
  return json(200, { user: { username: session.sub, role: "admin", mustChangePassword: false } }, { "Set-Cookie": cookie(nextSession) });
};
