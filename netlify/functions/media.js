const { connectLambda, getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") return { statusCode: 405, body: "" };
  try {
    const id = String(event.queryStringParameters?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { statusCode: 404, body: "" };
    connectLambda(event);
    const currentStore = getStore("hltpc-content");
    const legacyStore = getStore("hltpc-media");
    const encoded = await currentStore.get(`media-v2/${id}`, { type: "json", consistency: "eventual" });
    if (encoded?.data && encoded?.contentType) return {
      statusCode: 200,
      headers: { "Content-Type": encoded.contentType, "Content-Length": String(encoded.bytes || Buffer.byteLength(encoded.data, "base64")), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
      body: event.httpMethod === "HEAD" ? "" : encoded.data,
      isBase64Encoded: event.httpMethod !== "HEAD"
    };
    const result = await currentStore.getWithMetadata(`media/${id}`, { type: "arrayBuffer", consistency: "eventual" }) || await legacyStore.getWithMetadata(id, { type: "arrayBuffer", consistency: "eventual" });
    if (!result?.data) return { statusCode: 404, body: "" };
    return {
      statusCode: 200,
      headers: { "Content-Type": result.metadata?.contentType || "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
      body: event.httpMethod === "HEAD" ? "" : Buffer.from(result.data).toString("base64"),
      isBase64Encoded: event.httpMethod !== "HEAD"
    };
  } catch (reason) {
    console.error("HLTPC media read error", reason);
    return { statusCode: 500, body: "" };
  }
};
