const { configuration, readSession, json } = require("./auth-utils");
const { getContent, saveContent } = require("./content-store");

function authorized(event) {
  const config = configuration();
  const session = config && readSession(event.headers.cookie, config.secret);
  return session && !session.mustChangePassword ? session : null;
}

exports.handler = async (event) => {
  if (!authorized(event)) return json(403, { error: "Acesso administrativo necessário." });
  try {
    if (event.httpMethod === "GET") return json(200, await getContent(event));
    if (event.httpMethod !== "PUT") return json(405, { error: "Método não permitido." });
    if ((event.body || "").length > 5_500_000) return json(413, { error: "O conteúdo ficou grande demais. Reduza o tamanho das imagens." });
    const body = JSON.parse(event.body || "{}");
    const content = Object.fromEntries(["players", "teams", "tournaments", "matches", "news"].map((key) => [key, Array.isArray(body[key]) ? body[key] : []]));
    content.updatedAt = new Date().toISOString();
    await saveContent(event, content);
    return json(200, { ok: true, updatedAt: content.updatedAt });
  } catch (reason) {
    console.error("HLTPC admin content error", reason);
    return json(500, { error: `${reason?.name || "StorageError"}: ${reason?.message || "Não foi possível salvar."}`.slice(0, 300) });
  }
};
