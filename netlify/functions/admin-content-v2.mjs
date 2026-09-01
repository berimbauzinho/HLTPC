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
    // Reject the legacy whole-document save. A stale Admin tab must never be
    // able to replace the shared site with its local copy again.
    if (request.method === "PUT") return json(410, { error: "Esta versão do painel está desatualizada e foi bloqueada para proteger o conteúdo. Recarregue a página antes de editar." });
    if (request.method !== "PATCH") return json(405, { error: "Método não permitido." });

    const raw = await request.text();
    if (raw.length > 1_500_000) return json(413, { error: "A alteração ficou grande demais. Reduza o tamanho das imagens." });
    const body = JSON.parse(raw || "{}");
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (!changes.length || changes.length > 60) {
      return json(422, { error: "Gravação bloqueada: envie somente os registros alterados." });
    }

    const current = await getContent();
    const content = Object.fromEntries(CONTENT_KEYS.map((key) => [key, [...current[key]]]));
    for (const change of changes) {
      const collection = String(change?.collection || "");
      const id = String(change?.id || "");
      if (!CONTENT_KEYS.includes(collection) || !id) throw Object.assign(new Error("Registro inválido na alteração."), { statusCode: 422 });
      const index = content[collection].findIndex((record) => record.id === id);
      if (change.operation === "delete") {
        if (index < 0) throw Object.assign(new Error("O registro que seria removido não existe mais."), { statusCode: 409 });
        content[collection].splice(index, 1);
        continue;
      }
      if (!change.record || typeof change.record !== "object" || Array.isArray(change.record) || String(change.record.id || "") !== id) {
        throw Object.assign(new Error("A alteração contém um registro inválido."), { statusCode: 422 });
      }
      if (index >= 0) content[collection][index] = change.record;
      else content[collection].unshift(change.record);
    }
    content.updatedAt = new Date().toISOString();
    const saved = await saveContent(content, { expectedRevision: body._revision });
    return json(200, { ok: true, updatedAt: saved.updatedAt, _revision: saved._revision, content: saved });
  } catch (reason) {
    console.error("HLTPC admin content v2 error", reason);
    return json(Number(reason?.statusCode || 500), {
      error: `${reason?.name || "StorageError"}: ${reason?.message || "Não foi possível salvar."}`.slice(0, 300)
    });
  }
};
