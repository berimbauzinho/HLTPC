const { configuration, readSession, json, normalizeUsername, hashPassword } = require("./auth-utils");
const { listUsers, saveUsers } = require("./user-store");

const TEMPORARY_PASSWORD = "mudar1234";

function owner(event) {
  const config = configuration();
  const session = config && readSession(event.headers.cookie, config.secret);
  return config && session?.role === "owner" && !session.mustChangePassword ? { config, session } : null;
}

exports.handler = async (event) => {
  const access = owner(event);
  if (!access) return json(403, { error: "Apenas o owner pode administrar usuários." });
  let users = [];
  let storageError = null;
  try {
    users = await listUsers(event);
  } catch (reason) {
    console.error("HLTPC user storage error", reason);
    storageError = `${reason?.name || "StorageError"}: ${reason?.message || "falha desconhecida"}`.slice(0, 300);
  }
  if (event.httpMethod === "GET") return json(200, { users: [{ username: access.config.username, role: "owner", mustChangePassword: false }, ...users.map(({ username, role, mustChangePassword, active, createdAt }) => ({ username, role, mustChangePassword, active, createdAt }))], storageError });
  if (storageError) return json(503, { error: `Não foi possível acessar o armazenamento: ${storageError}` });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Dados inválidos." }); }
  const username = normalizeUsername(body.username);
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json(400, { error: "Use de 3 a 30 caracteres: letras, números, ponto, traço ou underline." });
  if (username === normalizeUsername(access.config.username)) return json(409, { error: "Esse usuário pertence ao owner." });
  const index = users.findIndex((user) => user.username === username);
  if (event.httpMethod === "POST") {
    if (index >= 0) return json(409, { error: "Esse usuário já está cadastrado." });
    users.push({ username, role: "admin", mustChangePassword: true, active: true, createdAt: new Date().toISOString(), ...hashPassword(TEMPORARY_PASSWORD) });
    await saveUsers(event, users); return json(201, { username, temporaryPassword: TEMPORARY_PASSWORD });
  }
  if (index < 0) return json(404, { error: "Usuário não encontrado." });
  if (event.httpMethod === "PUT") {
    users[index] = { ...users[index], ...hashPassword(TEMPORARY_PASSWORD), mustChangePassword: true, active: true };
    await saveUsers(event, users); return json(200, { username, temporaryPassword: TEMPORARY_PASSWORD });
  }
  if (event.httpMethod === "DELETE") {
    users.splice(index, 1); await saveUsers(event, users); return json(200, { ok: true });
  }
  return json(405, { error: "Método não permitido." });
};
