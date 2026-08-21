import { getStore } from "@netlify/blobs";

function imageResponse(request, data, contentType, bytes) {
  return new Response(request.method === "HEAD" ? null : data, {
    status: 200,
    headers: {
      "Content-Type": contentType || "image/webp",
      "Content-Length": String(bytes || data?.byteLength || 0),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });

  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 404 });

    const mediaStore = getStore({ name: "hltpc-media-v2", consistency: "strong" });
    const current = await mediaStore.getWithMetadata(id, { type: "arrayBuffer" });
    if (current?.data) {
      return imageResponse(request, current.data, current.metadata?.contentType, current.metadata?.bytes);
    }

    // Compatibilidade com os dois formatos tentados antes da migração.
    const contentStore = getStore({ name: "hltpc-content", consistency: "strong" });
    const encoded = await contentStore.get(`media-v2/${id}`, { type: "json" });
    if (encoded?.data && encoded?.contentType) {
      const data = Uint8Array.from(Buffer.from(encoded.data, "base64"));
      return imageResponse(request, data, encoded.contentType, encoded.bytes);
    }

    const legacyCurrent = await contentStore.getWithMetadata(`media/${id}`, { type: "arrayBuffer" });
    if (legacyCurrent?.data) {
      return imageResponse(request, legacyCurrent.data, legacyCurrent.metadata?.contentType, legacyCurrent.data.byteLength);
    }

    const legacyStore = getStore({ name: "hltpc-media", consistency: "strong" });
    const legacy = await legacyStore.getWithMetadata(id, { type: "arrayBuffer" });
    if (legacy?.data) return imageResponse(request, legacy.data, legacy.metadata?.contentType, legacy.data.byteLength);

    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    console.error("HLTPC media v2 read error", reason);
    return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
};
