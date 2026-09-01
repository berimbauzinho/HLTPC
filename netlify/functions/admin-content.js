const { configuration, readSession, json } = require("./auth-utils");
const { CONTENT_KEYS, getContent, isValidContent, saveContent } = require("./content-store");

function authorized(event) {
  const config = configuration();
  const session = config && readSession(event.headers.cookie, config.secret);
  return session && !session.mustChangePassword ? session : null;
}

exports.handler = async (event) => {
  if (!authorized(event)) return json(403, { error: "Acesso administrativo necessário." });
  try {
    if (event.httpMethod === "GET") {
      const content = await getContent(event);
      if (!isValidContent(content)) {
        const error = new Error("A base compartilhada está indisponível. O painel foi mantido em modo seguro.");
        error.statusCode = 503;
        throw error;
      }
      return json(200, content);
    }
    if (event.httpMethod !== "PUT") return json(405, { error: "Método não permitido." });
    if ((event.body || "").length > 5_500_000) return json(413, { error: "O conteúdo ficou grande demais. Reduza o tamanho das imagens." });

    const body = JSON.parse(event.body || "{}");
    if (!CONTENT_KEYS.every((key) => Array.isArray(body[key]))) {
      return json(422, { error: "Gravação bloqueada: a base enviada está incompleta." });
    }
    const content = Object.fromEntries(CONTENT_KEYS.map((key) => [key, body[key]]));
    content.updatedAt = new Date().toISOString();
    const saved = await saveContent(event, content, { expectedRevision: body._revision });
    return json(200, { ok: true, updatedAt: saved.updatedAt, _revision: saved._revision });
  } catch (reason) {
    console.error("HLTPC admin content error", reason);
    const status = Number(reason?.statusCode || 500);
    return json(status, { error: `${reason?.name || "StorageError"}: ${reason?.message || "Não foi possível salvar."}`.slice(0, 300) });
  }
};
