const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { configuration, readSession } = require("./auth-utils");
const { getContent, saveContent } = require("./content-store");
const { processDemoPath } = require("./demo-processor");

function authorized(event) {
  const config = configuration();
  const session = config && readSession(event.headers.cookie, config.secret);
  return session && !session.mustChangePassword ? session : null;
}

function driveFileId(value) {
  const raw = String(value || "");
  return raw.match(/\/file\/d\/([^/?#]+)/)?.[1] || raw.match(/[?&]id=([^&#]+)/)?.[1] || "";
}

function downloadUrl(value) {
  const url = new URL(String(value || ""));
  if (!/(^|\.)google\.com$/i.test(url.hostname) && !/(^|\.)googleusercontent\.com$/i.test(url.hostname)) {
    throw new Error("O processamento no servidor aceita somente links de demo do Google Drive.");
  }
  const id = driveFileId(url.href);
  if (!id) throw new Error("Não foi possível identificar o arquivo nesse link do Google Drive.");
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}

exports.handler = async (event) => {
  if (!authorized(event) || event.httpMethod !== "POST") return { statusCode: 403 };
  let directory = "";
  let content = null;
  let match = null;
  try {
    const { matchId } = JSON.parse(event.body || "{}");
    content = await getContent(event);
    match = (content.matches || []).find((item) => item.id === matchId);
    if (!match) throw new Error("Partida não encontrada.");
    if (!match.demoUrl) throw new Error("Informe o link da demo no Google Drive antes de processar no servidor.");
    match.demoProcessing = {
      status: "processing",
      startedAt: new Date().toISOString(),
      error: ""
    };
    await saveContent(event, content);

    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hltpc-demo-"));
    const demoPath = path.join(directory, "match.dem");
    const response = await fetch(downloadUrl(match.demoUrl), { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`O Google Drive respondeu HTTP ${response.status}. Confirme que o link está compartilhado para leitura.`);
    }
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 700 * 1024 * 1024) throw new Error("A demo ultrapassa o limite de 700 MB do processador.");
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(demoPath));
    const fileSize = (await fs.promises.stat(demoPath)).size;
    if (fileSize > 700 * 1024 * 1024) throw new Error("A demo ultrapassa o limite de 700 MB do processador.");

    const fileName = match.demoInfo?.fileName || `demo-${match.id}.dem`;
    const processed = processDemoPath(demoPath, match, content, { fileName, fileSize });
    const manualResult = match.manualResult === true || ["manual", "manual-maps"].includes(match.resultSource);
    if (manualResult) {
      delete processed.score;
      delete processed.winner;
      delete processed.winnerId;
      delete processed.resultSource;
      delete processed.status;
      processed.evidenceNote = match.evidenceNote;
    }
    Object.assign(match, processed, {
      demoProcessing: {
        status: "complete",
        startedAt: match.demoProcessing.startedAt,
        processedAt: new Date().toISOString(),
        error: ""
      },
      updated: "Demo processada no servidor HLTPC · fonte principal"
    });
    await saveContent(event, content);
    return { statusCode: 200 };
  } catch (reason) {
    console.error("HLTPC demo processing error", reason);
    if (content && match) {
      match.demoProcessing = {
        status: "error",
        startedAt: match.demoProcessing?.startedAt || new Date().toISOString(),
        failedAt: new Date().toISOString(),
        error: String(reason?.message || "Não foi possível processar a demo.").slice(0, 300)
      };
      match.updated = "Falha ao processar demo no servidor";
      await saveContent(event, content).catch((storageError) => console.error("HLTPC demo error persistence", storageError));
    }
    return { statusCode: 500 };
  } finally {
    if (directory) await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
};

