import { getContent } from "./content-store-v2.mjs";

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export default async (request) => {
  if (request.method !== "GET") return json(405, { error: "Método não permitido." });
  try {
    return json(200, await getContent());
  } catch (reason) {
    console.error("HLTPC public content v2 error", reason);
    return json(Number(reason?.statusCode || 503), {
      error: "O conteúdo compartilhado está temporariamente indisponível."
    });
  }
};
