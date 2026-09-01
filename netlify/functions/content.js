const { json } = require("./auth-utils");
const { getContent } = require("./content-store");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Método não permitido." });
  try {
    return json(200, await getContent(event));
  } catch (reason) {
    console.error("HLTPC public content error", reason);
    return json(Number(reason?.statusCode || 503), {
      error: "O conteúdo compartilhado está temporariamente indisponível."
    });
  }
};
