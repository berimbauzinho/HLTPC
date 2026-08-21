const { configuration, readSession, json } = require("./auth-utils");

exports.handler = async (event) => {
  const config = configuration();
  if (!config) return json(503, { error: "Acesso ainda não configurado." });
  const session = readSession(event.headers.cookie, config.secret);
  if (!session) return json(401, { error: "Sessão inválida." });
  return json(200, { user: { username: session.sub, role: session.role, mustChangePassword: session.mustChangePassword } });
};
