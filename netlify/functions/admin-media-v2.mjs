import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import authUtils from "./auth-utils.js";

const { configuration, readSession } = authUtils;
const STORE_NAME = "hltpc-media-v2";
const MAX_OPTIMIZED_BYTES = 1_500_000;

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
  if (request.method !== "POST") return json(405, { error: "Método não permitido." });

  try {
    const contentType = String(request.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!["image/webp", "image/png", "image/jpeg"].includes(contentType)) return json(415, { error: "Formato de imagem não permitido." });

    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_OPTIMIZED_BYTES) return json(413, { error: "A imagem otimizada ultrapassou 1,5 MB." });

    const id = crypto.randomUUID();
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const written = await store.set(id, bytes, {
      onlyIfNew: true,
      metadata: { contentType, bytes: bytes.byteLength, uploadedAt: new Date().toISOString() }
    });
    if (written.modified === false) throw new Error("O identificador da imagem já estava em uso.");

    const verification = await store.getWithMetadata(id, { type: "arrayBuffer" });
    if (!verification?.data || verification.data.byteLength !== bytes.byteLength) {
      throw new Error("O arquivo gravado não pôde ser lido integralmente.");
    }

    return json(201, { ok: true, url: `/api/media/${id}`, bytes: bytes.byteLength });
  } catch (reason) {
    console.error("HLTPC media v2 upload error", reason);
    return json(500, { error: `${reason?.name || "MediaError"}: ${reason?.message || "Não foi possível salvar a imagem."}`.slice(0, 300) });
  }
};
