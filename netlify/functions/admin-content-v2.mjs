import authUtils from "./auth-utils.js";
import { CONTENT_KEYS, getContent, isValidContent, saveContent } from "./content-store-v2.mjs";

const { configuration, readSession } = authUtils;

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function authorized(request) {
  const config = configuration();
  const session = config && readSession(request.headers.get("cookie") || "", config.secret);
  return session && !session.mustChangePassword ? session : null;
}

export default async (request) => {
  if (!authorized(request)) return json(403, { error: "Acesso administrativo necessário." });
  try {
    if (request.method === "GET") {
      const content = await getContent();
      if (!isValidContent(content)) {
        const error = new Error("A base compartilhada está indisponível. O painel foi mantido em modo seguro.");
        error.statusCode = 503;
        throw error;
      }
      return json(200, content);
    }
    if (request.method !== "PUT") return json(405, { error: "Método não permitido." });

    const raw = await request.text();
    if (raw.length > 5_500_000) return json(413, { error: "O conteúdo ficou grande demais. Reduza o tamanho das imagens." });
    const body = JSON.parse(raw || "{}");
    if (!CONTENT_KEYS.every((key) => Array.isArray(body[key]))) {
      return json(422, { error: "Gravação bloqueada: a base enviada está incompleta." });
    }

    const content = Object.fromEntries(CONTENT_KEYS.map((key) => [key, body[key]]));
    content.updatedAt = new Date().toISOString();
    const saved = await saveContent(content, { expectedRevision: body._revision });
    return json(200, { ok: true, updatedAt: saved.updatedAt, _revision: saved._revision });
  } catch (reason) {
    console.error("HLTPC admin content v2 error", reason);
    return json(Number(reason?.statusCode || 500), {
      error: `${reason?.name || "StorageError"}: ${reason?.message || "Não foi possível salvar."}`.slice(0, 300)
    });
  }
};
