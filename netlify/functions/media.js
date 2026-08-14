const { connectLambda, getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") return { statusCode: 405, body: "" };
  try {
    const id = String(event.queryStringParameters?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { statusCode: 404, body: "" };
    connectLambda(event);
    const result = await getStore("hltpc-media").getWithMetadata(id, { type: "arrayBuffer" });
    if (!result) return { statusCode: 404, body: "" };
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
