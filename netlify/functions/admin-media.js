const crypto = require("node:crypto");
const { connectLambda, getStore } = require("@netlify/blobs");
const { configuration, readSession, json } = require("./auth-utils");

const STORE_NAME = "hltpc-media";
const MAX_OPTIMIZED_BYTES = 1_500_000;

function authorized(event) {
  const config = configuration();
  const session = config && readSession(event.headers.cookie, config.secret);
  return session && !session.mustChangePassword ? session : null;
}

exports.handler = async (event) => {
  if (!authorized(event)) return json(403, { error: "Acesso administrativo necessário." });
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });
  try {
    const contentType = String(event.headers["content-type"] || "").split(";")[0].toLowerCase();
    if (!["image/webp", "image/png", "image/jpeg"].includes(contentType)) return json(415, { error: "Formato de imagem não permitido." });
    const bytes = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "binary");
    if (!bytes.length || bytes.length > MAX_OPTIMIZED_BYTES) return json(413, { error: "A imagem otimizada ultrapassou 1,5 MB." });
    connectLambda(event);
    const id = crypto.randomUUID();
    await getStore(STORE_NAME).set(id, bytes, { metadata: { contentType, uploadedAt: new Date().toISOString() } });
    return json(201, { ok: true, url: `/api/media/${id}` });
  } catch (reason) {
    console.error("HLTPC media upload error", reason);
    return json(500, { error: `${reason?.name || "MediaError"}: ${reason?.message || "Não foi possível salvar a imagem."}`.slice(0, 300) });
  }
};
